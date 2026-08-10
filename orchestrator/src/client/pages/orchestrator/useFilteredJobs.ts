import type { JobListItem, JobSource } from "@shared/types";
import { useMemo } from "react";
import type {
  DateFilterDimension,
  FilterTab,
  JobDateFilter,
  JobSort,
  JobTypeFilter,
  MatchGradeFilter,
  SalaryFilter,
  SponsorFilter,
} from "./constants";
import {
  compareJobs,
  getJobDateValue,
  jobMatchesQuery,
  parseSalaryBounds,
} from "./utils";

const getSponsorCategory = (score: number | null): SponsorFilter => {
  if (score == null) return "unknown";
  if (score >= 95) return "confirmed";
  if (score >= 80) return "potential";
  return "not_found";
};

const dateSortPriorityOrder: DateFilterDimension[] = [
  "ready",
  "applied",
  "closed",
  "discovered",
];

const normalizeJobType = (raw: string | null): string | null => {
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/[\s_-]/g, "");
  if (lower.includes("fulltime") || lower.includes("full")) return "fulltime";
  if (lower.includes("contract")) return "contract";
  if (lower.includes("parttime") || lower.includes("part")) return "parttime";
  if (lower.includes("intern")) return "internship";
  if (lower.includes("temp")) return "temporary";
  return null;
};

export const useFilteredJobs = (
  jobs: JobListItem[],
  activeTab: FilterTab,
  dateFilter: JobDateFilter,
  sourceFilter: JobSource | "all",
  sponsorFilter: SponsorFilter,
  salaryFilter: SalaryFilter,
  sort: JobSort,
  runFilter: string | null = null,
  searchQuery: string = "",
  locationFilter: string = "",
  matchGradeFilter: MatchGradeFilter = "all",
  jobTypeFilter: JobTypeFilter = "all",
  scoreThreshold: number | null = null,
) =>
  useMemo(() => {
    let filtered = [...jobs];

    if (activeTab === "ready") {
      filtered = filtered.filter((job) => job.status === "ready");
    } else if (activeTab === "discovered") {
      filtered = filtered.filter(
        (job) => job.status === "discovered" || job.status === "processing",
      );
    } else if (activeTab === "applied") {
      filtered = filtered.filter((job) => job.status === "applied");
    } else if (activeTab === "in_progress") {
      filtered = filtered.filter((job) => job.status === "in_progress");
    } else if (activeTab === "skipped") {
      filtered = filtered.filter((job) => job.status === "skipped");
    } else if (activeTab === "expired") {
      filtered = filtered.filter((job) => job.status === "expired");
    } else if (activeTab === "all") {
      const includeClosedJobs = dateFilter.dimensions.includes("closed");
      if (!includeClosedJobs) {
        filtered = filtered.filter((job) => job.closedAt == null);
      }
    }

    if (dateFilter.dimensions.length > 0) {
      filtered = filtered.filter((job) =>
        dateFilter.dimensions.some((dimension) =>
          matchesDateDimension(job, dimension, dateFilter),
        ),
      );
    }

    if (sourceFilter !== "all") {
      filtered = filtered.filter((job) => job.source === sourceFilter);
    }

    if (runFilter) {
      filtered = filtered.filter((job) => job.discoveredByRunId === runFilter);
    }

    if (sponsorFilter !== "all") {
      filtered = filtered.filter(
        (job) => getSponsorCategory(job.sponsorMatchScore) === sponsorFilter,
      );
    }

    if (matchGradeFilter !== "all") {
      filtered = filtered.filter(
        (job) => (job.matchGrade ?? "F") === matchGradeFilter,
      );
    }

    if (jobTypeFilter !== "all") {
      filtered = filtered.filter(
        (job) => normalizeJobType(job.jobType) === jobTypeFilter,
      );
    }

    if (scoreThreshold != null) {
      filtered = filtered.filter(
        (job) =>
          typeof job.suitabilityScore === "number" &&
          job.suitabilityScore >= scoreThreshold,
      );
    }

    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      filtered = filtered.filter((job) => jobMatchesQuery(job, trimmedQuery));
    }

    const trimmedLocation = locationFilter.trim().toLowerCase();
    if (trimmedLocation) {
      filtered = filtered.filter((job) => {
        if (!job.location) return false;
        return job.location.toLowerCase().includes(trimmedLocation);
      });
    }

    const hasMin =
      typeof salaryFilter.min === "number" &&
      Number.isFinite(salaryFilter.min) &&
      salaryFilter.min > 0;
    const hasMax =
      typeof salaryFilter.max === "number" &&
      Number.isFinite(salaryFilter.max) &&
      salaryFilter.max > 0;

    if (
      (salaryFilter.mode === "at_least" && hasMin) ||
      (salaryFilter.mode === "at_most" && hasMax) ||
      (salaryFilter.mode === "between" && (hasMin || hasMax))
    ) {
      filtered = filtered.filter((job) => {
        const bounds = parseSalaryBounds(job);
        if (!bounds) return false;

        if (salaryFilter.mode === "at_least") {
          return hasMin ? bounds.max >= (salaryFilter.min as number) : true;
        }

        if (salaryFilter.mode === "at_most") {
          return hasMax ? bounds.min <= (salaryFilter.max as number) : true;
        }

        const min = hasMin ? (salaryFilter.min as number) : null;
        const max = hasMax ? (salaryFilter.max as number) : null;

        if (min != null && max != null) {
          return bounds.max >= min && bounds.min <= max;
        }
        if (min != null) return bounds.max >= min;
        if (max != null) return bounds.min <= max;
        return true;
      });
    }

    const effectiveSort =
      sort.key === "date"
        ? { ...sort, datePriority: getDatePriority(dateFilter.dimensions) }
        : sort;

    return [...filtered].sort((a, b) => compareJobs(a, b, effectiveSort));
  }, [
    jobs,
    activeTab,
    dateFilter,
    sourceFilter,
    sponsorFilter,
    salaryFilter,
    sort,
    runFilter,
    searchQuery,
    locationFilter,
    matchGradeFilter,
    jobTypeFilter,
    scoreThreshold,
  ]);

const matchesDateDimension = (
  job: JobListItem,
  dimension: DateFilterDimension,
  filter: JobDateFilter,
): boolean => {
  const value = getJobDateValue(job, dimension);
  if (value == null) return false;

  const localDate = toLocalDateKey(value);
  if (!localDate) return false;

  if (filter.startDate && localDate < filter.startDate) return false;
  if (filter.endDate && localDate > filter.endDate) return false;
  return true;
};

const getDatePriority = (dimensions: DateFilterDimension[]) => {
  const enabled = dateSortPriorityOrder.filter((dimension) =>
    dimensions.includes(dimension),
  );
  return enabled.length > 0 ? enabled : dateSortPriorityOrder;
};

const toLocalDateKey = (value: number): string | null => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
