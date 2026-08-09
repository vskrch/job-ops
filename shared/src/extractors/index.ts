import { z } from "zod";

export const EXTRACTOR_SOURCE_IDS = [
  "gradcracker",
  "indeed",
  "linkedin",
  "glassdoor",
  "ukvisajobs",
  "adzuna",
  "hiringcafe",
  "startupjobs",
  "workingnomads",
  "golangjobs",
  "ziprecruiter",
  "google",
  "bayt",
  "bdjobs",
  "naukri",
  "dice",
  "monster",
  "instahyre",
  "eluta",
  "builtin",
  "simplyhired",
  "jobbank",
  "foundit",
  "shine",
  "remotive",
  "remoteok",
  "hnhiring",
  "weworkremotely",
  "usajobs",
  "greenhouse",
  "lever",
  "ashby",
  "manual",
] as const;

export type ExtractorSourceId = (typeof EXTRACTOR_SOURCE_IDS)[number];

export interface ExtractorSourceMetadata {
  label: string;
  order: number;
  category: "pipeline" | "manual";
  requiresCredentials?: boolean;
  ukOnly?: boolean;
}

export const EXTRACTOR_SOURCE_METADATA: Record<
  ExtractorSourceId,
  ExtractorSourceMetadata
> = {
  gradcracker: {
    label: "Gradcracker",
    order: 10,
    category: "pipeline",
    ukOnly: true,
  },
  indeed: { label: "Indeed", order: 20, category: "pipeline" },
  linkedin: { label: "LinkedIn", order: 30, category: "pipeline" },
  glassdoor: { label: "Glassdoor", order: 40, category: "pipeline" },
  ukvisajobs: {
    label: "UK Visa Jobs",
    order: 50,
    category: "pipeline",
    requiresCredentials: true,
    ukOnly: true,
  },
  adzuna: {
    label: "Adzuna",
    order: 60,
    category: "pipeline",
    requiresCredentials: true,
  },
  hiringcafe: { label: "Hiring Cafe", order: 70, category: "pipeline" },
  startupjobs: { label: "startup.jobs", order: 80, category: "pipeline" },
  workingnomads: {
    label: "Working Nomads",
    order: 90,
    category: "pipeline",
  },
  golangjobs: {
    label: "Golang Jobs",
    order: 100,
    category: "pipeline",
  },
  manual: { label: "Manual", order: 110, category: "manual" },
  ziprecruiter: {
    label: "ZipRecruiter",
    order: 120,
    category: "pipeline",
  },
  google: { label: "Google Jobs", order: 130, category: "pipeline" },
  bayt: { label: "Bayt", order: 140, category: "pipeline" },
  bdjobs: {
    label: "BDJobs",
    order: 150,
    category: "pipeline",
  },
  naukri: { label: "Naukri", order: 160, category: "pipeline" },
  dice: { label: "Dice", order: 170, category: "pipeline" },
  monster: { label: "Monster", order: 180, category: "pipeline" },
  instahyre: {
    label: "Instahyre",
    order: 190,
    category: "pipeline",
  },
  eluta: { label: "Eluta", order: 200, category: "pipeline" },
  builtin: { label: "Built In (US)", order: 210, category: "pipeline" },
  simplyhired: { label: "SimplyHired", order: 220, category: "pipeline" },
  jobbank: { label: "Job Bank Canada", order: 230, category: "pipeline" },
  foundit: { label: "foundit (India)", order: 240, category: "pipeline" },
  shine: { label: "Shine (India)", order: 250, category: "pipeline" },
  remotive: {
    label: "Remotive (Remote)",
    order: 260,
    category: "pipeline",
  },
  remoteok: { label: "RemoteOK", order: 270, category: "pipeline" },
  hnhiring: {
    label: "HN Who's Hiring",
    order: 280,
    category: "pipeline",
  },
  weworkremotely: {
    label: "We Work Remotely",
    order: 290,
    category: "pipeline",
  },
  usajobs: {
    label: "USAJOBS (Federal)",
    order: 300,
    category: "pipeline",
    requiresCredentials: true,
  },
  greenhouse: {
    label: "Greenhouse",
    order: 310,
    category: "pipeline",
  },
  lever: {
    label: "Lever",
    order: 320,
    category: "pipeline",
  },
  ashby: {
    label: "Ashby",
    order: 330,
    category: "pipeline",
  },
};

export const PIPELINE_EXTRACTOR_SOURCE_IDS = EXTRACTOR_SOURCE_IDS.filter(
  (source) => EXTRACTOR_SOURCE_METADATA[source].category === "pipeline",
);

const extractorSourceTuple = EXTRACTOR_SOURCE_IDS as unknown as [
  ExtractorSourceId,
  ...ExtractorSourceId[],
];

export const extractorSourceEnum = z.enum(extractorSourceTuple);

export function isExtractorSourceId(value: string): value is ExtractorSourceId {
  return EXTRACTOR_SOURCE_IDS.includes(value as ExtractorSourceId);
}

export function sourceLabel(source: ExtractorSourceId): string {
  return EXTRACTOR_SOURCE_METADATA[source].label;
}

export function sortSources<T extends { source: ExtractorSourceId }>(
  values: T[],
): T[] {
  return [...values].sort(
    (left, right) =>
      EXTRACTOR_SOURCE_METADATA[left.source].order -
      EXTRACTOR_SOURCE_METADATA[right.source].order,
  );
}
