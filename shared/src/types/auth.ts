/**
 * User account & authentication types.
 */

export interface UserAccount {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface UserStats {
  totalJobs: number;
  readyJobs: number;
  appliedJobs: number;
  inProgressJobs: number;
  totalPipelineRuns: number;
  totalSearches: number;
}
