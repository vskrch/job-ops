/**
 * Job Search & Aggregation page.
 *
 * Users enter a natural-language job search query, which is parsed into
 * structured criteria, executed across all available job sources, filtered,
 * deduplicated, ranked by relevance, and emailed to the user.
 */

import * as api from "@client/api";
import { PageHeader, PageMain } from "@client/components/layout";
import { downloadJobsCsv } from "@client/lib/csv-export";
import type {
  JobSearch,
  JobSearchProgressEvent,
  JobSearchResultItem,
  ParsedSearchSpec,
  SearchSourceStatus,
} from "@shared/types";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  Mail,
  MailX,
  Search as SearchIcon,
  Send,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

const EXAMPLE_QUERIES = [
  "Data Engineer jobs in Canada, remote, 4-6 years experience, last 7 days",
  "Senior Python developer jobs in Toronto, remote or hybrid, posted in the last 7 days",
  "Find backend engineering jobs in Vancouver paying over CAD 150k, posted in the last 24 hours",
  "Remote machine-learning engineer roles across Canada requiring 5+ years of experience",
];

type SearchPhase = "idle" | "parsing" | "searching" | "completed" | "failed";

interface ProvisionalCounts {
  discovered: number;
  afterFilter: number;
  duplicatesRemoved: number;
}

