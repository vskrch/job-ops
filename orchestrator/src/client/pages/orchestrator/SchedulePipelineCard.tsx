/**
 * Scheduled pipeline configuration card.
 *
 * Lets users create and manage multiple daily schedules (UTC hour) for the
 * pipeline. Each schedule has its own label, enabled flag, hour, sources, and
 * optional advanced config (search terms, country, cities, workplace types,
 * topN, minSuitabilityScore). Reads/writes /api/pipeline/schedules.
 */

import * as api from "@client/api";
import {
  EXTRACTOR_SOURCE_METADATA,
  PIPELINE_EXTRACTOR_SOURCE_IDS,
} from "@shared/extractors";
import type { JobSource, PipelineSchedule } from "@shared/types";
import {
  CalendarClock,
  ChevronDown,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);
const PIPELINE_SOURCES: readonly string[] = [...PIPELINE_EXTRACTOR_SOURCE_IDS];

function getSourceLabel(source: string): string {
  return (
    EXTRACTOR_SOURCE_METADATA[source as keyof typeof EXTRACTOR_SOURCE_METADATA]
      ?.label ?? source
  );
}

function formatNextRun(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

interface ScheduleEditorProps {
  schedule: PipelineSchedule | null;
  onSave: (
    input: Omit<Parameters<typeof api.createPipelineSchedule>[0], never>,
  ) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

const ScheduleEditor: React.FC<ScheduleEditorProps> = ({
  schedule,
  onSave,
  onCancel,
  isSaving,
}) => {
  const [label, setLabel] = useState(schedule?.label ?? "");
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false);
  const [hour, setHour] = useState(schedule?.hour ?? 2);
  const [sources, setSources] = useState<string[]>(schedule?.sources ?? []);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [searchTerms, setSearchTerms] = useState(schedule?.searchTerms ?? []);
  const [country, setCountry] = useState(schedule?.country ?? "");
  const [cityLocations, setCityLocations] = useState(
    schedule?.cityLocations ?? [],
  );
  const [topN, setTopN] = useState<string>(
    schedule?.topN != null ? String(schedule.topN) : "",
  );
  const [minSuitabilityScore, setMinSuitabilityScore] = useState<string>(
    schedule?.minSuitabilityScore != null
      ? String(schedule.minSuitabilityScore)
      : "",
  );

  const toggleSource = (source: string, checked: boolean) => {
    setSources((current) =>
      checked
        ? [...current, source]
        : current.filter((item) => item !== source),
    );
  };

  const handleSave = async () => {
    await onSave({
      label: label.trim() || "Schedule",
      enabled,
      hour,
      sources: sources as JobSource[],
      ...(searchTerms && searchTerms.length > 0 ? { searchTerms } : {}),
      ...(country.trim() ? { country: country.trim() } : {}),
      ...(cityLocations && cityLocations.length > 0 ? { cityLocations } : {}),
      ...(topN ? { topN: Number(topN) } : {}),
      ...(minSuitabilityScore
        ? { minSuitabilityScore: Number(minSuitabilityScore) }
        : {}),
    });
  };

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="space-y-2">
        <Label htmlFor="schedule-label">Label</Label>
        <Input
          id="schedule-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Morning scan"
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="schedule-enabled">Enabled</Label>
          <p className="text-xs text-muted-foreground">
            Run this schedule automatically every day.
          </p>
        </div>
        <Switch
          id="schedule-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="schedule-hour">Start time (UTC)</Label>
        <Select
          value={String(hour)}
          onValueChange={(value) => setHour(Number(value))}
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

      <div className="space-y-2">
        <div className="text-sm font-medium">Sources</div>
        <p className="text-xs text-muted-foreground">
          Leave all unchecked to run every available source.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE_SOURCES.map((source) => (
            <div key={source} className="flex items-center space-x-2">
              <Checkbox
                id={`schedule-source-${source}`}
                checked={sources.includes(source)}
                onCheckedChange={(checked) =>
                  toggleSource(source, checked === true)
                }
              />
              <Label
                htmlFor={`schedule-source-${source}`}
                className="cursor-pointer text-sm"
              >
                {getSourceLabel(source)}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
        />
        Advanced settings
      </Button>

      {showAdvanced && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="schedule-topn">Top N (optional)</Label>
            <Input
              id="schedule-topn"
              type="number"
              min={1}
              max={50}
              value={topN}
              onChange={(e) => setTopN(e.target.value)}
              placeholder="Default"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="schedule-minscore">
              Min suitability (optional)
            </Label>
            <Input
              id="schedule-minscore"
              type="number"
              min={0}
              max={100}
              value={minSuitabilityScore}
              onChange={(e) => setMinSuitabilityScore(e.target.value)}
              placeholder="Default"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="schedule-country">Country (optional)</Label>
            <Input
              id="schedule-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="e.g. united kingdom"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="schedule-searchterms">
              Search terms (comma-separated)
            </Label>
            <Input
              id="schedule-searchterms"
              value={searchTerms.join(", ")}
              onChange={(e) =>
                setSearchTerms(
                  e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                )
              }
              placeholder="e.g. web developer, react"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="schedule-cities">Cities (comma-separated)</Label>
            <Input
              id="schedule-cities"
              value={cityLocations.join(", ")}
              onChange={(e) =>
                setCityLocations(
                  e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                )
              }
              placeholder="e.g. London, Manchester"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <CalendarClock className="mr-1 h-4 w-4" />
          )}
          Save schedule
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

interface SchedulePipelineCardProps {
  /** Sources currently selected for the pipeline (unused now; kept for API compat). */
  pipelineSources: JobSource[];
}

export const SchedulePipelineCard: React.FC<SchedulePipelineCardProps> = () => {
  const [schedules, setSchedules] = useState<PipelineSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showNewEditor, setShowNewEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
    try {
      const data = await api.getPipelineSchedules();
      setSchedules(data);
    } catch {
      // Schedules endpoint unavailable: keep empty.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const handleCreate = useCallback(
    async (input: Parameters<typeof api.createPipelineSchedule>[0]) => {
      setIsSaving(true);
      try {
        const updated = await api.createPipelineSchedule(input);
        setSchedules(updated);
        setShowNewEditor(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create schedule",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  const handleUpdate = useCallback(
    async (
      id: string,
      input: Parameters<typeof api.updatePipelineSchedule>[1],
    ) => {
      setIsSaving(true);
      try {
        const updated = await api.updatePipelineSchedule(id, input);
        setSchedules(updated);
        setEditingId(null);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update schedule",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  const handleDelete = useCallback(async (id: string) => {
    try {
      const updated = await api.deletePipelineSchedule(id);
      setSchedules(updated);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete schedule",
      );
    }
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Scheduled runs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading schedules...
          </div>
        ) : (
          <>
            {schedules.length === 0 && !showNewEditor && (
              <p className="text-sm text-muted-foreground">
                No schedules configured. Create one to run the pipeline
                automatically at a set time.
              </p>
            )}

            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="space-y-2 rounded-lg border border-border/60 p-3"
              >
                {editingId === schedule.id ? (
                  <ScheduleEditor
                    schedule={schedule}
                    onSave={async (input) => {
                      await handleUpdate(schedule.id, input);
                    }}
                    onCancel={() => setEditingId(null)}
                    isSaving={isSaving}
                  />
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">
                          {schedule.label}
                        </span>
                        <span className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-xs">
                          {String(schedule.hour).padStart(2, "0")}:00 UTC
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${schedule.enabled ? "bg-primary/10 text-primary" : "bg-muted/40 text-muted-foreground"}`}
                        >
                          {schedule.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {schedule.sources.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            All sources
                          </span>
                        ) : (
                          schedule.sources.map((source) => (
                            <span
                              key={source}
                              className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-xs"
                            >
                              {sourceLabel[source]}
                            </span>
                          ))
                        )}
                      </div>
                      {schedule.enabled && schedule.nextRun && (
                        <p className="text-xs text-muted-foreground">
                          Next run: {formatNextRun(schedule.nextRun)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={(checked) =>
                          void handleUpdate(schedule.id, { enabled: checked })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(schedule.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDelete(schedule.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {showNewEditor && (
              <ScheduleEditor
                schedule={null}
                onSave={handleCreate}
                onCancel={() => setShowNewEditor(false)}
                isSaving={isSaving}
              />
            )}

            {!showNewEditor && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setShowNewEditor(true)}
              >
                <Plus className="h-4 w-4" />
                Add schedule
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
