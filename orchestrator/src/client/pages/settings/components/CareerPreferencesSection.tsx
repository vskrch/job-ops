import * as api from "@client/api";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { ProfileLanguage, StarExample } from "@shared/types";
import { Loader2, Plus, Save, Star, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type CareerPreferencesSectionProps = {
  layoutMode?: "accordion" | "panel";
};

const LANGUAGE_LEVEL_SUGGESTIONS = [
  "native",
  "fluent",
  "professional",
  "conversational",
  "basic",
];

function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function listToLines(list: string[]): string {
  return list.join("\n");
}

interface SectionState {
  languageLevels: ProfileLanguage[];
  dealBreakers: string;
  careerGoals: string;
  behavioralNotes: string;
  starExamples: StarExample[];
}

const EMPTY_STATE: SectionState = {
  languageLevels: [],
  dealBreakers: "",
  careerGoals: "",
  behavioralNotes: "",
  starExamples: [],
};

let starDraftCounter = 0;
function nextStarId(): string {
  starDraftCounter += 1;
  return `star-draft-${Date.now()}-${starDraftCounter}`;
}

const EMPTY_STAR: Omit<StarExample, "id"> = {
  title: "",
  useFor: [],
  situation: "",
  task: "",
  action: "",
  result: "",
};

/**
 * Career preferences — languages with proficiency levels, deal-breakers,
 * career goals, behavioral notes, and the STAR interview story bank. These
 * fields feed scoring gates (Language Gate), fit evaluation, and interview
 * prep; they are stored on the uploaded profile but are never overwritten by
 * resume re-uploads.
 */
export const CareerPreferencesSection: React.FC<
  CareerPreferencesSectionProps
> = ({ layoutMode }) => {
  const [state, setState] = useState<SectionState>(EMPTY_STATE);
  const [hasProfile, setHasProfile] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getUserProfile()
      .then(({ profile }) => {
        if (cancelled) return;
        setHasProfile(true);
        setState({
          languageLevels: profile.languageLevels,
          dealBreakers: listToLines(profile.dealBreakers),
          careerGoals: listToLines(profile.careerGoals),
          behavioralNotes: profile.behavioralNotes ?? "",
          starExamples: profile.starExamples,
        });
      })
      .catch(() => {
        // 404 = no resume uploaded yet; the section shows a hint instead.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchLanguages = useCallback(
    (index: number, patch: Partial<ProfileLanguage>) => {
      setState((s) => ({
        ...s,
        languageLevels: s.languageLevels.map((entry, i) =>
          i === index ? { ...entry, ...patch } : entry,
        ),
      }));
    },
    [],
  );

  const patchStar = useCallback(
    (index: number, patch: Partial<StarExample>) => {
      setState((s) => ({
        ...s,
        starExamples: s.starExamples.map((entry, i) =>
          i === index ? { ...entry, ...patch } : entry,
        ),
      }));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const { profile } = await api.updateProfilePreferences({
        languageLevels: state.languageLevels
          .map((l) => ({ name: l.name.trim(), level: l.level?.trim() || null }))
          .filter((l) => l.name.length > 0),
        dealBreakers: linesToList(state.dealBreakers),
        careerGoals: linesToList(state.careerGoals),
        behavioralNotes: state.behavioralNotes.trim() || null,
        starExamples: state.starExamples.filter(
          (s) => s.title.trim().length > 0,
        ),
      });
      setState({
        languageLevels: profile.languageLevels,
        dealBreakers: listToLines(profile.dealBreakers),
        careerGoals: listToLines(profile.careerGoals),
        behavioralNotes: profile.behavioralNotes ?? "",
        starExamples: profile.starExamples,
      });
      toast.success("Career preferences saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save preferences.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [state]);

  return (
    <SettingsSectionFrame
      mode={layoutMode}
      title="Career preferences"
      value="career-preferences"
    >
      <p className="text-xs text-muted-foreground mb-2">
        Language proficiency, deal-breakers, goals, and interview stories. These
        feed job scoring&apos;s language gate and fit evaluation, plus interview
        prep.
      </p>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !hasProfile ? (
        <p className="text-sm text-muted-foreground">
          Upload a resume above first — preferences are stored on your profile
          and survive re-uploads.
        </p>
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">Languages you work in</p>
            <p className="text-xs text-muted-foreground">
              A posting requiring a language not listed here is excluded by the
              scoring Language Gate; a posting asking for a higher level than
              yours is flagged for your judgment instead of silently dropped.
            </p>
            {state.languageLevels.map((entry, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: list is user-ordered, items have no stable id
              <div key={`lang-${index}`} className="flex items-center gap-2">
                <Input
                  value={entry.name}
                  placeholder="Language (e.g. German)"
                  onChange={(e) =>
                    patchLanguages(index, { name: e.target.value })
                  }
                  className="max-w-48"
                />
                <Input
                  value={entry.level ?? ""}
                  placeholder={`Level (${LANGUAGE_LEVEL_SUGGESTIONS.join(", ")}, B2…)`}
                  onChange={(e) =>
                    patchLanguages(index, { level: e.target.value })
                  }
                  className="max-w-56"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove language"
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      languageLevels: s.languageLevels.filter(
                        (_, i) => i !== index,
                      ),
                    }))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  languageLevels: [
                    ...s.languageLevels,
                    { name: "", level: "" },
                  ],
                }))
              }
            >
              <Plus className="h-4 w-4 mr-1" /> Add language
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">Deal-breakers</p>
            <p className="text-xs text-muted-foreground">
              One per line. A posting that hits one is vetoed regardless of
              score (e.g. "requires security clearance", "no on-call").
            </p>
            <Textarea
              value={state.dealBreakers}
              onChange={(e) =>
                setState((s) => ({ ...s, dealBreakers: e.target.value }))
              }
              rows={3}
              placeholder={"no on-call\nrequires security clearance"}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Career goals</p>
            <p className="text-xs text-muted-foreground">
              One per line. Used by the career-alignment scoring dimension.
            </p>
            <Textarea
              value={state.careerGoals}
              onChange={(e) =>
                setState((s) => ({ ...s, careerGoals: e.target.value }))
              }
              rows={3}
              placeholder={"staff engineer track\nmove into platform work"}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Behavioral notes</p>
            <p className="text-xs text-muted-foreground">
              What energizes you, what drains you, how you work best. Used by
              fit scoring and interview coaching.
            </p>
            <Textarea
              value={state.behavioralNotes}
              onChange={(e) =>
                setState((s) => ({ ...s, behavioralNotes: e.target.value }))
              }
              rows={3}
              placeholder="Thrives in small senior teams; drained by hand-holding and status meetings."
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Star className="h-4 w-4" /> STAR interview stories
            </p>
            <p className="text-xs text-muted-foreground">
              Situation / Task / Action / Result stories from your real
              experience. Interview prep maps them onto likely questions via the
              "use for" tags.
            </p>
            {state.starExamples.map((entry, index) => (
              <div
                key={entry.id}
                className="rounded-md border border-border/60 p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={entry.title}
                    placeholder="Story title"
                    onChange={(e) =>
                      patchStar(index, { title: e.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove story"
                    onClick={() =>
                      setState((s) => ({
                        ...s,
                        starExamples: s.starExamples.filter(
                          (_, i) => i !== index,
                        ),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Input
                  value={entry.useFor.join(", ")}
                  placeholder="Use for: ownership, failure, conflict…"
                  onChange={(e) =>
                    patchStar(index, {
                      useFor: e.target.value
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <Textarea
                  value={entry.situation}
                  placeholder="Situation"
                  rows={2}
                  onChange={(e) =>
                    patchStar(index, { situation: e.target.value })
                  }
                />
                <Textarea
                  value={entry.task}
                  placeholder="Task"
                  rows={2}
                  onChange={(e) => patchStar(index, { task: e.target.value })}
                />
                <Textarea
                  value={entry.action}
                  placeholder="Action"
                  rows={2}
                  onChange={(e) => patchStar(index, { action: e.target.value })}
                />
                <Textarea
                  value={entry.result}
                  placeholder="Result"
                  rows={2}
                  onChange={(e) => patchStar(index, { result: e.target.value })}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  starExamples: [
                    ...s.starExamples,
                    { ...EMPTY_STAR, id: nextStarId() },
                  ],
                }))
              }
            >
              <Plus className="h-4 w-4 mr-1" /> Add story
            </Button>
          </div>

          <Separator />

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save preferences
            </Button>
          </div>
        </div>
      )}
    </SettingsSectionFrame>
  );
};
