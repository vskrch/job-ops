/**
 * Scheduled search card.
 *
 * Lets users create and manage recurring natural-language job searches.
 * Each schedule has its own label, enabled flag, frequency (hourly/daily),
 * UTC hour (daily), minute offset (hourly), the NL query, and notification
 * toggles (email / webhook + Telegram). Reads/writes /api/search-schedules.
 */

import * as api from "@client/api";
import type { CreateSearchScheduleInput, SearchSchedule } from "@shared/types";
import {
  BellRing,
  CalendarClock,
  Loader2,
  Play,
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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) => minute);

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

function formatLastRun(
  iso: string | null,
  resultsCount: number | null,
): string {
  if (!iso) return "Never run";
  const date = new Date(iso);
  const when = Number.isNaN(date.getTime())
    ? "Unknown time"
    : date.toLocaleString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
  return `${when} · ${resultsCount ?? 0} jobs found`;
}

interface SearchScheduleEditorProps {
  schedule: SearchSchedule | null;
  onSave: (input: CreateSearchScheduleInput) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

const SearchScheduleEditor: React.FC<SearchScheduleEditorProps> = ({
  schedule,
  onSave,
  onCancel,
  isSaving,
}) => {
  const [label, setLabel] = useState(schedule?.label ?? "");
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [frequency, setFrequency] = useState(schedule?.frequency ?? "daily");
  const [hour, setHour] = useState(schedule?.hour ?? 8);
  const [minute, setMinute] = useState(schedule?.minute ?? 0);
  const [query, setQuery] = useState(schedule?.query ?? "");
  const [notifyEmail, setNotifyEmail] = useState(schedule?.notifyEmail ?? true);
  const [notifyWebhook, setNotifyWebhook] = useState(
    schedule?.notifyWebhook ?? true,
  );

  const handleSave = async () => {
    if (!query.trim()) {
      toast.error(
        "Enter a search query (e.g. Senior Python developer in Toronto, remote)",
      );
      return;
    }
    await onSave({
      label: label.trim() || "Scheduled search",
      enabled,
      frequency,
      ...(frequency === "daily" ? { hour } : { hour: null, minute }),
      query: query.trim(),
      notifyEmail,
      notifyWebhook,
    });
  };

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="space-y-2">
        <Label htmlFor="search-schedule-label">Label</Label>
        <Input
          id="search-schedule-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Morning Toronto scan"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="search-schedule-query">Search query</Label>
        <Input
          id="search-schedule-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Senior Python developer jobs in Toronto, remote, last 24 hours"
        />
        <p className="text-xs text-muted-foreground">
          Free-text natural-language query — parsed like the Job Search box.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="search-schedule-enabled">Enabled</Label>
          <p className="text-xs text-muted-foreground">
            Run this search automatically.
          </p>
        </div>
        <Switch
          id="search-schedule-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="search-schedule-frequency">Frequency</Label>
          <Select
            value={frequency}
            onValueChange={(value) => setFrequency(value as "hourly" | "daily")}
          >
            <SelectTrigger id="search-schedule-frequency" className="w-full">
              <SelectValue placeholder="Select frequency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="hourly">Hourly</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {frequency === "daily" ? (
          <div className="space-y-2">
            <Label htmlFor="search-schedule-hour">Run time (UTC)</Label>
            <Select
              value={String(hour)}
              onValueChange={(value) => setHour(Number(value))}
            >
              <SelectTrigger id="search-schedule-hour" className="w-full">
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
        ) : (
          <div className="space-y-2">
            <Label htmlFor="search-schedule-minute">Minute offset (UTC)</Label>
            <Select
              value={String(minute)}
              onValueChange={(value) => setMinute(Number(value))}
            >
              <SelectTrigger id="search-schedule-minute" className="w-full">
                <SelectValue placeholder="Select minute" />
              </SelectTrigger>
              <SelectContent>
                {MINUTE_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    :{String(m).padStart(2, "0")} past the hour
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="search-schedule-email"
            checked={notifyEmail}
            onCheckedChange={(checked) => setNotifyEmail(checked === true)}
          />
          <Label
            htmlFor="search-schedule-email"
            className="cursor-pointer text-sm"
          >
            Email results
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="search-schedule-webhook"
            checked={notifyWebhook}
            onCheckedChange={(checked) => setNotifyWebhook(checked === true)}
          />
          <Label
            htmlFor="search-schedule-webhook"
            className="cursor-pointer text-sm"
          >
            Webhook / Telegram
          </Label>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Notifications go to the search webhook URL (or Telegram bot) and email
        when configured in Settings → Accounts &amp; Access.
      </p>

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

export const SearchSchedulesCard: React.FC = () => {
  const [schedules, setSchedules] = useState<SearchSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunningId, setIsRunningId] = useState<string | null>(null);
  const [showNewEditor, setShowNewEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
    try {
      const data = await api.getSearchSchedules();
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

  const handleCreate = useCallback(async (input: CreateSearchScheduleInput) => {
    setIsSaving(true);
    try {
      const updated = await api.createSearchSchedule(input);
      setSchedules(updated);
      setShowNewEditor(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create schedule",
      );
    } finally {
      setIsSaving(false);
    }
  }, []);

  const handleUpdate = useCallback(
    async (id: string, input: CreateSearchScheduleInput) => {
      setIsSaving(true);
      try {
        const updated = await api.updateSearchSchedule(id, input);
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
    const confirmed = window.confirm(
      "Delete this search schedule? This action cannot be undone.",
    );
    if (!confirmed) return;
    try {
      const updated = await api.deleteSearchSchedule(id);
      setSchedules(updated);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete schedule",
      );
    }
  }, []);

  const handleRunNow = useCallback(
    async (id: string) => {
      setIsRunningId(id);
      try {
        const result = await api.runSearchScheduleNow(id);
        toast.success(
          result.resultsCount != null
            ? `Search complete: ${result.resultsCount} jobs found`
            : "Search started — results will be available shortly",
        );
        await loadSchedules();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to run search",
        );
      } finally {
        setIsRunningId(null);
      }
    },
    [loadSchedules],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-4 w-4 text-muted-foreground" />
          Scheduled searches
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
                No scheduled searches configured. Create one to scan for new
                jobs automatically and get notified when matches appear.
              </p>
            )}

            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="space-y-2 rounded-lg border border-border/60 p-3"
              >
                {editingId === schedule.id ? (
                  <SearchScheduleEditor
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
                          {schedule.frequency === "daily"
                            ? `${String(schedule.hour).padStart(2, "0")}:00 UTC daily`
                            : `Hourly at :${String(schedule.minute).padStart(2, "0")}`}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${schedule.enabled ? "bg-primary/10 text-primary" : "bg-muted/40 text-muted-foreground"}`}
                        >
                          {schedule.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <p className="text-sm text-foreground/90">
                        {schedule.query}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last run:{" "}
                        {formatLastRun(
                          schedule.lastRunAt,
                          schedule.lastResultsCount,
                        )}
                        {schedule.enabled && schedule.nextRun
                          ? ` · Next: ${formatNextRun(schedule.nextRun)}`
                          : ""}
                      </p>
                      {(schedule.notifyEmail || schedule.notifyWebhook) && (
                        <p className="text-xs text-muted-foreground">
                          Notify:{" "}
                          {[
                            schedule.notifyEmail ? "Email" : null,
                            schedule.notifyWebhook
                              ? "Webhook / Telegram"
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="Run now"
                        onClick={() => void handleRunNow(schedule.id)}
                        disabled={isRunningId === schedule.id}
                      >
                        {isRunningId === schedule.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={(checked) =>
                          void handleUpdate(schedule.id, {
                            ...schedule,
                            enabled: checked,
                          })
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
              <SearchScheduleEditor
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
                Add scheduled search
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
