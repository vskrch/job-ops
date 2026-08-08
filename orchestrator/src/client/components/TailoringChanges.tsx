import { useProfile } from "@client/hooks/useProfile";
import type { Job } from "@shared/types.js";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";
import {
  getOriginalHeadline,
  getOriginalSkills,
  getOriginalSummary,
  parseTailoredSkills,
  type TailoredSkillGroup,
} from "./tailoring-utils";

interface TailoringChangesProps {
  job: Job;
  className?: string;
}

interface SkillDiff {
  added: string[];
  removed: string[];
}

function diffKeywords(
  original: TailoredSkillGroup[],
  tailored: TailoredSkillGroup[],
): SkillDiff {
  const toSet = (groups: TailoredSkillGroup[]): Set<string> =>
    new Set(
      groups.flatMap((g) => g.keywords.map((k: string) => k.toLowerCase().trim())),
    );

  const origSet = toSet(original);
  const tailSet = toSet(tailored);

  const added = [...tailSet].filter((k) => !origSet.has(k));
  const removed = [...origSet].filter((k) => !tailSet.has(k));

  return { added, removed };
}

export const TailoringChanges: React.FC<TailoringChangesProps> = ({
  job,
  className,
}) => {
  const { profile } = useProfile();

  if (!job.tailoredSummary && !job.tailoredHeadline && !job.tailoredSkills) {
    return null;
  }

  const origSummary = getOriginalSummary(profile);
  const origHeadline = getOriginalHeadline(profile);
  const origSkills = getOriginalSkills(profile);
  const tailSkills = parseTailoredSkills(job.tailoredSkills);

  const summaryChanged =
    job.tailoredSummary && job.tailoredSummary !== origSummary;
  const headlineChanged =
    job.tailoredHeadline && job.tailoredHeadline !== origHeadline;
  const skillDiff = diffKeywords(origSkills, tailSkills);

  const hasChanges =
    summaryChanged ||
    headlineChanged ||
    skillDiff.added.length > 0 ||
    skillDiff.removed.length > 0;

  if (!hasChanges) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <Plus className="h-3 w-3 text-primary/70" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Tailoring Changes
        </span>
      </div>

      <div className="space-y-2">
        {headlineChanged && (
          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-muted-foreground/70">
              Headline
            </span>
            <div className="text-xs">
              <span className="text-muted-foreground line-through">
                {origHeadline || "—"}
              </span>
              <span className="mx-1 text-muted-foreground/50">→</span>
              <span className="font-medium text-foreground/90">
                {job.tailoredHeadline}
              </span>
            </div>
          </div>
        )}

        {summaryChanged && (
          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-muted-foreground/70">
              Summary
            </span>
            <div className="text-xs leading-relaxed text-foreground/80">
              <span className="text-muted-foreground line-through">
                {origSummary.slice(0, 80)}
                {origSummary.length > 80 ? "…" : ""}
              </span>
              <span className="mx-1 text-muted-foreground/50">→</span>
              <span className="italic">
                {(job.tailoredSummary ?? "").slice(0, 120)}
                {(job.tailoredSummary ?? "").length > 120 ? "…" : ""}
              </span>
            </div>
          </div>
        )}

        {skillDiff.added.length > 0 && (
          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-muted-foreground/70">
              Keywords added
            </span>
            <div className="flex flex-wrap gap-1">
              {skillDiff.added.map((keyword) => (
                <span
                  key={keyword}
                  className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                >
                  <ArrowUp className="h-2.5 w-2.5" />
                  {keyword}
                </span>
              ))}
            </div>
          </div>
        )}

        {skillDiff.removed.length > 0 && (
          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-muted-foreground/70">
              Keywords removed
            </span>
            <div className="flex flex-wrap gap-1">
              {skillDiff.removed.map((keyword) => (
                <span
                  key={keyword}
                  className="inline-flex items-center gap-0.5 rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400"
                >
                  <ArrowDown className="h-2.5 w-2.5" />
                  {keyword}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
