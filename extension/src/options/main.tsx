import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../shared/ui.css";
import { sendMessage } from "../shared/chrome";
import type { ShortlistrBackendConfig, ShortlistrProfile, ShortlistrQuota, ShortlistrSettings } from "../shared/types";

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

function App() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authWorking, setAuthWorking] = useState(false);

  const [profile, setProfile] = useState<ShortlistrProfile>({
    lookingFor: "",
    strengths: "",
    workHighlights: "",
    mustHaves: "",
    niceToHaves: "",
    avoid: ""
  });
  const [settings, setSettings] = useState<ShortlistrSettings>({
    autoShortlistThreshold: 79,
    promptShortlistThreshold: 70,
    autoSaveNearCertain: true,
    autoSaveGreatFit: false,
    autoSavePossibleFit: false
  });
  const [backend, setBackend] = useState<ShortlistrBackendConfig>({
    enabled: true,
    apiBaseUrl: "",
    apiToken: "",
    model: "gpt-4o-mini"
  });
  const [backendTokenSet, setBackendTokenSet] = useState(false);
  const [resumeText, setResumeText] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [quota, setQuota] = useState<ShortlistrQuota | null>(null);

  async function clearCachedScores() {
    setError("");
    setStatus("Clearing cached scores…");
    try {
      const resp = await sendMessage<{ ok: true } | { ok: false; error: string }>({ type: "SHORTLISTR_CLEAR_CACHE" });
      if (!resp.ok) throw new Error(resp.error);
      setStatus("Cleared cached scores. Re-score job pages to see updated results.");
      setTimeout(() => setStatus(""), 2000);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  function apiHostLabel() {
    try {
      const u = new URL(backend.apiBaseUrl);
      return u.hostname === "localhost" ? "localhost (your local API)" : u.hostname;
    } catch {
      return "the Shortlistr API";
    }
  }

  async function loadFromBackground() {
    const resp = await sendMessage<StateResp>({ type: "SHORTLISTR_GET_STATE" });
    if (!resp.ok) throw new Error(resp.error);
    setProfile(resp.profile);
    setSettings(resp.settings);
    setBackend((b) => ({
      ...b,
      enabled: resp.backend.enabled,
      apiBaseUrl: resp.backend.apiBaseUrl,
      apiToken: "",
      model: resp.backend.model || "gpt-4o-mini"
    }));
    setBackendTokenSet(resp.backend.apiToken === "set");
    setQuota(resp.quota || null);
    const resumeResp = await sendMessage<{ ok: true; resumeText: string } | { ok: false; error: string }>({
      type: "SHORTLISTR_GET_RESUME_TEXT"
    });
    if (resumeResp.ok) setResumeText(resumeResp.resumeText || "");
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadFromBackground();
        setLoaded(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  function originPattern(apiBaseUrl: string) {
    const u = new URL(apiBaseUrl);
    // Chrome match patterns do not include ports; `http://localhost:8787` must request `http://localhost/*`.
    return `${u.protocol}//${u.hostname}/*`;
  }

  async function ensureBackendPermissionIfNeeded() {
    if (!backend.apiBaseUrl) return;
    const pattern = originPattern(backend.apiBaseUrl);

    const has = await new Promise<boolean>((resolve, reject) => {
      chrome.permissions.contains({ origins: [pattern] }, (ok) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(Boolean(ok));
      });
    });
    if (has) return;

    setStatus(`Chrome will ask to allow access to ${apiHostLabel()} so Shortlistr can sign you in and sync.`);
    const granted = await new Promise<boolean>((resolve, reject) => {
      chrome.permissions.request({ origins: [pattern] }, (ok) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(Boolean(ok));
      });
    });
    if (!granted) {
      throw new Error(
        `Permission denied. Shortlistr needs access to ${apiHostLabel()} to sign you in, score jobs, and sync your shortlist. Click Sign in again and choose Allow.`
      );
    }
  }

  async function saveAll() {
    setError("");
    setStatus("Saving…");
    try {
      if (!backendTokenSet) throw new Error("Sign in to edit your profile and resume.");
      await ensureBackendPermissionIfNeeded();

      const resp1 = await sendMessage<{ ok: true } | { ok: false; error: string }>({
        type: "SHORTLISTR_SAVE_PROFILE",
        profile
      });
      if (!resp1.ok) throw new Error(resp1.error);

      const resp2 = await sendMessage<{ ok: true } | { ok: false; error: string }>({
        type: "SHORTLISTR_SAVE_SETTINGS",
        settings
      });
      if (!resp2.ok) throw new Error(resp2.error);

      const resp4 = await sendMessage<{ ok: true } | { ok: false; error: string }>({
        type: "SHORTLISTR_SAVE_RESUME_TEXT",
        resumeText
      });
      if (!resp4.ok) throw new Error(resp4.error);

      setStatus("Saved.");
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function signIn(mode: "signup" | "login") {
    setError("");
    setStatus(mode === "signup" ? "Creating account…" : "Signing in…");
    setAuthWorking(true);
    try {
      const email = authEmail.trim();
      const password = authPassword;
      if (!email) throw new Error("Email is required.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Please enter a valid email address.");
      if (!password || password.length < 6) throw new Error("Password must be at least 6 characters.");

      await ensureBackendPermissionIfNeeded();
      const type = mode === "signup" ? "SHORTLISTR_AUTH_SIGNUP" : "SHORTLISTR_AUTH_LOGIN";
      const resp = await sendMessage<{ ok: true } | { ok: false; error: string }>({
        type,
        email,
        password
      });
      if (!resp.ok) throw new Error(resp.error);
      setAuthPassword("");
      await loadFromBackground();
      setStatus("Signed in. Synced from backend.");
      setTimeout(() => setStatus(""), 2000);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setAuthWorking(false);
    }
  }

  async function extractResume() {
    setError("");
    setStatus("Extracting…");
    try {
      if (!backendTokenSet) throw new Error("Sign in to extract your resume.");
      await ensureBackendPermissionIfNeeded();
      if (!resumeFile) throw new Error("Choose a resume file first.");

      const bytes = await resumeFile.arrayBuffer();
      const resp = await sendMessage<
        | { ok: true; text: string }
        | {
            ok: false;
            error: string;
          }
      >({
        type: "SHORTLISTR_EXTRACT_RESUME",
        fileName: resumeFile.name,
        mimeType: resumeFile.type || "application/octet-stream",
        bytes
      });
      if (!resp.ok) throw new Error(resp.error);
      setResumeText(resp.text);

      const resp4 = await sendMessage<{ ok: true } | { ok: false; error: string }>({
        type: "SHORTLISTR_SAVE_RESUME_TEXT",
        resumeText: resp.text
      });
      if (!resp4.ok) throw new Error(resp4.error);

      setStatus("Resume extracted and saved.");
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  function quotaLabel() {
    if (!quota) return "";
    const used = Number(quota.used) || 0;
    const limit = Number(quota.limit) || 0;
    if (!limit) return "";
    return `${used}/${limit}`;
  }

  function quotaResetLabel() {
    if (!quota || !quota.resetAt) return "";
    try {
      const d = new Date(quota.resetAt);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleString();
    } catch {
      return "";
    }
  }

  async function resetDailyQuota() {
    setError("");
    setStatus("Resetting daily limit…");
    try {
      if (!backendTokenSet) throw new Error("Sign in first.");
      const resp = await sendMessage<{ ok: true } | { ok: false; error: string }>({ type: "SHORTLISTR_RESET_DAILY_QUOTA" });
      if (!resp.ok) throw new Error(resp.error);
      await loadFromBackground();
      setStatus("Daily limit reset.");
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  if (!loaded && !error) {
    return (
      <div className="container">
        <div className="card">Loading…</div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 920, margin: "0 auto" }}>
      <div className="card">
        <div className="row">
          <div>
            <div className="title">Shortlistr Options</div>
            <div className="subtitle">Tell Shortlistr what you want and what you do best.</div>
          </div>
          <div className="btnRow" style={{ marginTop: 0 }}>
            <button onClick={() => void clearCachedScores()}>Clear cache</button>
            <button className="primary" onClick={() => void saveAll()} disabled={!backendTokenSet}>
              Save
            </button>
          </div>
        </div>

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

        <div className="grid" style={{ marginTop: 12 }}>
          <div className="card" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="title">Account</div>
            <div className="subtitle">Sign in so your profile, resume, and Shortlist Inbox sync.</div>
            <div className="grid" style={{ marginTop: 10 }}>
              <div>
                <label>Email</label>
                <input
                  placeholder="you@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  autoComplete="username"
                />
              </div>
              <div>
                <label>Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  autoComplete={backendTokenSet ? "current-password" : "new-password"}
                />
              </div>
              <div className="btnRow" style={{ marginTop: 6 }}>
                <button onClick={() => void signIn("signup")} disabled={authWorking || backendTokenSet}>
                  Sign up
                </button>
                <button onClick={() => void signIn("login")} disabled={authWorking}>
                  Sign in
                </button>
                <button
                  onClick={() => {
                    void (async () => {
                      await sendMessage({ type: "SHORTLISTR_CLEAR_BACKEND_TOKEN" });
                      setBackendTokenSet(false);
                      setStatus("Signed out.");
                      setTimeout(() => setStatus(""), 1500);
                    })().catch((e) => setError((e as Error).message));
                  }}
                  disabled={!backendTokenSet || authWorking}
                >
                  Sign out
                </button>
                {backendTokenSet && <div className="small">You’re signed in.</div>}
              </div>
              {backendTokenSet && quotaLabel() && (
                <div className="small" style={{ marginTop: 6 }}>
                  Daily analyses: {quotaLabel()}
                  {quotaResetLabel() ? ` · resets ${quotaResetLabel()}` : ""}
                </div>
              )}
              {backendTokenSet && quota && quota.limit > 0 && quota.used > 0 && (
                <div className="btnRow" style={{ marginTop: 6 }}>
                  <button onClick={() => void resetDailyQuota()} title="Dev-only. Requires ALLOW_QUOTA_RESET=true on the backend.">
                    Reset daily limit (dev)
                  </button>
                </div>
              )}
              {!backendTokenSet && <div className="small">Sign in to start scoring jobs and saving your shortlist.</div>}
              {!backendTokenSet && (
                <div className="small">
                  First time sign-in: Chrome will ask to allow Shortlistr to connect to {apiHostLabel()}. This is required for
                  account sign-in, AI scoring, and syncing.
                </div>
              )}
            </div>
          </div>

          {backendTokenSet && (
          <div className="card" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="title">Auto-save thresholds</div>
            <div className="subtitle">How Shortlistr decides whether to auto-save or prompt you.</div>
            <div className="grid" style={{ marginTop: 10, gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label>Auto Shortlist (strong targets)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.autoShortlistThreshold}
                  onChange={(e) => setSettings((s) => ({ ...s, autoShortlistThreshold: Number(e.target.value) }))}
                />
              </div>
              <div>
                <label>Prompt Shortlist (modest odds)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.promptShortlistThreshold}
                  onChange={(e) => setSettings((s) => ({ ...s, promptShortlistThreshold: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="grid" style={{ marginTop: 10, gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 0, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={settings.autoSaveNearCertain}
                  onChange={(e) => setSettings((s) => ({ ...s, autoSaveNearCertain: e.target.checked }))}
                  style={{ width: 16, height: 16 }}
                />
                Auto-save strong targets (≥ {settings.autoShortlistThreshold})
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 0, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={settings.autoSaveGreatFit}
                  onChange={(e) => setSettings((s) => ({ ...s, autoSaveGreatFit: e.target.checked }))}
                  style={{ width: 16, height: 16 }}
                />
                Auto-save modest-odds roles ({settings.promptShortlistThreshold}–{Math.max(0, settings.autoShortlistThreshold - 1)})
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 0, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={settings.autoSavePossibleFit}
                  onChange={(e) => setSettings((s) => ({ ...s, autoSavePossibleFit: e.target.checked }))}
                  style={{ width: 16, height: 16 }}
                />
                Auto-save long-shots (65–{Math.max(64, settings.promptShortlistThreshold - 1)})
              </label>
              <div className="small">
                Tip: by default, 79+ auto-saves, 70–78 prompts, and 65–69 is manual.
              </div>
            </div>
          </div>
          )}

          {backendTokenSet && (
          <div className="card" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="title">What you’re looking for</div>
            <div className="subtitle">Your ideal role, domain, and constraints.</div>
            <div style={{ marginTop: 10 }}>
              <label>Looking for</label>
              <textarea
                placeholder={`Example:\n- Forward deployed engineer / applied AI\n- Startup, fast iteration\n- Remote or SF\n- Ship user-facing product`}
                value={profile.lookingFor}
                onChange={(e) => setProfile((p) => ({ ...p, lookingFor: e.target.value }))}
              />
            </div>
          </div>
          )}

          {backendTokenSet && (
          <div className="card" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="title">Your strengths</div>
            <div className="subtitle">What you want to highlight when it’s a fit.</div>
            <div style={{ marginTop: 10 }}>
              <label>Strengths</label>
              <textarea
                placeholder={`Examples:\n- Shipped LLM features end-to-end\n- Customer-facing engineering\n- Fast prototyping + productionizing\n- Systems + ML hybrid`}
                value={profile.strengths}
                onChange={(e) => setProfile((p) => ({ ...p, strengths: e.target.value }))}
              />
            </div>
          </div>
          )}

          {backendTokenSet && (
          <div className="card" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="title">Work highlights (in your words)</div>
            <div className="subtitle">Optional: add standout examples that don’t fit on a resume.</div>
            <div style={{ marginTop: 10 }}>
              <label>Work highlights</label>
              <textarea
                placeholder={`Examples:\n- I owned an LLM feature from concept → shipped product, including orchestration, guardrails, and cost controls.\n- I designed the agent architecture (separate world + character modeling, then a constrained story engine) to keep outputs consistent.\n- I regularly turned vague requirements into concrete systems and shipped under tight constraints.`}
                value={profile.workHighlights}
                onChange={(e) => setProfile((p) => ({ ...p, workHighlights: e.target.value }))}
                style={{ minHeight: 120 }}
              />
              <div className="small">Used only for scoring; keep it specific and concrete.</div>
            </div>
          </div>
          )}

          {backendTokenSet && (
          <div className="card" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="title">Strong preferences / nice-to-haves</div>
            <div className="subtitle">What matters most to you vs. what’s a bonus.</div>
            <div className="grid" style={{ marginTop: 10, gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label>Strong preferences</label>
                <textarea
                  placeholder={`Examples:\n- LLM/AI product team\n- Ownership\n- High agency`}
                  value={profile.mustHaves}
                  onChange={(e) => setProfile((p) => ({ ...p, mustHaves: e.target.value }))}
                />
              </div>
              <div>
                <label>Nice-to-haves</label>
                <textarea
                  placeholder={`Examples:\n- Great mentorship\n- Public company\n- Strong design culture`}
                  value={profile.niceToHaves}
                  onChange={(e) => setProfile((p) => ({ ...p, niceToHaves: e.target.value }))}
                />
              </div>
            </div>
          </div>
          )}

          {backendTokenSet && (
          <div className="card" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="title">Avoid list</div>
            <div className="subtitle">Things you cannot do or do not want to do.</div>
            <div style={{ marginTop: 10 }}>
              <label>Avoid</label>
              <textarea
                placeholder={`Examples:\n- Heavy travel\n- Consulting / enterprise transformation\n- On-call rotations\n- Pure sales quotas\n- Legacy stack only`}
                value={profile.avoid}
                onChange={(e) => setProfile((p) => ({ ...p, avoid: e.target.value }))}
              />
            </div>
          </div>
          )}

          {backendTokenSet && (
          <div className="card" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="title">Resume</div>
            <div className="subtitle">Upload a file (PDF/DOCX/TXT) or paste text.</div>
            <div className="grid" style={{ marginTop: 10 }}>
              <div>
                <label>Upload resume</label>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setResumeFile(f);
                  }}
                />
                <div className="btnRow">
                  <button onClick={() => void extractResume()} disabled={!resumeFile || !backendTokenSet}>
                    Extract text with backend
                  </button>
                </div>
              </div>
              <div>
                <label>Resume text</label>
                <textarea
                  placeholder="Paste your resume text here (or extract it from a file)."
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  style={{ minHeight: 140 }}
                />
                <div className="small">Saved to your account when you click Save.</div>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
