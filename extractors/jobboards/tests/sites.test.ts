import { describe, expect, it } from "vitest";
import { JOB_BOARD_SITES } from "../src/sites";

const ELUTA_FIXTURE = `Title: software developer jobs | Eluta.ca

URL Source: https://www.eluta.ca/search?q=software+developer

Markdown Content:
## [Lead Software Developer](https://www.eluta.ca/search?q=software+developer#! "Lead Software Developer")$168,000

[OpenText Corporation](https://www.eluta.ca/search?q=software+developer#! "See all jobs at OpenText Corporation")

[TOP EMPLOYER](https://www.eluta.ca/search?q=software+developer#! "Read why OpenText Corporation is a top employer.")Richmond Hill ON...Software Developer F/T on-site OPENTEXT.
`;

const DICE_FIXTURE = `## Search Jobs | Dice.com

Markdown Content:
[Senior Backend Software Developer](https://www.dice.com/job-detail/f6f41092-b1b5-49b8-ae23-33df957865c7)

[Ground Penetrating Radar Systems](https://www.dice.com/company-profile/b3df54a1-726d-4fa3-9724-bc9bd4935cbd?companyname=Ground%20Penetrating%20Radar%20Systems)
Remote or Maumee, Ohio • Today

Sponsored

Full-time
`;

const INSTAHYRE_FIXTURE = `[![Image 1](https://media.instahyre.com/logo.webp) Broccoli AI - Senior Software Engineer Job available in Bangalore Founded in 1995 • 50 - 200 employees Senior Software Engineer Broccoli AI Bangalore View »](https://www.instahyre.com/job-437575-senior-software-engineer-at-broccoli-ai-bangalore/)
`;

describe("jobboards parsers", () => {
  it("parses eluta markdown", () => {
    const jobs = JOB_BOARD_SITES.eluta.parse(ELUTA_FIXTURE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "eluta",
      title: "Lead Software Developer",
      employer: "OpenText Corporation",
      location: "Richmond Hill ON",
      salary: "$168,000",
    });
    expect(jobs[0].sourceJobId).toBeTruthy();
  });

  it("parses dice markdown", () => {
    const jobs = JOB_BOARD_SITES.dice.parse(DICE_FIXTURE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "dice",
      title: "Senior Backend Software Developer",
      employer: "Ground Penetrating Radar Systems",
      location: "Remote or Maumee, Ohio",
      jobUrl:
        "https://www.dice.com/job-detail/f6f41092-b1b5-49b8-ae23-33df957865c7",
    });
  });

  it("parses instahyre markdown", () => {
    const jobs = JOB_BOARD_SITES.instahyre.parse(INSTAHYRE_FIXTURE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "instahyre",
      title: "senior software engineer",
      employer: "Broccoli AI",
      location: "Bangalore",
      jobUrl:
        "https://www.instahyre.com/job-437575-senior-software-engineer-at-broccoli-ai-bangalore/",
    });
  });

  it("returns no jobs for an empty shell (monster blocked)", () => {
    expect(
      JOB_BOARD_SITES.monster.parse(
        "Markdown Content:\n[Upload Your Resume](https://www.monster.com/profile/upload-resume)",
      ),
    ).toHaveLength(0);
  });

  it("parses builtin markdown", () => {
    const fixture = `[Senior Fullstack Engineer](https://builtin.com/job/engineer/123)\n\n[Acme Corp]`;
    const jobs = JOB_BOARD_SITES.builtin.parse(fixture);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "builtin",
      title: "Senior Fullstack Engineer",
      employer: "Acme Corp",
      jobUrl: "https://builtin.com/job/engineer/123",
    });
  });

  it("parses jobbank canada markdown", () => {
    const fixture = `[Software Developer](https://www.jobbank.gc.ca/jobsearch/jobposting/98765432)`;
    const jobs = JOB_BOARD_SITES.jobbank.parse(fixture);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "jobbank",
      title: "Software Developer",
      sourceJobId: "98765432",
      location: "Canada",
    });
  });

  it("parses shine india markdown", () => {
    const fixture = `[Full Stack Developer](https://www.shine.com/jobs/full-stack-developer/12345)`;
    const jobs = JOB_BOARD_SITES.shine.parse(fixture);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "shine",
      title: "Full Stack Developer",
      location: "India",
    });
  });
});
