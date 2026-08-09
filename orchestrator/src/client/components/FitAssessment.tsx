import type { Job } from "@shared/types.js";
import { Sparkles } from "lucide-react";
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
          <div className="mb-1.5 flex items-center gap-2">
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
          </div>
        )}
        {job.suitabilityReason && (
          <p className="text-xs text-foreground/90 leading-relaxed font-medium">
            {job.suitabilityReason}
          </p>
        )}
      </div>
    </div>
  );
};
