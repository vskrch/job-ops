import * as api from "@client/api";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { PipelineSchedule } from "@shared/types";
import { CalendarClock, Play } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SchedulePipelineCard } from "@/client/pages/orchestrator/SchedulePipelineCard";

type PipelineScheduleSettingsSectionProps = {
  layoutMode?: "accordion" | "panel";
};

function formatNextRun(nextRun: string | null): string {
  if (!nextRun) return "Not scheduled";
  const date = new Date(nextRun);
  return date.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}

export const PipelineScheduleSettingsSection: React.FC<
  PipelineScheduleSettingsSectionProps
> = ({ layoutMode }) => {
  const [schedules, setSchedules] = useState<PipelineSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getPipelineSchedules()
      .then((data) => {
        if (cancelled) return;
        setSchedules(data);
      })
      .catch((error) => {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load pipeline schedules";
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRunNow = useCallback(async () => {
    setIsRunning(true);
    try {
      await api.runPipeline();
      toast.success("Pipeline run started");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start pipeline run";
      toast.error(message);
    } finally {
      setIsRunning(false);
    }
  }, []);

  const enabledCount = schedules.filter((s) => s.enabled).length;
  const nextRun = schedules
    .filter((s) => s.enabled && s.nextRun)
    .map((s) => s.nextRun as string)
    .sort()[0];

  return (
    <SettingsSectionFrame
      mode={layoutMode}
      title="Pipeline Schedules"
      value="pipeline-schedule"
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunNow}
            disabled={isLoading || isRunning}
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            {isRunning ? "Starting..." : "Run now"}
          </Button>
          <Badge variant={enabledCount > 0 ? "default" : "secondary"} className="text-xs">
            {enabledCount} active {enabledCount === 1 ? "schedule" : "schedules"}
          </Badge>
          {nextRun && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarClock className="h-4 w-4" />
              <span>Next: {formatNextRun(nextRun)}</span>
            </div>
          )}
        </div>

        <SchedulePipelineCard pipelineSources={[]} />

        <p className="text-xs text-muted-foreground">
          Each schedule runs the full job discovery pipeline daily at its
          configured UTC hour. If the server was asleep or offline at the
          scheduled time, the missed run catches up on the next startup.
        </p>
      </div>
    </SettingsSectionFrame>
  );
};