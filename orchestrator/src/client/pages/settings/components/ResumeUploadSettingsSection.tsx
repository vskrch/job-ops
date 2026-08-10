import * as api from "@client/api";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { UserProfile } from "@shared/types";
import { FileUp, Loader2, Sparkles, Trash2, UserRound } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

type ResumeUploadSettingsSectionProps = {
  layoutMode?: "accordion" | "panel";
};

function formatProfileSummary(profile: UserProfile): string {
  const parts: string[] = [];
  if (profile.skills.length > 0) parts.push(`${profile.skills.length} skills`);
  if (profile.experience.length > 0)
    parts.push(`${profile.experience.length} experience entries`);
  if (profile.education.length > 0)
    parts.push(`${profile.education.length} education entries`);
  if (profile.languages.length > 0)
    parts.push(`${profile.languages.length} languages`);
  return parts.length > 0
    ? parts.join(" · ")
    : "No structured data extracted yet";
}

export const ResumeUploadSettingsSection: React.FC<
  ResumeUploadSettingsSectionProps
> = ({ layoutMode }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getUserProfile()
      .then((data) => {
        if (!cancelled) setProfile(data.profile);
      })
      .catch(() => {
        // 404 = nothing uploaded yet; keep the empty state.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFileChange = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported");
      return;
    }
    setIsUploading(true);
    try {
      const { profile: uploaded } = await api.uploadResumeProfile(file);
      setProfile(uploaded);
      toast.success("Resume uploaded and converted");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to upload resume";
      toast.error(message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const handleDelete = useCallback(async () => {
    const confirmed = window.confirm(
      "Delete your uploaded resume profile? Scoring and tailoring will fall back to your Design Resume or Reactive Resume.",
    );
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      await api.deleteUserProfile();
      setProfile(null);
      toast.success("Resume profile deleted");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete resume";
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  }, []);

  return (
    <SettingsSectionFrame mode={layoutMode} title="My Resume" value="my-resume">
      <div className="space-y-6">
        <div className="flex items-start space-x-3">
          <FileUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-1.5">
            <div className="text-sm font-medium">Upload your resume (PDF)</div>
            <p className="text-xs text-muted-foreground">
              Upload the resume you already use. JobOps extracts a structured
              profile and converts it to a base resume template that powers
              scoring, tailoring, and project selection — no Design Resume or
              Reactive Resume setup required.
            </p>
          </div>
        </div>

        <div className="pl-7">
          <Input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            disabled={isLoading || isUploading || isDeleting}
            onChange={(event) => void handleFileChange(event.target.files?.[0])}
            className="max-w-md"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            PDF only, up to 10 MB. Uploading replaces your previous profile.
          </p>
        </div>

        {isUploading && (
          <div className="flex items-center gap-2 pl-7 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Extracting and converting your resume…
          </div>
        )}

        <Separator />

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading profile…
          </div>
        ) : profile ? (
          <div className="space-y-4 pl-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">
                    {profile.fullName ?? "Unnamed profile"}
                  </span>
                  {profile.headline && (
                    <span className="truncate text-xs text-muted-foreground">
                      {profile.headline}
                    </span>
                  )}
                </div>
                {profile.email && (
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {profile.email}
                    {profile.location ? ` · ${profile.location}` : ""}
                  </div>
                )}
                <Badge variant="outline" className="mt-2 text-xs">
                  {formatProfileSummary(profile)}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                onClick={handleDelete}
                disabled={isDeleting || isUploading}
                aria-label="Delete uploaded resume"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {profile.skills.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  Extracted skills
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {profile.skills.slice(0, 24).map((skill) => (
                    <Badge key={skill} variant="secondary" className="text-xs">
                      {skill}
                    </Badge>
                  ))}
                  {profile.skills.length > 24 && (
                    <Badge variant="outline" className="text-xs">
                      +{profile.skills.length - 24} more
                    </Badge>
                  )}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              This profile is now your base resume: job scoring, tailoring, and
              job-search ranking blend it into their results. Delete it anytime
              to return to your Design Resume / Reactive Resume setup.
            </p>
          </div>
        ) : (
          <p className="pl-7 text-sm text-muted-foreground">
            No resume uploaded yet. Upload a PDF above to get started.
          </p>
        )}
      </div>
    </SettingsSectionFrame>
  );
};
