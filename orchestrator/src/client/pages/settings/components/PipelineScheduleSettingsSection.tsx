import * as api from "@client/api";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import {
  EXTRACTOR_SOURCE_METADATA,
  PIPELINE_EXTRACTOR_SOURCE_IDS,
} from "@shared/extractors";
import type { PipelineScheduleResponse } from "@shared/types";
import { CalendarClock, Play } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PIPELINE_SOURCES: readonly string[] = [...PIPELINE_EXTRACTOR_SOURCE_IDS];

function sourceLabel(source: string): string {
  return (
    EXTRACTOR_SOURCE_METADATA[source as keyof typeof EXTRACTOR_SOURCE_METADATA]
      ?.label ?? source
  );
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

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

type PipelineScheduleSettingsSectionProps = {
  layoutMode?: "accordion" | "panel";
};

export const PipelineScheduleSettingsSection: React.FC<
  PipelineScheduleSettingsSectionProps
> = ({ layoutMode }) => {
  const [schedule, setSchedule] = useState<PipelineScheduleResponse | null>(
    null,
  );
  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState(2);
  const [sources, setSources] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getPipelineSchedule()
      .then((data) => {
        if (cancelled) return;
        setSchedule(data);
        setEnabled(data.enabled);
        setHour(data.hour);
        setSources(data.sources as string[]);
      })
      .catch((error) => {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load pipeline schedule";
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const updated = await api.updatePipelineSchedule({
        enabled,
        hour,
        sources: sources as unknown as Parameters<
          typeof api.updatePipelineSchedule
        >[0]["sources"],
      });
      setSchedule(updated);
      toast.success("Pipeline schedule saved");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save pipeline schedule";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }, [enabled, hour, sources]);

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

  const toggleSource = (source: string, checked: boolean) => {
    setSources((current) =>
      checked
        ? [...current, source]
        : current.filter((item) => item !== source),
    );
  };

  return (
    <SettingsSectionFrame
      mode={layoutMode}
      title="Pipeline Schedule"
      value="pipeline-schedule"
    >
      <div className="space-y-6">
        <div className="flex items-start space-x-3">
          <Checkbox
            id="pipelineScheduleEnabled"
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked === true)}
            disabled={isLoading || isSaving}
          />
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="pipelineScheduleEnabled"
              className="cursor-pointer text-sm font-medium leading-none"
            >
              Enable scheduled pipeline runs
            </Label>
            <p className="text-xs text-muted-foreground">
              Runs the full job discovery pipeline daily at the configured hour
              (UTC). If the server was asleep or offline at the scheduled time,
              the missed run catches up on the next startup.
            </p>
          </div>
        </div>

        {enabled && (
          <div className="space-y-6 pl-7">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pipelineScheduleHour" className="text-sm">
                  Run hour (UTC)
                </Label>
                <Select
                  value={String(hour)}
                  onValueChange={(value) => setHour(Number.parseInt(value, 10))}
                  disabled={isLoading || isSaving}
                >
                  <SelectTrigger id="pipelineScheduleHour" className="w-full">
                    <SelectValue placeholder="Select hour" />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h.toString().padStart(2, "0")}:00 UTC
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Sources</div>
              <p className="text-xs text-muted-foreground">
                Leave all unchecked to run every available source.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {PIPELINE_SOURCES.map((source) => (
                  <div key={source} className="flex items-center space-x-2">
                    <Checkbox
                      id={`pipeline-source-${source}`}
                      checked={sources.includes(source)}
                      onCheckedChange={(checked) =>
                        toggleSource(source, checked === true)
                      }
                      disabled={isLoading || isSaving}
                    />
                    <Label
                      htmlFor={`pipeline-source-${source}`}
                      className="cursor-pointer text-sm"
                    >
                      {sourceLabel(source)}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {enabled && schedule?.nextRun && (
          <div className="flex items-center gap-2 pl-7 text-sm text-muted-foreground">
            <CalendarClock className="h-4 w-4" />
            <span>Next scheduled run: {formatNextRun(schedule.nextRun)}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pl-7">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isLoading || isSaving}
          >
            {isSaving ? "Saving..." : "Save schedule"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunNow}
            disabled={isLoading || isRunning}
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            {isRunning ? "Starting..." : "Run now"}
          </Button>
          <Badge
            variant={enabled ? "default" : "secondary"}
            className="text-xs"
          >
            {enabled ? "Scheduled" : "Disabled"}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Note: on sleeping hobby dynos, timers only fire while the server is
          awake. A periodic ping (e.g. an uptime monitor hitting{" "}
          <code className="rounded bg-muted px-1">/health</code>) wakes the dyno
          so the missed-run catch-up can fire, or use the Heroku Scheduler
          add-on with{" "}
          <code className="rounded bg-muted px-1">pipeline:run</code>.
        </p>
      </div>
    </SettingsSectionFrame>
  );
};
