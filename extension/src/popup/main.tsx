import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../shared/ui.css";
import { openInboxPage, openOptionsPage, queryActiveTab, sendMessage, sendMessageToTab } from "../shared/chrome";
import type { JobAnalysis, JobPayload, ShortlistrBackendConfig, ShortlistrProfile, ShortlistrQuota, ShortlistrSettings } from "../shared/types";

type StateResp =
  | {
      ok: true;
      profile: ShortlistrProfile;
      settings: ShortlistrSettings;
      backend: Omit<ShortlistrBackendConfig, "apiToken"> & { apiToken: "set" | "" };
      resumeTextLen: number;
      shortlistCount: number;
      quota?: ShortlistrQuota | null;
    }
  | { ok: false; error: string };

type AnalyzeResp =
  | {
      ok: true;
      analysis: JobAnalysis;
      saved: boolean;
      alreadySaved: boolean;
      cached: boolean;
      updated?: boolean;
      saveError?: string;
    }
  | { ok: false; error: string };

type ExtractJobResp = { ok: true; job: JobPayload } | { ok: false; error: string };

type SitesResp = { ok: true; sites: string[] } | { ok: false; error: string };

function scoreColor(score: number) {
  if (score >= 95) return "var(--great)";
  if (score >= 87) return "var(--great)";
  if (score >= 79) return "var(--good)";
  if (score >= 70) return "var(--warn)";
  if (score >= 65) return "var(--warn)";
  return "var(--bad)";
}

