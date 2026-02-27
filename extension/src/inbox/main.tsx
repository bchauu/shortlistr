import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../shared/ui.css";
import { sendMessage } from "../shared/chrome";
import type { ShortlistItem } from "../shared/types";

type ShortlistResp = { ok: true; shortlist: ShortlistItem[] } | { ok: false; error: string };
type StateResp =
  | { ok: true; backend: { apiToken: "set" | "" } }
  | { ok: false; error: string };

type SortKey = "savedAt_desc" | "savedAt_asc" | "score_desc" | "score_asc";

function scoreColor(score: number) {
  if (score >= 95) return "var(--great)";
  if (score >= 87) return "var(--great)";
  if (score >= 79) return "var(--good)";
  if (score >= 70) return "var(--warn)";
  if (score >= 65) return "var(--warn)";
  return "var(--bad)";
}

function sortLabel(sortKey: SortKey) {
  switch (sortKey) {
    case "savedAt_desc":
      return "Date added (newest)";
    case "savedAt_asc":
      return "Date added (oldest)";
    case "score_desc":
      return "Score (high → low)";
    case "score_asc":
      return "Score (low → high)";
    default:
      return "Date added (newest)";
  }
}

function savedAtMs(it: ShortlistItem) {
  const ms = Date.parse(it.savedAt);
  return Number.isFinite(ms) ? ms : 0;
}

function scoreOf(it: ShortlistItem) {
  const s = it.analysis?.score;
  return Number.isFinite(s) ? Number(s) : -1;
}

