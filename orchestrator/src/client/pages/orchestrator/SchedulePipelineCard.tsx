/**
 * Scheduled pipeline configuration card.
 *
 * Lets users set an overnight schedule (UTC hour) instead of only running the
 * pipeline ad-hoc. Reads/writes /api/pipeline/schedule. Displays the next run
 * time when enabled.
 */

import * as api from "@client/api";
import type { JobSource } from "@shared/types";
import { CalendarClock, Loader2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { sourceLabel } from "@/lib/utils";

interface SchedulePipelineCardProps {
  /** Sources currently selected for the pipeline (copied into the schedule). */
  pipelineSources: JobSource[];
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);

function formatNextRun(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const SchedulePipelineCard: React.FC<SchedulePipelineCardProps> = ({
  pipelineSources,
}) => {
  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState(2);
  const [sources, setSources] = useState<JobSource[]>([]);
  const [nextRun, setNextRun] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSchedule = useCallback(async () => {
    try {
      const schedule = await api.getPipelineSchedule();
      setEnabled(schedule.enabled);
      setHour(schedule.hour);
      setSources(schedule.sources);
      setNextRun(schedule.nextRun);
    } catch {
      // Scheduler endpoint unavailable: keep defaults.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      const schedule = await api.updatePipelineSchedule({
        enabled,
        hour,
        sources,
      });
      setEnabled(schedule.enabled);
      setNextRun(schedule.nextRun);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setIsSaving(false);
    }
  }, [enabled, hour, sources]);

  const hourLabel = useMemo(
    () => `${String(hour).padStart(2, "0")}:00 UTC (${formatNextRun(nextRun)})`,
    [hour, nextRun],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Overnight schedule
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="schedule-enabled">Run on schedule</Label>
            <p className="text-xs text-muted-foreground">
              Run the scan automatically at a set time instead of only on
              demand.
            </p>
          </div>
          <Switch
            id="schedule-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={isLoading}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="schedule-hour">Start time (UTC)</Label>
            <Select
              value={String(hour)}
              onValueChange={(value) => setHour(Number(value))}
              disabled={!enabled || isLoading}
            >
              <SelectTrigger id="schedule-hour" className="w-full">
                <SelectValue placeholder="Select hour" />
              </SelectTrigger>
              <SelectContent>
                {HOUR_OPTIONS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {String(h).padStart(2, "0")}:00 UTC
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <p className="w-full rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {enabled ? (
                <>
                  Next run: <span className="font-medium">{hourLabel}</span>
                </>
              ) : (
                "Scheduling disabled"
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {sources.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No sources saved — will use defaults.
            </span>
          ) : (
            sources.map((source) => (
              <span
                key={source}
                className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-xs"
              >
                {sourceLabel[source]}
              </span>
            ))
          )}
          {pipelineSources.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setSources(pipelineSources)}
              disabled={!enabled}
            >
              Use current sources ({pipelineSources.length})
            </Button>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          type="button"
          size="sm"
          className="gap-2"
          onClick={() => void handleSave()}
          disabled={isLoading || isSaving}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CalendarClock className="h-4 w-4" />
          )}
          Save schedule
        </Button>
      </CardContent>
    </Card>
  );
};