function App() {
  const [state, setState] = useState<StateResp | null>(null);
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [analysisMeta, setAnalysisMeta] = useState<{
    cached: boolean;
    saved: boolean;
    alreadySaved: boolean;
    updated: boolean;
    saved_via?: string;
  } | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [enabledSites, setEnabledSites] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const resp = await sendMessage<StateResp>({ type: "SHORTLISTR_GET_STATE" });
        setState(resp);
      } catch (e) {
        setState({ ok: false, error: (e as Error).message });
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const tab = await queryActiveTab();
        setActiveTab(tab || null);
      } catch {
        setActiveTab(null);
      }

      try {
        const resp = await sendMessage<SitesResp>({ type: "SHORTLISTR_SITES_LIST" });
        if (resp.ok) setEnabledSites(resp.sites);
      } catch {
        // ignore
      }
    })();
  }, []);

  const signedIn = useMemo(() => {
    if (!state || !state.ok) return false;
    return state.backend.apiToken === "set";
  }, [state]);

  const activeOriginPattern = useMemo(() => {
    if (!activeTab?.url) return "";
    try {
      const u = new URL(activeTab.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return `${u.protocol}//${u.hostname}/*`;
    } catch {
      return "";
    }
  }, [activeTab]);

  const autoAnalyzeBuiltIn = useMemo(() => {
    return Boolean(activeOriginPattern);
  }, [activeOriginPattern]);

  const autoAnalyzeEnabledForSite = useMemo(() => {
    if (!activeOriginPattern) return false;
    return enabledSites.includes(activeOriginPattern);
  }, [enabledSites, activeOriginPattern]);

  async function hasHostPermission(originPattern: string) {
    return new Promise<boolean>((resolve, reject) => {
      chrome.permissions.contains({ origins: [originPattern] }, (has) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(Boolean(has));
      });
    });
  }

  async function requestHostPermission(originPattern: string) {
    if (await hasHostPermission(originPattern)) return true;
    return new Promise<boolean>((resolve, reject) => {
      chrome.permissions.request({ origins: [originPattern] }, (granted) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(Boolean(granted));
      });
    });
  }

  async function enableAutoAnalyzeForSite() {
    setError("");
    setStatus("Enabling auto-analyze…");
    try {
      if (!signedIn) throw new Error("Sign in to start scoring.");
      const tab = await queryActiveTab();
      if (!tab?.id || !tab.url) throw new Error("No active tab.");
      const u = new URL(tab.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Can’t enable auto-analyze on this page.");
      const originPattern = `${u.protocol}//${u.hostname}/*`;

      const granted = await requestHostPermission(originPattern);
      if (!granted) throw new Error("Permission denied.");

      const resp = await sendMessage<SitesResp>({ type: "SHORTLISTR_SITE_ENABLE", origin: originPattern, tabId: tab.id });
      if (!resp.ok) throw new Error(resp.error);
      setEnabledSites(resp.sites);
      setStatus("Auto-analyze enabled for this site.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function disableAutoAnalyzeForSite() {
    setError("");
    setStatus("Disabling auto-analyze…");
    try {
      if (!signedIn) throw new Error("Sign in to start scoring.");
      if (!activeOriginPattern) throw new Error("No active site.");
      const resp = await sendMessage<SitesResp>({ type: "SHORTLISTR_SITE_DISABLE", origin: activeOriginPattern });
      if (!resp.ok) throw new Error(resp.error);
      setEnabledSites(resp.sites);
      setStatus("Auto-analyze disabled for this site.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function analyzeActiveTab(opts: { forceRescore?: boolean } = {}) {
    setError("");
    setStatus(opts.forceRescore ? "Re-scoring…" : "Analyzing…");
    try {
      if (!signedIn) throw new Error("Sign in to start scoring.");
      const tab = await queryActiveTab();
      if (!tab?.id) throw new Error("No active tab.");
      let job: JobPayload;
      try {
        job = await sendMessageToTab<JobPayload>(tab.id, { type: "SHORTLISTR_EXTRACT_JOB" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e || "");
        if (/receiving end does not exist|could not establish connection/i.test(msg)) {
          const resp = await sendMessage<ExtractJobResp>({ type: "SHORTLISTR_EXTRACT_JOB_FROM_TAB", tabId: tab.id });
          if (!resp.ok) throw new Error(resp.error);
          job = resp.job;
        } else {
          throw e;
        }
      }

      if (opts.forceRescore) {
        await sendMessage<{ ok: true; cleared: number } | { ok: false; error: string }>({ type: "SHORTLISTR_CLEAR_JOB_CACHE", job });
      }

      const resp = await sendMessage<AnalyzeResp>({ type: "SHORTLISTR_ANALYZE_JOB", job });
      if (!resp.ok) throw new Error(resp.error);
      setAnalysis(resp.analysis);
      setAnalysisMeta({
        cached: Boolean(resp.cached),
        saved: Boolean(resp.saved),
        alreadySaved: Boolean(resp.alreadySaved),
        updated: Boolean(resp.updated),
        saved_via: String(resp.analysis?.saved_via || "")
      });
      setStatus(
        resp.saved
          ? "Auto-saved to Shortlist Inbox."
          : resp.updated
            ? "Updated in Shortlist Inbox."
            : resp.alreadySaved
              ? "Already in Shortlist Inbox."
              : "Done."
      );

      // Refresh counts after save/update so the Inbox pill is accurate without reopening the popup.
      try {
        const nextState = await sendMessage<StateResp>({ type: "SHORTLISTR_GET_STATE" });
        setState(nextState);
      } catch {
        // ignore
      }
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function clearCachedScores() {
    setError("");
    setStatus("Clearing cache…");
    try {
      const resp = await sendMessage<{ ok: true } | { ok: false; error: string }>({ type: "SHORTLISTR_CLEAR_CACHE" });
      if (!resp.ok) throw new Error(resp.error);
      setAnalysis(null);
      setAnalysisMeta(null);
      setStatus("Cleared cached scores.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  return (
    <div className="container" style={{ width: 360 }}>
      <div className="card">
        <div className="row">
          <div>
            <div className="title">Shortlistr</div>
            <div className="subtitle">Turn job boards into a shortlist.</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {state && state.ok && state.quota && state.quota.limit > 0 && (
              <span className="pill" title={state.quota.resetAt ? `Resets ${new Date(state.quota.resetAt).toLocaleString()}` : ""}>
                <span className="small">Daily</span>
                <span className="score">{state.quota.remaining}</span>
              </span>
            )}
            <span className="pill">
              <span className="small">Inbox</span>
              <span className="score">{state && state.ok ? state.shortlistCount : "—"}</span>
            </span>
          </div>
        </div>

        {!signedIn && (
          <div style={{ marginTop: 10 }} className="error">
            Sign in to start scoring and saving roles.
          </div>
        )}

        {analysis && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="pill">
                <span className="small">Score</span>
                <span className="score" style={{ color: scoreColor(analysis.score) }}>
                  {analysis.score}
                </span>
                <span className="small">{analysis.label || ""}</span>
              </span>

              {analysisMeta && (analysisMeta.saved || analysisMeta.alreadySaved || analysisMeta.updated) && (
                <span
                  className="pill"
                  style={{
                    borderColor: "rgba(34, 197, 94, 0.35)",
                    background: "rgba(34, 197, 94, 0.08)"
                  }}
                  title="Saved to your Shortlist Inbox"
                >
                  <span className="small">{analysisMeta.saved_via === "auto" ? "✓ Auto-saved" : "✓ Saved"}</span>
                </span>
              )}

              {analysisMeta?.cached && (
                <span className="pill" title="This result was returned from your local cache.">
                  <span className="small">Cached</span>
                </span>
              )}
            </div>
            <div className="subtitle" style={{ marginTop: 8 }}>
              {analysis.summary}
            </div>
            {analysis.tldr && (
              <div className="tldr" style={{ marginTop: 8 }}>
                {analysis.tldr}
              </div>
            )}
            {analysis.resume_or_cover_letter_tip && (
              <div className="tip" style={{ marginTop: 8 }}>
                {analysis.resume_or_cover_letter_tip}
              </div>
            )}
          </div>
        )}

        {status && (
          <div className="small" style={{ marginTop: 10 }}>
            {status}
          </div>
        )}
        {error && (
          <div className="error" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        <div className="btnRow">
          {signedIn ? (
            <button className="primary" onClick={() => void analyzeActiveTab()}>
              Analyze this page
            </button>
          ) : (
            <button className="primary" onClick={() => openOptionsPage()}>
              Sign in
            </button>
          )}
          {signedIn && analysis && (
            <button onClick={() => void analyzeActiveTab({ forceRescore: true })} title="Clears this job’s cached score and re-scores.">
              Re-score
            </button>
          )}
          <button onClick={() => openInboxPage()} disabled={!signedIn}>
            Open Inbox
          </button>
          <button onClick={() => openOptionsPage()}>{signedIn ? "Options" : "Account"}</button>
          <button onClick={() => void clearCachedScores()}>Clear cache</button>
        </div>

        {signedIn && activeOriginPattern && !autoAnalyzeBuiltIn && (
          <div style={{ marginTop: 10 }}>
            <div className="small">
              Want auto-scoring on this site? Enable it once (Chrome will ask for permission to read job pages here).
            </div>
            <div className="btnRow" style={{ marginTop: 8 }}>
              {autoAnalyzeEnabledForSite ? (
                <button onClick={() => void disableAutoAnalyzeForSite()}>Disable auto-analyze</button>
              ) : (
                <button onClick={() => void enableAutoAnalyzeForSite()}>Enable auto-analyze</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
