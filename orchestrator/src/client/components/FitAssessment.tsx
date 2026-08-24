import {
  daysUntilDeadline,
  isPastDeadline,
  isUrgentDeadline,
} from "@shared/deadline.js";
import type { Job } from "@shared/types.js";
import { AlertTriangle, Flag, Sparkles, Timer, XCircle } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

interface FitAssessmentProps {
  job: Job;
  className?: string;
}

export const FitAssessment: React.FC<FitAssessmentProps> = ({
  job,
  className,
}) => {
  if (!job.suitabilityReason && !job.matchGrade && !job.matchVerdict)
    return null;

  const gradeTone: Record<string, string> = {
    A: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    B: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    C: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    D: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    F: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  };

  const verdictTone: Record<string, string> = {
    apply: "text-emerald-600 dark:text-emerald-400",
    maybe: "text-amber-600 dark:text-amber-400",
    skip: "text-rose-600 dark:text-rose-400",
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-primary/70 mb-1.5 flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          Fit Assessment
        </div>
        {(job.matchGrade || job.matchVerdict) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {job.matchGrade && (
              <span
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded text-xs font-bold",
                  gradeTone[job.matchGrade] ?? gradeTone.C,
                )}
              >
                {job.matchGrade}
              </span>
            )}
            {job.matchVerdict && (
              <span
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-wide",
                  verdictTone[job.matchVerdict] ?? "",
                )}
              >
                {job.matchVerdict}
              </span>
            )}
            {job.topProject && (
              <span className="text-[10px] text-muted-foreground">
                · Highlight: {job.topProject}
              </span>
            )}
            {job.scoreBreakdown?.locationVerdict === "FAIL" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive">
                <XCircle className="h-3 w-3" />
                Location veto
              </span>
            )}
            {job.scoreBreakdown?.languageGate === "FAIL" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive">
                <Flag className="h-3 w-3" />
                Language gate
              </span>
            )}
            {job.scoreBreakdown?.dealBreakerHit && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Deal-breaker
              </span>
            )}
            {job.deadline && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-medium",
                  isPastDeadline(job.deadline)
                    ? "text-destructive"
                    : isUrgentDeadline(job.deadline)
                      ? "text-amber-600"
                      : "text-muted-foreground",
                )}
              >
                <Timer className="h-3 w-3" />
                {(() => {
                  const days = daysUntilDeadline(job.deadline);
                  if (days === null) return `Deadline: ${job.deadline}`;
                  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
                  if (days === 0) return "Closes today";
                  if (days <= 7) return `Closes in ${days}d`;
                  return `Deadline ${job.deadline}`;
                })()}
              </span>
            )}
            {job.scoreBreakdown &&
              (job.scoreBreakdown.languageGate === "FLAG" ||
                job.scoreBreakdown.locationVerdict === "FLAG") && (
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                  <Flag className="h-3 w-3" />
                  Flagged
                </span>
              )}
          </div>
        )}
        {job.suitabilityReason && (
          <p className="text-xs text-foreground/90 leading-relaxed font-medium">
            {job.suitabilityReason}
          </p>
        )}
        {job.scoreBreakdown && (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  ["Tech", job.scoreBreakdown.technical],
                  ["Exp", job.scoreBreakdown.experience],
                  ["Culture", job.scoreBreakdown.behavioral],
                  ["Career", job.scoreBreakdown.career],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="text-center">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    {label}
                  </div>
                  <div className="text-xs font-semibold">{value}</div>
                  <div className="mt-0.5 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full",
                        value >= 75
                          ? "bg-emerald-500"
                          : value >= 50
                            ? "bg-blue-500"
                            : value >= 35
                              ? "bg-amber-500"
                              : "bg-rose-500",
                      )}
                      style={{ width: `${Math.min(100, value)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {(job.scoreBreakdown.locationNote ||
              job.scoreBreakdown.languageNote ||
              job.scoreBreakdown.dealBreakerNote) && (
              <div className="rounded bg-muted/50 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                {job.scoreBreakdown.locationNote && (
                  <div>Location: {job.scoreBreakdown.locationNote}</div>
                )}
                {job.scoreBreakdown.languageNote && (
                  <div>Language: {job.scoreBreakdown.languageNote}</div>
                )}
                {job.scoreBreakdown.dealBreakerNote && (
                  <div>Deal-breaker: {job.scoreBreakdown.dealBreakerNote}</div>
                )}
              </div>
            )}
            {(job.scoreBreakdown.strengths.length > 0 ||
              job.scoreBreakdown.gaps.length > 0) && (
              <div className="grid grid-cols-2 gap-2 text-[11px] leading-snug">
                {job.scoreBreakdown.strengths.length > 0 && (
                  <div>
                    <div className="font-medium text-foreground/80">
                      Strengths
                    </div>
                    <ul className="list-disc ml-3 space-y-0.5 text-muted-foreground">
                      {job.scoreBreakdown.strengths.map((s, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: LLM-generated short array, no stable id
                        <li key={`s-${i}`}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {job.scoreBreakdown.gaps.length > 0 && (
                  <div>
                    <div className="font-medium text-foreground/80">Gaps</div>
                    <ul className="list-disc ml-3 space-y-0.5 text-muted-foreground">
                      {job.scoreBreakdown.gaps.map((s, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: LLM-generated short array, no stable id
                        <li key={`g-${i}`}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground">
              Overall {job.scoreBreakdown.overall} · {(() => {
                const b = job.scoreBreakdown.overall;
                if (b >= 75) return "Strong Fit";
                if (b >= 60) return "Good Fit";
                if (b >= 45) return "Moderate Fit";
                if (b >= 30) return "Weak Fit";
                return "Poor Fit";
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
