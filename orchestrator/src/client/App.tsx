/**
 * Main App component.
 */

import { X } from "lucide-react";
import React, { lazy, Suspense, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { CSSTransition, SwitchTransition } from "react-transition-group";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { BasicAuthPrompt } from "./components/BasicAuthPrompt";
import { OnboardingGate } from "./components/OnboardingGate";
import { useDemoInfo } from "./hooks/useDemoInfo";

const NotFoundPage: React.FC = () => (
  <main className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 py-12 text-center">
    <div className="text-5xl font-bold tracking-tight text-muted-foreground/60">
      404
    </div>
    <h1 className="text-xl font-semibold">Page not found</h1>
    <p className="max-w-md text-sm text-muted-foreground">
      The page you're looking for doesn't exist or may have moved.
    </p>
    <Button asChild className="mt-2">
      <a href="/jobs/ready">Back to orchestrator</a>
    </Button>
  </main>
);

const DesignResumePage = lazy(() =>
  import("./pages/DesignResumePage").then((m) => ({
    default: m.DesignResumePage,
  })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazy(() =>
  import("./pages/RegisterPage").then((m) => ({ default: m.RegisterPage })),
);
const GmailOauthCallbackPage = lazy(() =>
  import("./pages/GmailOauthCallbackPage").then((m) => ({
    default: m.GmailOauthCallbackPage,
  })),
);
const HomePage = lazy(() =>
  import("./pages/HomePage").then((m) => ({ default: m.HomePage })),
);
const InProgressBoardPage = lazy(() =>
  import("./pages/InProgressBoardPage").then((m) => ({
    default: m.InProgressBoardPage,
  })),
);
const JobSearchPage = lazy(() =>
  import("./pages/JobSearchPage").then((m) => ({ default: m.JobSearchPage })),
);
const JobPage = lazy(() =>
  import("./pages/JobPage").then((m) => ({ default: m.JobPage })),
);
const OrchestratorPage = lazy(() =>
  import("./pages/OrchestratorPage").then((m) => ({
    default: m.OrchestratorPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const TracerLinksPage = lazy(() =>
  import("./pages/TracerLinksPage").then((m) => ({
    default: m.TracerLinksPage,
  })),
);
const TrackingInboxPage = lazy(() =>
  import("./pages/TrackingInboxPage").then((m) => ({
    default: m.TrackingInboxPage,
  })),
);
const VisaSponsorsPage = lazy(() =>
  import("./pages/VisaSponsorsPage").then((m) => ({
    default: m.VisaSponsorsPage,
  })),
);

/** Backwards-compatibility redirects: old URL paths -> new URL paths */
const REDIRECTS: Array<{ from: string; to: string }> = [
  { from: "/", to: "/jobs/ready" },
  { from: "/home", to: "/overview" },
  { from: "/ready", to: "/jobs/ready" },
  { from: "/ready/:jobId", to: "/jobs/ready/:jobId" },
  { from: "/discovered", to: "/jobs/discovered" },
  { from: "/discovered/:jobId", to: "/jobs/discovered/:jobId" },
  { from: "/applied", to: "/jobs/applied" },
  { from: "/applied/:jobId", to: "/jobs/applied/:jobId" },
  { from: "/in-progress", to: "/applications/in-progress" },
  { from: "/in-progress/:jobId", to: "/applications/in-progress" },
  { from: "/jobs/in_progress", to: "/applications/in-progress" },
  { from: "/jobs/in_progress/:jobId", to: "/applications/in-progress" },
  { from: "/all", to: "/jobs/all" },
  { from: "/all/:jobId", to: "/jobs/all/:jobId" },
];

const DEMO_WAITLIST_BANNER_DISMISSED_KEY = "jobops.demoWaitlistBannerDismissed";

/** Per-route document titles (matched against the pathname prefix). */
const PAGE_TITLES: Array<{ prefix: string; title: string }> = [
  { prefix: "/overview", title: "Overview" },
  { prefix: "/jobs", title: "Orchestrator" },
  { prefix: "/job-search", title: "Job Search" },
  { prefix: "/applications", title: "In Progress Board" },
  { prefix: "/design-resume", title: "Design Resume" },
  { prefix: "/settings", title: "Settings" },
  { prefix: "/tracer-links", title: "Tracer Links" },
  { prefix: "/tracking-inbox", title: "Tracking Inbox" },
  { prefix: "/visa-sponsors", title: "Visa Sponsors" },
  { prefix: "/job/", title: "Job" },
  { prefix: "/login", title: "Sign in" },
  { prefix: "/register", title: "Create account" },
];

export const App: React.FC = () => {
  const location = useLocation();
  const nodeRef = useRef<HTMLDivElement>(null);
  const demoInfo = useDemoInfo();
  const [demoWaitlistBannerDismissed, setDemoWaitlistBannerDismissed] =
    useState(() => {
      try {
        return localStorage.getItem(DEMO_WAITLIST_BANNER_DISMISSED_KEY) === "1";
      } catch {
        return false;
      }
    });

  React.useEffect(() => {
    const match = PAGE_TITLES.find(({ prefix }) =>
      location.pathname.startsWith(prefix),
    );
    document.title = match
      ? `${match.title} | Job Ops`
      : "Job Ops | Orchestrator";
  }, [location.pathname]);

  // Determine a stable key for transitions to avoid unnecessary unmounts when switching sub-tabs
  const pageKey = React.useMemo(() => {
    const firstSegment = location.pathname.split("/")[1] || "jobs";
    if (firstSegment === "jobs") {
      return "orchestrator";
    }
    return firstSegment;
  }, [location.pathname]);

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <OnboardingGate />
      <BasicAuthPrompt />
      {demoInfo?.demoMode && !demoWaitlistBannerDismissed && (
        <div className="sticky top-0 z-50 w-full border-b border-orange-400/60 bg-orange-500 px-4 py-2 text-xs text-orange-950 shadow-sm">
          <div className="mx-auto flex items-center justify-center gap-3">
            <p className="flex-1 text-center font-medium">
              This is a read-only demo. Want JobOps without the Docker setup? ☁️{" "}
              Cloud version coming soon — join the waitlist at{" "}
              <a
                className="font-semibold underline underline-offset-2 hover:text-orange-900"
                href="https://try.jobops.app?utm_source=demo&utm_medium=banner&utm_campaign=waitlist"
                target="_blank"
                rel="noreferrer"
              >
                try.jobops.app
              </a>
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full text-orange-950 hover:bg-orange-400/30 hover:text-orange-950"
              onClick={() => {
                setDemoWaitlistBannerDismissed(true);
                try {
                  localStorage.setItem(DEMO_WAITLIST_BANNER_DISMISSED_KEY, "1");
                } catch {
                  // Ignore storage errors in restricted browser contexts.
                }
              }}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Dismiss demo waitlist banner</span>
            </Button>
          </div>
        </div>
      )}
      {demoInfo?.demoMode && (
        <div className="w-full border-b border-amber-400/50 bg-amber-500/20 px-4 py-2 text-center text-xs text-amber-100 backdrop-blur">
          Demo mode: integrations are simulated and data resets every{" "}
          {demoInfo.resetCadenceHours} hours.
        </div>
      )}
      <div>
        <SwitchTransition mode="out-in">
          <CSSTransition
            key={pageKey}
            nodeRef={nodeRef}
            timeout={100}
            classNames="page"
            unmountOnExit
          >
            <div ref={nodeRef}>
              <Suspense
                fallback={
                  <main className="flex min-h-[50vh] items-center justify-center">
                    <output
                      className="block h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground"
                      aria-label="Loading"
                    />
                  </main>
                }
              >
                <Routes location={location}>
                  {/* Backwards-compatibility redirects */}
                  {REDIRECTS.map(({ from, to }) => (
                    <Route
                      key={from}
                      path={from}
                      element={<Navigate to={to} replace />}
                    />
                  ))}

                  {/* Application routes */}
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/register" element={<RegisterPage />} />
                  <Route path="/overview" element={<HomePage />} />
                  <Route
                    path="/oauth/gmail/callback"
                    element={<GmailOauthCallbackPage />}
                  />
                  <Route path="/job/:id" element={<JobPage />} />
                  <Route path="/job-search" element={<JobSearchPage />} />
                  <Route
                    path="/applications/in-progress"
                    element={<InProgressBoardPage />}
                  />
                  <Route path="/design-resume" element={<DesignResumePage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/tracer-links" element={<TracerLinksPage />} />
                  <Route path="/visa-sponsors" element={<VisaSponsorsPage />} />
                  <Route
                    path="/tracking-inbox"
                    element={<TrackingInboxPage />}
                  />
                  <Route path="/jobs/:tab" element={<OrchestratorPage />} />
                  <Route
                    path="/jobs/:tab/:jobId"
                    element={<OrchestratorPage />}
                  />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </div>
          </CSSTransition>
        </SwitchTransition>
      </div>

      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
};