export const JobSearchPage: React.FC = () => {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [searchId, setSearchId] = useState<string | null>(null);
  const [parsedSpec, setParsedSpec] = useState<ParsedSearchSpec | null>(null);
  const [cached, setCached] = useState(false);
  const [search, setSearch] = useState<JobSearch | null>(null);
  const [provisionalResults, setProvisionalResults] = useState<
    JobSearchResultItem[]
  >([]);
  const [provisionalCounts, setProvisionalCounts] =
    useState<ProvisionalCounts | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [sourceStatuses, setSourceStatuses] = useState<SearchSourceStatus[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const unsubscribeProgress = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  }, []);

  const handleProgressEvent = useCallback(
    (event: JobSearchProgressEvent) => {
      switch (event.type) {
        case "started":
          setParsedSpec(event.parsedSpec);
          setProgressMessage(
            `Searching ${event.sourcesTotal} source groups for: ${event.parsedSpec.roles.join(", ") || "all roles"}`,
          );
          break;
        case "manifest_started":
          setSourceStatuses((prev) => {
            const next = [...prev];
            const idx = next.findIndex((s) => s.source === event.manifestId);
            if (idx >= 0) {
              next[idx] = {
                ...next[idx],
                status: "running",
              };
            } else {
              next.push({
                source: event.manifestId,
                displayName: event.displayName,
                selectedSources: event.selectedSources,
                status: "running",
                jobsFound: 0,
                error: null,
              });
            }
            return next;
          });
          setProgressMessage(`Fetching jobs from ${event.displayName}...`);
          break;
        case "manifest_completed":
          setSourceStatuses((prev) => {
            const next = [...prev];
            const idx = next.findIndex((s) => s.source === event.manifestId);
            if (idx >= 0) {
              next[idx] = {
                ...next[idx],
                status: event.status,
                jobsFound: event.jobsFound,
                error: event.error,
              };
            } else {
              next.push({
                source: event.manifestId,
                displayName: event.manifestId,
                selectedSources: [],
                status: event.status,
                jobsFound: event.jobsFound,
                error: event.error,
              });
            }
            return next;
          });
          setProgressMessage(
            `${event.manifestId} finished (${event.jobsFound} jobs).`,
          );
          break;
        case "results_partial":
          setProvisionalResults(event.results);
          setProvisionalCounts(event.counts);
          break;
        case "phase":
          setProgressMessage(event.message);
          break;
        case "completed":
          setPhase("completed");
          setProvisionalResults([]);
          setProvisionalCounts(null);
          // Do NOT unsubscribe yet: email delivery events (sent/failed/skipped)
          // arrive after completion. Results are already available in the UI
          // regardless of what happens with email.
          api
            .getJobSearch(event.searchId)
            .then(setSearch)
            .catch(() => {});
          break;
        case "failed":
          setPhase("failed");
          setError(event.error);
          unsubscribeProgress();
          break;
        case "email_sent":
          setSearch((prev) => (prev ? { ...prev, emailStatus: "sent" } : prev));
          unsubscribeProgress();
          break;
        case "email_failed":
          setSearch((prev) =>
            prev
              ? { ...prev, emailStatus: "failed", emailError: event.error }
              : prev,
          );
          unsubscribeProgress();
          break;
        case "email_skipped":
          setSearch((prev) =>
            prev
              ? { ...prev, emailStatus: "skipped", emailError: event.reason }
              : prev,
          );
          unsubscribeProgress();
          break;
      }
    },
    [unsubscribeProgress],
  );

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setPhase("parsing");
    setError(null);
    setParsedSpec(null);
    setSearch(null);
    setProvisionalResults([]);
    setProvisionalCounts(null);
    setSourceStatuses([]);
    setSearchId(null);
    setProgressMessage("Interpreting your search request...");

    try {
      const response = await api.createJobSearch({ query: trimmed });
      setSearchId(response.searchId);
      setParsedSpec(response.parsedSpec);
      setCached(response.cached);

      if (response.status === "completed") {
        const result = await api.getJobSearch(response.searchId);
        setSearch(result);
        setPhase("completed");
        return;
      }

      setPhase("searching");
      setProgressMessage("Starting search across job sources...");

      // SSE is a notification channel, not the source of truth: reconcile
      // with GET in case parsing already finished before we subscribed.
      api
        .getJobSearch(response.searchId)
        .then((current) => {
          if (current.parsedSpec) setParsedSpec(current.parsedSpec);
        })
        .catch(() => {});

      unsubscribeRef.current = api.subscribeToJobSearchProgress(
        response.searchId,
        {
          onMessage: (event: JobSearchProgressEvent) => {
            handleProgressEvent(event);
          },
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start search");
      setPhase("failed");
    }
  }, [query, handleProgressEvent]);

  const handleResendEmail = useCallback(async () => {
    if (!searchId) return;
    try {
      await api.resendJobSearchEmail(searchId);
      const updated = await api.getJobSearch(searchId);
      setSearch(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend email");
    }
  }, [searchId]);

  const handleExampleQuery = useCallback((q: string) => {
    setQuery(q);
  }, []);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  const isSearching = phase === "parsing" || phase === "searching";
  const results = search?.results;

  return (
    <>
      <PageHeader
        icon={SearchIcon}
        title="Job Search"
        subtitle="Search across all job sources with natural language"
      />
      <PageMain>
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Search Input */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SearchIcon className="h-5 w-5" />
                Natural-Language Job Search
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Describe the jobs you're looking for in natural language..."
                className="min-h-[100px] resize-y"
                disabled={isSearching}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    handleSearch();
                  }
                }}
              />
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_QUERIES.map((q) => (
                    <Button
                      key={q}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => handleExampleQuery(q)}
                      disabled={isSearching}
                    >
                      {q.length > 50 ? `${q.slice(0, 50)}...` : q}
                    </Button>
                  ))}
                </div>
                <Button
                  onClick={handleSearch}
                  disabled={!query.trim() || isSearching}
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Searching...
                    </>
                  ) : (
                    <>
                      <SearchIcon className="mr-2 h-4 w-4" />
                      Search
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Search Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Cache indicator */}
          {cached && phase === "completed" && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Showing cached results from a recent identical search. Submit
                again to force a fresh search.
              </AlertDescription>
            </Alert>
          )}

          {/* Interpreted Criteria */}
          {parsedSpec && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Interpreted Search Criteria
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  {parsedSpec.interpretation}
                </p>
                <div className="flex flex-wrap gap-2">
                  {parsedSpec.roles.length > 0 &&
                    parsedSpec.roles.map((r) => (
                      <Badge key={`role-${r}`} variant="default">
                        {r}
                      </Badge>
                    ))}
                  {parsedSpec.location.country && (
                    <Badge variant="secondary">
                      {parsedSpec.location.country}
                    </Badge>
                  )}
                  {parsedSpec.location.cities.map((c) => (
                    <Badge key={`city-${c}`} variant="secondary">
                      {c}
                    </Badge>
                  ))}
                  {parsedSpec.workMode !== "any" && (
                    <Badge variant="secondary">{parsedSpec.workMode}</Badge>
                  )}
                  {parsedSpec.experience.minYears !== null && (
                    <Badge variant="secondary">
                      {parsedSpec.experience.minYears}
                      {parsedSpec.experience.maxYears !== null
                        ? `-${parsedSpec.experience.maxYears}`
                        : "+"}{" "}
                      years
                    </Badge>
                  )}
                  {parsedSpec.postedWithin.value !== null && (
                    <Badge variant="secondary">
                      <Clock className="mr-1 h-3 w-3" />
                      last {parsedSpec.postedWithin.value}{" "}
                      {parsedSpec.postedWithin.unit}
                    </Badge>
                  )}
                  {parsedSpec.skills.map((s) => (
                    <Badge key={`skill-${s}`} variant="outline">
                      {s}
                    </Badge>
                  ))}
                </div>
                {parsedSpec.explicitConstraints.length > 0 && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    <strong>Explicit:</strong>{" "}
                    {parsedSpec.explicitConstraints.join(", ")}
                    {parsedSpec.inferredPreferences.length > 0 && (
                      <>
                        {" "}
                        | <strong>Inferred:</strong>{" "}
                        {parsedSpec.inferredPreferences.join(", ")}
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Progress */}
          {isSearching && (
            <Card>
              <CardContent className="py-6">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm font-medium">{progressMessage}</span>
                </div>
                {sourceStatuses.length > 0 && (
                  <div className="mt-4 space-y-1">
                    {sourceStatuses.map((s) => (
                      <div
                        key={s.source}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="font-mono">{s.source}</span>
                        {s.status === "succeeded" && (
                          <Badge variant="default" className="text-xs">
                            {s.jobsFound} jobs
                          </Badge>
                        )}
                        {s.status === "failed" && (
                          <Badge variant="destructive" className="text-xs">
                            failed
                          </Badge>
                        )}
                        {s.status === "running" && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Results Summary */}
          {results && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Search Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <div className="text-2xl font-bold">
                      {results.totalDiscovered}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Discovered
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">
                      {results.totalAfterFilter}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      After Filter
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">
                      {results.duplicatesRemoved}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Duplicates
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-600">
                      {results.highlyRelevant}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Highly Relevant
                    </div>
                  </div>
                </div>
                {results.freshness.requested && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Freshness: {results.freshness.requested} | Effective:{" "}
                    {results.freshness.effectiveStart
                      ? new Date(
                          results.freshness.effectiveStart,
                        ).toLocaleString()
                      : "N/A"}{" "}
                    to{" "}
                    {results.freshness.effectiveEnd
                      ? new Date(
                          results.freshness.effectiveEnd,
                        ).toLocaleString()
                      : "N/A"}{" "}
                    | Removed by freshness:{" "}
                    {results.freshness.removedByFreshness}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Source Status */}
          {(sourceStatuses.length > 0 ||
            (results && results.sources.length > 0)) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Source Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {(sourceStatuses.length > 0
                    ? sourceStatuses
                    : (results?.sources ?? [])
                  ).map((s) => (
                    <div
                      key={s.source}
                      className="flex items-center justify-between border-b py-1 text-sm last:border-0"
                    >
                      <div className="min-w-0">
                        <span className="font-medium">{s.displayName}</span>
                        {s.selectedSources.length > 1 && (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {s.selectedSources.join(", ")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {s.status === "succeeded" && (
                          <>
                            <Badge variant="default" className="text-xs">
                              {s.jobsFound} jobs
                            </Badge>
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          </>
                        )}
                        {s.status === "failed" && (
                          <>
                            <Badge variant="destructive" className="text-xs">
                              failed
                            </Badge>
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          </>
                        )}
                        {s.status === "skipped" && (
                          <>
                            <Badge variant="secondary" className="text-xs">
                              skipped
                            </Badge>
                            <AlertCircle className="h-4 w-4 text-muted-foreground" />
                          </>
                        )}
                        {s.status === "running" && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        {s.error && (
                          <span className="text-xs text-muted-foreground">
                            {s.error}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Provisional Results (streaming while sources are still running) */}
          {phase !== "completed" && provisionalResults.length > 0 && (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  Provisional Results
                  <Badge variant="secondary" className="text-xs">
                    updating...
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {provisionalCounts && (
                  <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
                    <span>Discovered: {provisionalCounts.discovered}</span>
                    <span>After filter: {provisionalCounts.afterFilter}</span>
                    <span>
                      Duplicates: {provisionalCounts.duplicatesRemoved}
                    </span>
                  </div>
                )}
                <div className="space-y-3">
                  {provisionalResults.slice(0, 20).map((item, i) => (
                    <JobResultCard
                      key={`prov-${item.job.jobUrl}-${i}`}
                      item={item}
                      index={i}
                    />
                  ))}
                </div>
                {provisionalResults.length > 20 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing 20 of {provisionalResults.length} provisional
                    results — final ranking completes when all sources finish.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Email Status */}
          {search && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {search.emailStatus === "sent" && (
                      <>
                        <Mail className="h-5 w-5 text-green-600" />
                        <span className="text-sm">
                          Email sent
                          {search.emailSentAt
                            ? ` at ${new Date(search.emailSentAt).toLocaleString()}`
                            : ""}
                        </span>
                      </>
                    )}
                    {search.emailStatus === "failed" && (
                      <>
                        <MailX className="h-5 w-5 text-destructive" />
                        <span className="text-sm">
                          Email failed: {search.emailError}
                        </span>
                      </>
                    )}
                    {search.emailStatus === "pending" && (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-sm">Email pending...</span>
                      </>
                    )}
                    {search.emailStatus === "skipped" && (
                      <>
                        <MailX className="h-5 w-5 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Email skipped
                          {search.emailError ? ` (${search.emailError})` : ""}
                        </span>
                      </>
                    )}
                  </div>
                  {search.emailStatus === "failed" ||
                  search.emailStatus === "skipped" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleResendEmail}
                    >
                      <Send className="mr-1 h-3 w-3" />
                      Resend
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Job Results */}
          {results && results.jobs.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">
                  Ranked Results ({results.jobs.length})
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const jobsToExport = results.jobs.map((item) => ({
                      ...item.job,
                      suitabilityScore: item.relevanceScore,
                      suitabilityReason: item.matchExplanation,
                    }));
                    downloadJobsCsv(jobsToExport, "search-results");
                  }}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {results.jobs.map((item, i) => (
                    <JobResultCard
                      key={`${item.job.jobUrl}-${i}`}
                      item={item}
                      index={i}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* No results */}
          {results && results.jobs.length === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No matching jobs found</AlertTitle>
              <AlertDescription>
                The search completed but no jobs matched all strict criteria.
                Try broadening your query.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </PageMain>
    </>
  );
};

function JobResultCard({
  item,
  index,
}: {
  item: JobSearchResultItem;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border p-4 transition-colors hover:bg-muted/50">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-4 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              #{index + 1}
            </span>
            <h3 className="truncate font-semibold">{item.job.title}</h3>
            {item.relevanceScore > 0 ? (
              <Badge variant="default" className="shrink-0">
                {item.relevanceScore}
              </Badge>
            ) : (
              <Badge variant="secondary" className="shrink-0">
                pending
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {item.job.employer}
            {item.job.location ? ` — ${item.job.location}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.matchExplanation}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {item.sources.map((s) => (
              <Badge key={s} variant="outline" className="text-xs">
                {s}
              </Badge>
            ))}
            {item.job.isRemote && (
              <Badge variant="secondary" className="text-xs">
                Remote
              </Badge>
            )}
            {item.job.salary && (
              <Badge variant="secondary" className="text-xs">
                {item.job.salary}
              </Badge>
            )}
          </div>
        </div>
        {item.job.applicationLink || item.job.jobUrl ? (
          <a
            href={item.job.applicationLink ?? item.job.jobUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0"
          >
            <Button variant="outline" size="sm">
              View →
            </Button>
          </a>
        ) : null}
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {item.verifiedConstraints.length > 0 && (
            <div className="text-xs">
              <span className="font-semibold text-green-600">Verified: </span>
              {item.verifiedConstraints.join(", ")}
            </div>
          )}
          {item.unverifiedConstraints.length > 0 && (
            <div className="text-xs">
              <span className="font-semibold text-amber-600">Unverified: </span>
              {item.unverifiedConstraints.join(", ")}
            </div>
          )}
          {item.job.jobDescription && (
            <div className="text-xs text-muted-foreground">
              <p className="line-clamp-4">
                {item.job.jobDescription.slice(0, 500)}
                {item.job.jobDescription.length > 500 ? "..." : ""}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
