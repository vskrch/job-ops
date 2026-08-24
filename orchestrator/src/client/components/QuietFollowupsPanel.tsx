import * as api from "@client/api";
import { Clock, Copy, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface DraftState {
  jobId: string;
  draft: string;
  artifactId: string | null;
}

export const QuietFollowupsPanel: React.FC = () => {
  const [quiet, setQuiet] = useState<api.QuietFollowupsResponse["quiet"]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getQuietFollowups();
      setQuiet(res.quiet);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load quiet applications.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDraft = useCallback(async (jobId: string) => {
    try {
      const res = await api.draftFollowup({ jobId, channel: "email" });
      setDrafts((m) => ({
        ...m,
        [jobId]: { jobId, draft: res.draft, artifactId: res.artifact.id },
      }));
      toast.success("Follow-up drafted — edit before you send.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Draft failed.");
    }
  }, []);

  const handleLog = useCallback(
    async (jobId: string) => {
      const entry = drafts[jobId];
      try {
        await api.logFollowup({
          jobId,
          artifactId: entry?.artifactId ?? undefined,
        });
        toast.success("Follow-up logged — history stays append-only.");
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Log failed.");
      }
    },
    [drafts, refresh],
  );

  if (isLoading) return null;
  if (quiet.length === 0) return null;

  return (
    <Card className="border-amber-200/60 bg-amber-50/40 dark:border-amber-900/30 dark:bg-amber-950/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-amber-600" />
          Quiet applications · {quiet.length} awaiting follow-up (max 2 per app,
          drafts only)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {quiet.map(({ job, daysQuiet, followUpCount }) => {
          const draft = drafts[job.id];
          return (
            <div
              key={job.id}
              className="rounded-md border border-border/40 bg-card p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {job.title} · {job.employer}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {daysQuiet} days quiet · {followUpCount}/2 follow-ups ·
                    deadline {job.deadline ?? "—"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleDraft(job.id)}
                  >
                    Draft
                  </Button>
                </div>
              </div>
              {draft && (
                <div className="space-y-2">
                  <Textarea
                    value={draft.draft}
                    rows={4}
                    className="font-mono text-xs"
                    onChange={(e) =>
                      setDrafts((m) => ({
                        ...m,
                        [job.id]: { ...m[job.id]!, draft: e.target.value },
                      }))
                    }
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await navigator.clipboard.writeText(draft.draft);
                        toast.success("Copied to clipboard.");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Copy
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleLog(job.id)}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />
                      Log as sent
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