function oneLine(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createTab(url: string, active: boolean) {
  await new Promise<void>((resolve, reject) => {
    chrome.tabs.create({ url, active }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

function App() {
  const [shortlist, setShortlist] = useState<ShortlistItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("savedAt_desc");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState("");

  async function refresh() {
    setError("");
    setLoading(true);
    try {
      const resp = await sendMessage<ShortlistResp>({ type: "SHORTLISTR_GET_SHORTLIST" });
      if (!resp.ok) throw new Error(resp.error);
      setShortlist(resp.shortlist || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      setError("");
      setLoading(true);
      try {
        const resp = await sendMessage<StateResp>({ type: "SHORTLISTR_GET_STATE" });
        if (!resp.ok) throw new Error(resp.error);
        const authed = resp.backend?.apiToken === "set";
        setSignedIn(authed);
        if (authed) await refresh();
        else setLoading(false);
      } catch (e) {
        setSignedIn(false);
        setError((e as Error).message);
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      const keys = new Set(shortlist.map((it) => it.key));
      const next = new Set<string>();
      for (const k of prev) if (keys.has(k)) next.add(k);
      return next;
    });
  }, [shortlist]);

  const sortedShortlist = useMemo(() => {
    const arr = shortlist.map((it, idx) => ({ it, idx }));
    arr.sort((a, b) => {
      if (sortKey === "savedAt_desc") return savedAtMs(b.it) - savedAtMs(a.it) || a.idx - b.idx;
      if (sortKey === "savedAt_asc") return savedAtMs(a.it) - savedAtMs(b.it) || a.idx - b.idx;
      if (sortKey === "score_desc") return scoreOf(b.it) - scoreOf(a.it) || savedAtMs(b.it) - savedAtMs(a.it) || a.idx - b.idx;
      if (sortKey === "score_asc") return scoreOf(a.it) - scoreOf(b.it) || savedAtMs(b.it) - savedAtMs(a.it) || a.idx - b.idx;
      return savedAtMs(b.it) - savedAtMs(a.it) || a.idx - b.idx;
    });
    return arr.map((x) => x.it);
  }, [shortlist, sortKey]);

  const empty = useMemo(() => !loading && sortedShortlist.length === 0, [loading, sortedShortlist.length]);
  const selectedCount = selectedKeys.size;

  async function removeItem(key: string) {
    await sendMessage({ type: "SHORTLISTR_DELETE_SHORTLIST_ITEM", key });
    void refresh();
  }

  async function clearAll() {
    const ok = confirm("Clear your Shortlist Inbox?");
    if (!ok) return;
    await sendMessage({ type: "SHORTLISTR_CLEAR_SHORTLIST" });
    void refresh();
  }

  function toggleSelected(key: string, checked: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedKeys(new Set(sortedShortlist.map((it) => it.key)));
  }

  function clearSelection() {
    setSelectedKeys(new Set());
  }

  async function openSelected({ focusFirst }: { focusFirst: boolean }) {
    setError("");
    setStatus("");

    const items = sortedShortlist.filter((it) => selectedKeys.has(it.key)).filter((it) => Boolean(it.job.url));
    if (items.length === 0) {
      setStatus("No selected roles with a URL.");
      return;
    }

    if (items.length >= 12) {
      const ok = confirm(`Open ${items.length} tabs?`);
      if (!ok) return;
    }

    try {
      for (let i = 0; i < items.length; i += 1) {
        const url = items[i].job.url!;
        const active = focusFirst && i === 0;
        await createTab(url, active);
        await sleep(60);
      }
      setStatus(`Opened ${items.length} tab${items.length === 1 ? "" : "s"}${focusFirst ? "." : " in background."}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div className="card">
        <div className="row">
          <div>
            <div className="title">Shortlist Inbox</div>
            <div className="subtitle">Saved roles that are worth your time.</div>
          </div>
          <div className="btnRow" style={{ marginTop: 0 }}>
            <button onClick={() => void refresh()} disabled={loading || signedIn === false}>
              Refresh
            </button>
            <button
              className="danger"
              onClick={() => void clearAll()}
              disabled={loading || signedIn === false || shortlist.length === 0}
            >
              Clear all
            </button>
          </div>
        </div>

        {signedIn === false && (
          <div className="error" style={{ marginTop: 10 }}>
            Sign in to view your Shortlist Inbox.{" "}
            <button
              style={{ marginLeft: 8 }}
              onClick={() => void sendMessage({ type: "SHORTLISTR_OPEN_OPTIONS" })}
            >
              Sign in
            </button>
          </div>
        )}

        <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label>Sort</label>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={{ maxWidth: 260 }}>
              <option value="savedAt_desc">{sortLabel("savedAt_desc")}</option>
              <option value="savedAt_asc">{sortLabel("savedAt_asc")}</option>
              <option value="score_desc">{sortLabel("score_desc")}</option>
              <option value="score_asc">{sortLabel("score_asc")}</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="pill">
              <span className="small">Selected</span>
              <span className="score">{selectedCount}</span>
            </span>
            <button onClick={() => selectAllVisible()} disabled={sortedShortlist.length === 0}>
              Select all
            </button>
            <button onClick={() => clearSelection()} disabled={selectedCount === 0}>
              Clear
            </button>
            <button
              className="primary"
              onClick={(e) => void openSelected({ focusFirst: (e as React.MouseEvent).shiftKey })}
              disabled={selectedCount === 0 || signedIn === false}
              title="Opens tabs in background. Hold Shift to focus the first tab."
            >
              Open selected
            </button>
          </div>
        </div>

        {error && (
          <div className="error" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        {status && (
          <div className="small" style={{ marginTop: 10 }}>
            {status}
          </div>
        )}

        {loading && <div className="small" style={{ marginTop: 10 }}>Loading…</div>}
        {empty && <div className="small" style={{ marginTop: 10 }}>No saved roles yet.</div>}

        <div className="list" style={{ marginTop: 12 }}>
          {sortedShortlist.map((it) => {
            const title = it.job.title || "Untitled role";
            const company = it.job.company || "";
            const score = it.analysis?.score ?? 0;
            const checked = selectedKeys.has(it.key);
            return (
              <div className="card" key={it.key} style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleSelected(it.key, e.target.checked)}
                      aria-label={`Select ${title}`}
                      style={{ width: 16, height: 16, marginTop: 2 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="itemTitle">{title}</div>
                      <div className="meta">
                        {company}
                        {it.job.location ? ` · ${it.job.location}` : ""}
                      </div>
                      <div className="subtitle" style={{ marginTop: 8 }}>
                        {it.analysis?.summary || ""}
                      </div>
                      {it.analysis?.tldr && (
                        <div className="tldr" style={{ marginTop: 8 }}>
                          {it.analysis.tldr}
                        </div>
                      )}
                      {it.analysis?.resume_or_cover_letter_tip && (
                        <div className="tip" style={{ marginTop: 8 }}>
                          {it.analysis.resume_or_cover_letter_tip}
                        </div>
                      )}
                      {Array.isArray(it.analysis?.reasons) && it.analysis.reasons.length > 0 && (
                        <div className="small" style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 800, color: "var(--good)" }}>Why</div>
                          <ul style={{ margin: "6px 0 0 18px", color: "var(--muted)" }}>
                            {it.analysis.reasons.slice(0, 6).map((r, idx) => (
                              <li key={idx}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {Array.isArray(it.analysis?.strengths_to_highlight) && it.analysis.strengths_to_highlight.length > 0 && (
                        <div className="small" style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 800, color: "var(--great)" }}>Highlight</div>
                          <ul style={{ margin: "6px 0 0 18px", color: "var(--muted)" }}>
                            {it.analysis.strengths_to_highlight.slice(0, 5).map((r, idx) => (
                              <li key={idx}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {(Array.isArray(it.analysis?.implied_company_needs) && it.analysis.implied_company_needs.length > 0) ||
                      (Array.isArray(it.analysis?.candidate_hidden_value) && it.analysis.candidate_hidden_value.length > 0) ||
                      (Array.isArray(it.analysis?.questions_to_validate) && it.analysis.questions_to_validate.length > 0) ? (
                        <details style={{ marginTop: 10 }}>
                          <summary className="small" style={{ cursor: "pointer", color: "var(--accent)" }}>
                            Hidden context
                          </summary>
                          {Array.isArray(it.analysis?.implied_company_needs) && it.analysis.implied_company_needs.length > 0 && (
                            <div className="small" style={{ marginTop: 8 }}>
                              <div style={{ fontWeight: 800, color: "var(--warn)" }}>Implied company needs</div>
                              <ul style={{ margin: "6px 0 0 18px", color: "var(--muted)" }}>
                                {it.analysis.implied_company_needs.slice(0, 5).map((n, idx) => {
                                  const conf = typeof n.confidence === "number" && Number.isFinite(n.confidence)
                                    ? ` (${Math.round(n.confidence * 100)}%)`
                                    : "";
                                  return <li key={idx}>{oneLine(n.need)}{conf}</li>;
                                })}
                              </ul>
                            </div>
                          )}

                          {Array.isArray(it.analysis?.candidate_hidden_value) && it.analysis.candidate_hidden_value.length > 0 && (
                            <div className="small" style={{ marginTop: 8 }}>
                              <div style={{ fontWeight: 800, color: "var(--great)" }}>Candidate hidden value</div>
                              <ul style={{ margin: "6px 0 0 18px", color: "var(--muted)" }}>
                                {it.analysis.candidate_hidden_value.slice(0, 5).map((v, idx) => (
                                  <li key={idx}>
                                    {oneLine(v.value)}
                                    {v.maps_to_need ? ` → ${oneLine(v.maps_to_need)}` : ""}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {Array.isArray(it.analysis?.questions_to_validate) && it.analysis.questions_to_validate.length > 0 && (
                            <div className="small" style={{ marginTop: 8 }}>
                              <div style={{ fontWeight: 800, color: "var(--accent)" }}>Questions to validate</div>
                              <ul style={{ margin: "6px 0 0 18px", color: "var(--muted)" }}>
                                {it.analysis.questions_to_validate.slice(0, 6).map((q, idx) => (
                                  <li key={idx}>{oneLine(q)}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </details>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                    <span className="pill">
                      <span className="small">Score</span>
                      <span className="score" style={{ color: scoreColor(score) }}>
                        {score}
                      </span>
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="primary"
                        onClick={(e) => {
                          if (!it.job.url) return;
                          const active = (e as React.MouseEvent).shiftKey;
                          void createTab(it.job.url, active).catch((err) => setError((err as Error).message));
                        }}
                        disabled={!it.job.url}
                        title="Opens in background. Hold Shift to focus."
                      >
                        Open
                      </button>
                      <button className="danger" onClick={() => void removeItem(it.key)}>
                        Delete
                      </button>
                    </div>
                    <div className="small">{new Date(it.savedAt).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            );
          })}
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
