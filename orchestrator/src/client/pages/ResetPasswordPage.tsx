import * as api from "@client/api";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

export const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get("token") || "";
  const [token, setToken] = useState(urlToken);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isVerifying, setIsVerifying] = useState(Boolean(urlToken));
  const [isTokenValid, setIsTokenValid] = useState<boolean | null>(null);
  const [tokenEmail, setTokenEmail] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!urlToken) return;
    let active = true;
    setIsVerifying(true);
    setError(null);
    api
      .verifyResetToken(urlToken)
      .then((res) => {
        if (!active) return;
        setIsTokenValid(res.valid);
        setTokenEmail(res.email ?? null);
      })
      .catch((err) => {
        if (!active) return;
        setIsTokenValid(false);
        setError(
          err instanceof Error
            ? err.message
            : "Invalid or expired reset token.",
        );
      })
      .finally(() => {
        if (active) setIsVerifying(false);
      });
    return () => {
      active = false;
    };
  }, [urlToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanToken = token.trim();
    if (!cleanToken) {
      setError("Please provide a valid password reset token.");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.resetPassword(cleanToken, newPassword);
      setIsSuccess(true);
      toast.success(
        "Password reset successfully. Please sign in with your new password.",
      );
      setTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reset password.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md border-border/60 shadow-xl">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Create new password
          </CardTitle>
          <CardDescription className="text-sm">
            {tokenEmail
              ? `Resetting password for ${tokenEmail}`
              : "Enter your secure token and choose a new password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isVerifying && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Verifying reset token...
            </div>
          )}

          {isSuccess ? (
            <div className="space-y-4 text-center">
              <Alert className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <AlertTitle className="font-semibold">
                  Password updated!
                </AlertTitle>
                <AlertDescription className="text-xs">
                  Your password has been changed successfully. Redirecting you
                  to sign in...
                </AlertDescription>
              </Alert>

              <Button asChild className="w-full">
                <Link to="/login">Sign in now</Link>
              </Button>
            </div>
          ) : (
            !isVerifying && (
              <form onSubmit={handleSubmit} className="space-y-4">
                {!urlToken && (
                  <div className="space-y-2">
                    <Label htmlFor="token">Reset Token</Label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="token"
                        type="text"
                        placeholder="Paste your 64-character token"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        required
                        className="pl-9 font-mono text-xs"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="new-password"
                      type="password"
                      placeholder="At least 6 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      className="pl-9"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirm-password"
                      type="password"
                      placeholder="Re-enter your new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="pl-9"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={
                    isSubmitting ||
                    !newPassword ||
                    !confirmPassword ||
                    (urlToken ? isTokenValid === false : !token.trim())
                  }
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Resetting password...
                    </>
                  ) : (
                    "Set new password"
                  )}
                </Button>

                <div className="text-center text-sm">
                  <Link
                    to="/login"
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    Cancel and return to sign in
                  </Link>
                </div>
              </form>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
};
