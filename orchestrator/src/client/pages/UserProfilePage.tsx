import * as api from "@client/api";
import { PageHeader, PageMain } from "@client/components/layout";
import { useAuth } from "@client/context/AuthContext";
import type { UserStats } from "@shared/types";
import {
  Briefcase,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  KeyRound,
  Layers,
  Loader2,
  LogOut,
  Search,
  Send,
  Shield,
  Sparkles,
  User,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const UserProfilePage: React.FC = () => {
  const { user, updateProfile, logout } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [stats, setStats] = useState<UserStats | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setEmail(user.email ?? "");
    }
  }, [user]);

  const loadStats = useCallback(async () => {
    try {
      setIsStatsLoading(true);
      const res = await api.getUserStats();
      setStats(res.stats);
    } catch {
      // Best-effort stats load
    } finally {
      setIsStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileMessage(null);
    setIsUpdatingProfile(true);
    try {
      await updateProfile({
        name: name.trim(),
        email: email.trim() !== user?.email ? email.trim() : undefined,
      });
      setProfileMessage("Profile details updated successfully.");
      toast.success("Profile updated");
    } catch (err) {
      setProfileError(
        err instanceof Error ? err.message : "Failed to update profile.",
      );
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);

    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    setIsChangingPassword(true);
    try {
      await api.changeUserPassword({ currentPassword, newPassword });
      setPasswordMessage("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed successfully");
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "Failed to change password.",
      );
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleCopyUserId = () => {
    if (!user?.id) return;
    navigator.clipboard.writeText(user.id);
    toast.success("User ID copied to clipboard");
  };

  return (
    <>
      <PageHeader
        icon={User}
        title="Account & Profile"
        subtitle="Manage your credentials, preferences, and multi-user workspace"
      />
      <PageMain>
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Top Banner / User Greeting */}
          <Card className="border-border/60 bg-gradient-to-r from-primary/10 via-background to-background">
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/20 text-xl font-bold text-primary shadow-sm">
                    {user?.name
                      ? user.name.charAt(0).toUpperCase()
                      : user?.email
                        ? user.email.charAt(0).toUpperCase()
                        : "U"}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">
                      {user?.name || "JobOps User"}
                    </h2>
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      {user?.email || "Anonymous default user"}
                      {user ? (
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-mono"
                        >
                          Multi-User Account
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Single-User (Default)
                        </Badge>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {user ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        await logout();
                        navigate("/login");
                      }}
                      className="gap-2"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </Button>
                  ) : (
                    <Button asChild size="sm" className="gap-2">
                      <Link to="/login">Sign in / Register</Link>
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Workspace Statistics & Isolation Metrics */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                Workspace Isolation & Activity
              </h3>
              <span className="text-xs text-muted-foreground">
                Scoped to your active account
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Card className="border-border/60">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-foreground">
                    {isStatsLoading ? "..." : (stats?.totalJobs ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <Briefcase className="h-3 w-3" />
                    Total Jobs
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-primary">
                    {isStatsLoading ? "..." : (stats?.readyJobs ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <FileText className="h-3 w-3" />
                    Ready (PDFs)
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {isStatsLoading ? "..." : (stats?.appliedJobs ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <Send className="h-3 w-3" />
                    Applied
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                    {isStatsLoading ? "..." : (stats?.inProgressJobs ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <Sparkles className="h-3 w-3" />
                    In Progress
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-foreground">
                    {isStatsLoading ? "..." : (stats?.totalPipelineRuns ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <Layers className="h-3 w-3" />
                    Pipeline Runs
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-foreground">
                    {isStatsLoading ? "..." : (stats?.totalSearches ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <Search className="h-3 w-3" />
                    Searches
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Account Details & Profile Edit */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Profile Info Form */}
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  Personal Information
                </CardTitle>
                <CardDescription>
                  Update your display name and email address.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {user ? (
                  <form onSubmit={handleUpdateProfile} className="space-y-4">
                    {profileError && (
                      <Alert variant="destructive">
                        <AlertDescription>{profileError}</AlertDescription>
                      </Alert>
                    )}
                    {profileMessage && (
                      <Alert className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <AlertDescription className="text-xs">
                          {profileMessage}
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="profile-name">Full Name</Label>
                      <Input
                        id="profile-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your full name"
                        disabled={isUpdatingProfile}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-email">Email Address</Label>
                      <Input
                        id="profile-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        disabled={isUpdatingProfile}
                      />
                    </div>

                    <div className="rounded-md bg-muted/40 p-3 space-y-1 text-xs">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>User UUID:</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCopyUserId}
                          className="h-6 px-1.5 text-[11px] gap-1"
                        >
                          <Copy className="h-3 w-3" />
                          Copy
                        </Button>
                      </div>
                      <div className="font-mono text-[11px] break-all text-foreground">
                        {user.id}
                      </div>
                      {user.createdAt && (
                        <div className="text-muted-foreground pt-1">
                          Member since{" "}
                          {new Date(user.createdAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>

                    <Button type="submit" disabled={isUpdatingProfile}>
                      {isUpdatingProfile ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving changes...
                        </>
                      ) : (
                        "Save Profile Changes"
                      )}
                    </Button>
                  </form>
                ) : (
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>
                      You are currently browsing as the{" "}
                      <strong>anonymous default user</strong>.
                    </p>
                    <p>
                      Create an account or sign in to save distinct multi-user
                      job searches, resume profiles, and application stages.
                    </p>
                    <div className="flex gap-2 pt-2">
                      <Button asChild size="sm">
                        <Link to="/register">Create Account</Link>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <Link to="/login">Sign In</Link>
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Change Password Card */}
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  Security & Password
                </CardTitle>
                <CardDescription>
                  Change your password to keep your account secure.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {user ? (
                  <form onSubmit={handleChangePassword} className="space-y-4">
                    {passwordError && (
                      <Alert variant="destructive">
                        <AlertDescription>{passwordError}</AlertDescription>
                      </Alert>
                    )}
                    {passwordMessage && (
                      <Alert className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <AlertDescription className="text-xs">
                          {passwordMessage}
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="current-password">Current Password</Label>
                      <Input
                        id="current-password"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter your current password"
                        required
                        disabled={isChangingPassword}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="account-new-password">New Password</Label>
                      <Input
                        id="account-new-password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 6 characters"
                        required
                        disabled={isChangingPassword}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="account-confirm-password">
                        Confirm New Password
                      </Label>
                      <Input
                        id="account-confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        required
                        disabled={isChangingPassword}
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={
                        isChangingPassword || !currentPassword || !newPassword
                      }
                    >
                      {isChangingPassword ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Updating password...
                        </>
                      ) : (
                        "Update Password"
                      )}
                    </Button>
                  </form>
                ) : (
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>
                      Password management is available when logged into a
                      registered account.
                    </p>
                    <Button asChild variant="outline" size="sm">
                      <Link to="/forgot-password">
                        <KeyRound className="mr-2 h-4 w-4" />
                        Forgot Password Flow
                      </Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Hub Navigation */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Quick Links & Workspaces
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <Button
                  asChild
                  variant="outline"
                  className="justify-between h-auto py-3"
                >
                  <Link to="/jobs/ready">
                    <span className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-primary" />
                      Orchestrator Pipeline
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="justify-between h-auto py-3"
                >
                  <Link to="/design-resume">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      Resume & PDF Design
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="justify-between h-auto py-3"
                >
                  <Link to="/settings">
                    <span className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" />
                      App Settings
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageMain>
    </>
  );
};
