import type { ExtractorSourceId } from "@shared/extractors";
import type { CreateJobInput } from "@shared/types/jobs";

export interface JobBoardSite {
  source: ExtractorSourceId;
  label: string;
  searchUrl(term: string): string;
  /** Parse rendered page (HTML or Jina markdown) into jobs. Never throws. */
  parse(text: string): CreateJobInput[];
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueJobs(jobs: CreateJobInput[]): CreateJobInput[] {
  const seen = new Set<string>();
  const out: CreateJobInput[] = [];
  for (const job of jobs) {
    const key = job.sourceJobId || job.jobUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}

/**
 * Eluta (Canada) renders its list client-side behind reCAPTCHA, so results
 * normally come from the Jina backend as markdown. Detail links are in-page
 * drawers (#!), so jobUrl falls back to the search page; sourceJobId keeps
 * dedupe working.
 */
const eluta: JobBoardSite = {
  source: "eluta",
  label: "Eluta",
  searchUrl: (term) =>
    `https://www.eluta.ca/search?q=${encodeURIComponent(term)}`,
  parse: (text) => {
    const re =
      /## \[([^\]]+)\]\([^)]*\)(\$[0-9,]+)?\n\n\[([^\]]+)\]\([^)]*\)\n*(?:\[[^\]]*\]\([^)]*\)\n*)*([^\n]*)/g;
    const jobs: CreateJobInput[] = [];
    for (const match of text.matchAll(re)) {
      const title = match[1]?.trim();
      const salary = match[2] ?? undefined;
      const employer = match[3]?.trim() ?? "Unknown Employer";
      if (!title) continue;
      const tail = match[4] ?? "";
      const location =
        (tail.match(/^([A-Z][A-Za-z .'-]{1,40}?)\.\.\./) ?? [])[1] ?? undefined;
      const sourceJobId = `${slug(employer)}-${slug(title)}`;
      jobs.push({
        source: "eluta",
        sourceJobId,
        title,
        employer,
        jobUrl: `https://www.eluta.ca/search?q=${encodeURIComponent(title)}`,
        applicationLink: `https://www.eluta.ca/search?q=${encodeURIComponent(title)}`,
        location,
        salary,
      });
    }
    return uniqueJobs(jobs);
  },
};

/** Dice (US) serves job-detail links server-side; Jina renders the SPA list. */
const dice: JobBoardSite = {
  source: "dice",
  label: "Dice",
  searchUrl: (term) =>
    `https://www.dice.com/jobs?q=${encodeURIComponent(term)}`,
  parse: (text) => {
    const re =
      /\[([^\]]+)\]\(https:\/\/www\.dice\.com\/job-detail\/([a-f0-9-]+)\)\n\n\[([^\]]+)\]\([^)]*\)\n([^\n]*)/g;
    const jobs: CreateJobInput[] = [];
    for (const match of text.matchAll(re)) {
      const title = match[1]?.trim();
      const jobId = match[2];
      const employer = match[3]?.trim() ?? "Unknown Employer";
      if (!title || !jobId) continue;
      const jobUrl = `https://www.dice.com/job-detail/${jobId}`;
      const location = (match[4] ?? "").split("•")[0]?.trim() || undefined;
      jobs.push({
        source: "dice",
        sourceJobId: jobId,
        title,
        employer,
        jobUrl,
        applicationLink: jobUrl,
        location,
      });
    }
    return uniqueJobs(jobs);
  },
};

/**
 * Instahyre (India) is a SPA; Jina renders job cards. Company and cities come
 * from the link text, id + title from the URL slug.
 */
const instahyre: JobBoardSite = {
  source: "instahyre",
  label: "Instahyre",
  searchUrl: (term) =>
    `https://www.instahyre.com/jobs/?query=${encodeURIComponent(term)}`,
  parse: (text) => {
    const jobs: CreateJobInput[] = [];
    for (const match of text.matchAll(
      /\(https:\/\/www\.instahyre\.com\/job-(\d+)-([^)]+?)\/\)/g,
    )) {
      const id = match[1];
      const slug = match[2] ?? "";
      if (!id) continue;
      const titleSlug = slug.split("-at-")[0] ?? "";
      const title = titleSlug.replace(/-/g, " ").trim();
      if (!title) continue;
      const jobUrl = `https://www.instahyre.com/job-${id}-${slug}/`;
      jobs.push({
        source: "instahyre",
        sourceJobId: id,
        title,
        employer: "Unknown Employer",
        jobUrl,
        applicationLink: jobUrl,
      });
    }

    // Enrich employer + location from the rendered link text (same order as
    // the URL matches): "Company - Title Job available in Cities".
    const textRe = /\[![^\]]*\]\([^)]*\)\s*([^-]+?)\s*-\s/g;
    const cityRe = /Job available in ([^F\n]+?)(?: Founded|$)/g;
    const employers = [...text.matchAll(textRe)].map((m) => m[1]?.trim());
    const cities = [...text.matchAll(cityRe)].map((m) => m[1]?.trim());
    return uniqueJobs(
      jobs.map((job, index) => ({
        ...job,
        employer: employers[index] ?? job.employer,
        location: cities[index] ?? undefined,
      })),
    );
  },
};

/**
 * Monster renders results fully client-side; Jina currently returns the page
 * shell, so this usually yields zero jobs. Kept so the backend-order trick
 * picks results up automatically if Monster ever serves them.
 */
const monster: JobBoardSite = {
  source: "monster",
  label: "Monster",
  searchUrl: (term) =>
    `https://www.monster.com/jobs/search/?q=${encodeURIComponent(term)}`,
  parse: (text) => {
    const re =
      /\[([^\]]+)\]\((https:\/\/www\.monster\.com\/job-openings\/[^)]+)\)/g;
    const jobs: CreateJobInput[] = [];
    for (const match of text.matchAll(re)) {
      const title = match[1]?.trim();
      const jobUrl = match[2];
      if (!title || !jobUrl) continue;
      jobs.push({
        source: "monster",
        sourceJobId: jobUrl,
        title,
        employer: "Unknown Employer",
        jobUrl,
        applicationLink: jobUrl,
      });
    }
    return uniqueJobs(jobs);
  },
};

export const JOB_BOARD_SITES: Record<string, JobBoardSite> = {
  eluta,
  dice,
  instahyre,
  monster,
};
