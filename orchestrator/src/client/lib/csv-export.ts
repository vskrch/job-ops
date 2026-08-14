import type { CreateJobInput, Job, JobListItem } from "@shared/types.js";

type ExportableJob =
  | JobListItem
  | Job
  | CreateJobInput
  | Record<string, unknown>;

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatJobsToCsv(jobs: ExportableJob[]): string {
  const headers = [
    "ID",
    "Title",
    "Employer",
    "Status",
    "Match Grade",
    "Match Score",
    "Match Reason",
    "Location",
    "Salary",
    "Job Type",
    "Job Function",
    "Source",
    "Job URL",
    "Application Link",
    "Date Posted",
    "Discovered At",
  ];

  const rows = jobs.map((job) => {
    const j = job as Record<string, unknown>;
    return [
      escapeCsvField(j.id ?? j.sourceJobId ?? ""),
      escapeCsvField(j.title ?? ""),
      escapeCsvField(j.employer ?? ""),
      escapeCsvField(j.status ?? "discovered"),
      escapeCsvField(j.matchGrade ?? ""),
      escapeCsvField(j.suitabilityScore ?? ""),
      escapeCsvField(j.suitabilityReason ?? ""),
      escapeCsvField(j.location ?? ""),
      escapeCsvField(j.salary ?? ""),
      escapeCsvField(j.jobType ?? ""),
      escapeCsvField(j.jobFunction ?? ""),
      escapeCsvField(j.source ?? ""),
      escapeCsvField(j.jobUrl ?? ""),
      escapeCsvField(j.applicationLink ?? j.jobUrl ?? ""),
      escapeCsvField(j.datePosted ?? ""),
      escapeCsvField(j.discoveredAt ?? ""),
    ];
  });

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\r\n");

  return `\uFEFF${csvContent}`;
}

export function downloadJobsCsv(
  jobs: ExportableJob[],
  filenamePrefix = "job-ops-export",
): boolean {
  if (jobs.length === 0) return false;

  const csv = formatJobsToCsv(jobs);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);

  link.setAttribute("href", url);
  link.setAttribute("download", `${filenamePrefix}-${dateStr}.csv`);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return true;
}
