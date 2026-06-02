(function () {
  const ROOT_ID = "shortlistr-root";
  if (document.getElementById(ROOT_ID)) return;

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(resp);
      });
    });
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  document.documentElement.appendChild(root);
  // Hidden by default; we'll show only on pages that look like a job posting.
  root.style.display = "none";

  root.innerHTML = `
    <div class="sl-card">
      <div class="sl-row">
        <div>
          <div class="sl-title">Shortlistr</div>
          <div class="sl-subtitle">AI-powered fit scoring</div>
        </div>
        <div class="sl-right">
          <span class="sl-pill saved sl-hidden" id="sl-saved">✓ Saved</span>
          <span class="sl-pill" title="Shortlistr Score (0-100)">
            <span>Score</span>
            <span class="sl-score" id="sl-score">—</span>
          </span>
        </div>
      </div>
      <div class="sl-body" id="sl-summary">Scanning this page…</div>
      <div class="sl-tldr sl-hidden" id="sl-tldr"></div>
      <div class="sl-tip sl-hidden" id="sl-tip"></div>
      <div class="sl-mini" id="sl-reasons"></div>
      <div class="sl-mini" id="sl-concerns"></div>
      <div class="sl-mini" id="sl-personas"></div>
      <div class="sl-mini" id="sl-needs"></div>
      <div class="sl-mini" id="sl-value"></div>
      <div class="sl-btnrow">
        <button class="sl-btn primary" id="sl-shortlist" disabled>Shortlist</button>
        <button class="sl-btn" id="sl-rescore" disabled title="Clears the cached score for this job and re-scores.">Re-score</button>
        <button class="sl-btn" id="sl-clear-cache" title="Clears cached scores for all jobs. Use after updating your profile or resume.">Clear cache</button>
        <button class="sl-btn" id="sl-inbox">Inbox</button>
        <button class="sl-btn" id="sl-options">Options</button>
      </div>
      <div class="sl-mini" id="sl-meta"></div>
    </div>
  `;

  const elScore = root.querySelector("#sl-score");
  const elSaved = root.querySelector("#sl-saved");
  const elSummary = root.querySelector("#sl-summary");
  const elTldr = root.querySelector("#sl-tldr");
  const elTip = root.querySelector("#sl-tip");
  const elReasons = root.querySelector("#sl-reasons");
  const elConcerns = root.querySelector("#sl-concerns");
  const elPersonas = root.querySelector("#sl-personas");
  const elNeeds = root.querySelector("#sl-needs");
  const elValue = root.querySelector("#sl-value");
  const elMeta = root.querySelector("#sl-meta");
  const btnShortlist = root.querySelector("#sl-shortlist");
  const btnRescore = root.querySelector("#sl-rescore");
  const btnClearCache = root.querySelector("#sl-clear-cache");
  const btnInbox = root.querySelector("#sl-inbox");
  const btnOptions = root.querySelector("#sl-options");

  let lastJob = null;
  let lastAnalysis = null;
  let analyzing = false;
  let signedIn = false;
  let retryTimer = null;
  let retryUrl = "";
  let retryCount = 0;

  function urlSegs(pathname) {
    return String(pathname || "")
      .toLowerCase()
      .split("/")
      .filter(Boolean);
  }

  function hasHighSignalJobDom(source) {
    const selectorsBySource = {
      linkedin: [
        ".jobs-description__content",
        ".jobs-description-content__text",
        ".jobs-box__html-content",
        "div[data-view-name='job-details-job-details-component']",
        "div[data-sdui-component*='aboutTheJob']",
        "div[componentkey*='JobDetails_AboutTheJob']",
        "span[data-test-id='expandable-text-box']"
      ],
      wellfound: ["[data-test='JobPostingDescription']"],
      otta: ["[data-testid='job-description']"],
      lever: [
        "[data-qa='posting-description']",
        "[data-qa='posting-name']",
        ".posting",
        ".posting-description",
        ".posting-categories"
      ],
      ashby: ["[data-testid='job-posting']", "[data-testid='job-posting-description']", "main", "article"],
      greenhouse: ["[data-testid='job-post-description']", "#content", "main", "article"],
      workday: [
        "[data-automation-id='jobPostingPage']",
        "[data-automation-id='jobPostingDescription']",
        "[data-automation-id='jobDescription']",
        "main"
      ],
      ultipro: ["#OpportunityDetail", ".opportunity-detail", "[data-automation-id='opportunityDetail']", "main"]
    };

    const sels = selectorsBySource[source];
    if (!sels) return false;
    for (const sel of sels) {
      const el = document.querySelector(sel);
      const t = extractTextFrom(el);
      if (t && t.length >= 220) return true;
    }
    return false;
  }

  function pageHasJobPostingJsonLd() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 12);
    for (const s of scripts) {
      const raw = (s.textContent || "").trim();
      if (!raw) continue;
      if (!/jobposting/i.test(raw)) continue;
      return true;
    }
    return false;
  }

  function pageHasJobHeadings() {
    const headingCategories = [
      /(responsibilit|what you['’]ll do|what you will do|the role|role overview)/i,
      /(qualifications|required|requirements|what you bring|who you are|you have|essential traits)/i,
      /(about (the )?(company|us|team)|who we are|company overview|our mission)/i,
      /(benefits|perks|compensation|salary|equity|what we offer)/i
    ];

    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4")).slice(0, 60);
    for (const h of headings) {
      const t = normalizeSpace(extractTextFrom(h));
      if (!t) continue;
      if (headingCategories.some((re) => re.test(t))) return true;
    }
    return false;
  }

  function pageHasApplyCta() {
    const els = Array.from(document.querySelectorAll("a,button,input[type='button'],input[type='submit']")).slice(0, 120);
    for (const el of els) {
      const t = normalizeSpace(extractTextFrom(el) || el.getAttribute?.("value") || "");
      if (!t) continue;
      if (/\bapply\b/i.test(t)) return true;
    }
    return false;
  }

  function looksLikeUuid(s) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
  }

  function hasLinkedInSelectedJobIdParam(u) {
    const knownKeys = new Set(["currentjobid", "selectedjobid", "viewjobid", "jobid", "jobpostingid", "jobpostid"]);
    for (const [name, value] of u.searchParams.entries()) {
      const key = String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const v = String(value || "").trim();
      if (!v || v.length > 120) continue;
      if (knownKeys.has(key)) return true;
      if (key.includes("job") && key.includes("id")) return true;
    }
    return false;
  }

  function hasJobContentSignal(source) {
    return hasHighSignalJobDom(source) || pageHasJobPostingJsonLd() || (pageHasJobHeadings() && pageHasApplyCta());
  }

  function textHasJobishSignal(text) {
    return /job|career|position|opening|opportunit|role|recruit|hiring/i.test(String(text || ""));
  }

  function urlHasJobishSignal(u) {
    const parts = [u.hostname, u.pathname, u.search, document.title || ""]
      .map((s) => {
        try {
          return decodeURIComponent(String(s || ""));
        } catch {
          return String(s || "");
        }
      })
      .join(" ");
    return textHasJobishSignal(parts);
  }

  function ashbyLooksLikeJobDetail(segs) {
    const nonDetail = new Set(["", "companies", "company", "jobs", "search", "login", "signup"]);
    if (segs.length < 2) return false;
    if (nonDetail.has(String(segs[0] || "")) || nonDetail.has(String(segs[1] || ""))) return false;
    return String(segs[1] || "").length >= 6;
  }

  function greenhouseLooksLikeJobDetail(segs) {
    const idx = segs.indexOf("jobs");
    if (idx === -1 || idx >= segs.length - 1) return false;
    return /^[a-z0-9-]{4,}$/i.test(String(segs[idx + 1] || ""));
  }

  function workdayLooksLikeJobDetail(segs) {
    const idx = segs.indexOf("job");
    return idx >= 0 && idx < segs.length - 1;
  }

  function ultiproLooksLikeJobDetail(u, path) {
    if (!path.includes("/opportunitydetail")) return false;
    const id = String(u.searchParams.get("opportunityId") || u.searchParams.get("opportunityid") || "");
    return looksLikeUuid(id);
  }

  function atsLooksLikeJobDetail(source, u, segs, path) {
    if (source === "ashby") return ashbyLooksLikeJobDetail(segs);
    if (source === "greenhouse") return greenhouseLooksLikeJobDetail(segs);
    if (source === "workday") return workdayLooksLikeJobDetail(segs);
    if (source === "ultipro") return ultiproLooksLikeJobDetail(u, path);
    return false;
  }

  function shouldShowWidgetOnThisUrl() {
    let u;
    try {
      u = new URL(location.href);
    } catch {
      return false;
    }

    const source = inferSource();
    const path = String(u.pathname || "").toLowerCase();
    const segs = urlSegs(path);

    // Keep LinkedIn conservative; broad `/jobs` pages are noisy until a job is selected.
    if (source === "linkedin") {
      return urlLooksLikeJobDetail() || hasHighSignalJobDom("linkedin");
    }

    if (shouldAutoScoreOnThisUrl()) return true;

    if (source === "ashby" || source === "greenhouse" || source === "workday" || source === "ultipro") {
      if (atsLooksLikeJobDetail(source, u, segs, path)) return true;
    }

    return urlHasJobishSignal(u) || genericLooksLikeJobPosting({ segs });
  }

  function genericLooksLikeJobPosting({ segs }) {
    const idxJobs = segs.indexOf("jobs");
    const idxCareers = segs.indexOf("careers");
    const idxPositions = segs.indexOf("positions");
    const idxOpenings = segs.indexOf("openings");
    const idxJob = segs.indexOf("job");

    const idx = [idxJobs, idxCareers, idxPositions, idxOpenings, idxJob].filter((n) => n >= 0).sort((a, b) => a - b)[0];
    const nonDetail = new Set(["search", "discover", "preferences", "settings", "alerts", "onboarding", "signup", "login"]);
    const urlLooksLikeDetail = idx != null && idx >= 0 && idx < segs.length - 1 && !nonDetail.has(String(segs[idx + 1] || ""));

    const schemaSignal = pageHasJobPostingJsonLd();
    const headingSignal = pageHasJobHeadings();
    const applySignal = pageHasApplyCta();

    if (schemaSignal && (headingSignal || applySignal)) return true;
    if (urlLooksLikeDetail && (headingSignal || schemaSignal)) return true;
    return false;
  }

  function shouldAutoScoreOnThisUrl() {
    let u;
    try {
      u = new URL(location.href);
    } catch {
      return false;
    }

    const source = inferSource();
    const path = String(u.pathname || "").toLowerCase();
    const segs = urlSegs(path);

    // LinkedIn: only score when a specific job is selected/viewed.
    if (source === "linkedin") {
      if (!path.startsWith("/jobs")) return false;
      if (path.includes("/jobs/view/")) return true;
      if (hasLinkedInSelectedJobIdParam(u)) return true;
      if (hasHighSignalJobDom("linkedin")) return true;
      return false;
    }

    // Wellfound/Otta: require a concrete `/jobs/<something>` style URL AND a real job description container.
    if (source === "wellfound" || source === "otta") {
      const idx = segs.indexOf("jobs");
      if (idx === -1) return false;
      if (idx >= segs.length - 1) return false;
      const next = String(segs[idx + 1] || "");
      const nonDetail = new Set(["search", "discover", "preferences", "settings", "alerts", "onboarding", "signup", "login"]);
      if (nonDetail.has(next)) return false;
      if (!hasHighSignalJobDom(source)) return false;
      return true;
    }

    // X: only on a tweet detail view.
    if (source === "x") {
      return segs.includes("status");
    }

    // Lever: only on a posting detail page.
    if (source === "lever") {
      if (segs.length < 2) return false;
      const id = String(segs[1] || "");
      if (!looksLikeUuid(id)) return false;
      if (!hasHighSignalJobDom("lever") && !pageHasJobPostingJsonLd()) return false;
      return true;
    }

    if (source === "ashby" || source === "greenhouse" || source === "workday" || source === "ultipro") {
      if (!atsLooksLikeJobDetail(source, u, segs, path)) return false;
      return hasJobContentSignal(source);
    }

    // Generic (enabled per-site): be conservative and require clear job signals.
    if (source === "unknown") {
      return genericLooksLikeJobPosting({ segs });
    }

    return false;
  }

  function urlLooksLikeJobDetail() {
    let u;
    try {
      u = new URL(location.href);
    } catch {
      return false;
    }

    const source = inferSource();
    const path = String(u.pathname || "").toLowerCase();
    const segs = urlSegs(path);

    if (source === "linkedin") {
      if (!path.startsWith("/jobs")) return false;
      if (path.includes("/jobs/view/")) return true;
      if (hasLinkedInSelectedJobIdParam(u)) return true;
      return false;
    }

    if (source === "wellfound" || source === "otta") {
      const idx = segs.indexOf("jobs");
      if (idx === -1) return false;
      if (idx >= segs.length - 1) return false;
      const next = String(segs[idx + 1] || "");
      const nonDetail = new Set(["search", "discover", "preferences", "settings", "alerts", "onboarding", "signup", "login"]);
      if (nonDetail.has(next)) return false;
      return true;
    }

    if (source === "x") return segs.includes("status");
    if (source === "lever") return segs.length >= 2 && looksLikeUuid(String(segs[1] || ""));
    if (source === "ashby" || source === "greenhouse" || source === "workday" || source === "ultipro") {
      return atsLooksLikeJobDetail(source, u, segs, path);
    }
    if (source === "unknown") return genericLooksLikeJobPosting({ segs });
    return false;
  }

  function scheduleRetryIfNeeded() {
    const url = location.href;
    if (retryUrl !== url) {
      retryUrl = url;
      retryCount = 0;
    }

    if (retryCount >= 20) return;
    retryCount += 1;

    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void analyze();
    }, 650);
  }

  async function refreshSignedIn() {
    try {
      const resp = await sendMessage({ type: "SHORTLISTR_GET_STATE" });
      signedIn = Boolean(resp && resp.ok && resp.backend && resp.backend.apiToken === "set");
    } catch {
      signedIn = false;
    }
    return signedIn;
  }

  function scoreColor(score) {
    if (score >= 95) return "#22c55e";
    if (score >= 87) return "#22c55e";
    if (score >= 79) return "#38bdf8";
    if (score >= 70) return "#fbbf24";
    if (score >= 65) return "#fbbf24";
    return "#fb7185";
  }

  function setStatus(summary, meta) {
    if (typeof summary === "string") elSummary.textContent = summary;
    if (typeof meta === "string") elMeta.textContent = meta;
  }

  function setLabeled(el, { label, kind, text, title }) {
    if (!el) return;
    const t = cleanOneLine(text);
    if (!t) {
      el.textContent = "";
      el.title = "";
      el.removeAttribute("data-kind");
      return;
    }

    el.textContent = "";
    el.dataset.kind = String(kind || "").trim() || "info";
    el.title = typeof title === "string" ? title : "";

    const k = document.createElement("span");
    k.className = `sl-k sl-k-${String(kind || "info").trim() || "info"}`;
    k.textContent = label || "";

    const v = document.createElement("span");
    v.className = "sl-v";
    v.textContent = t;

    el.appendChild(k);
    el.appendChild(document.createTextNode(" "));
    el.appendChild(v);
  }

  function setTip(tip) {
    if (!elTip) return;
    const t = cleanOneLine(tip);
    if (!t) {
      elTip.textContent = "";
      elTip.classList.add("sl-hidden");
      return;
    }
    elTip.textContent = t;
    elTip.classList.remove("sl-hidden");
  }

  function setTldr(tldr) {
    if (!elTldr) return;
    const t = cleanOneLine(tldr);
    if (!t) {
      elTldr.textContent = "";
      elTldr.classList.add("sl-hidden");
      return;
    }
    elTldr.textContent = t;
    elTldr.classList.remove("sl-hidden");
  }

  function setScore(score, label) {
    if (score == null) {
      elScore.textContent = "—";
      elScore.style.color = "#e8ecff";
      return;
    }
    elScore.textContent = String(score);
    elScore.style.color = scoreColor(score);
    elScore.title = label ? `${score} — ${label}` : `${score}`;
  }

  function setSavedIndicator({ saved, alreadySaved, saved_via }) {
    if (!elSaved) return;
    const isSaved = Boolean(saved || alreadySaved);
    if (!isSaved) {
      elSaved.textContent = "";
      elSaved.title = "";
      elSaved.classList.add("sl-hidden");
      elSaved.classList.remove("auto");
      return;
    }

    const via = String(saved_via || "").toLowerCase();
    const auto = via === "auto";
    elSaved.textContent = auto ? "✓ Auto-saved" : "✓ Saved";
    elSaved.title = auto ? "Auto-saved to your Shortlist Inbox." : "Saved to your Shortlist Inbox.";
    elSaved.classList.toggle("auto", auto);
    elSaved.classList.remove("sl-hidden");
  }

  function setWhy(reasons, concerns) {
    const rs = Array.isArray(reasons) ? reasons.filter(Boolean).slice(0, 3) : [];
    const cs = Array.isArray(concerns) ? concerns.filter(Boolean).slice(0, 2) : [];

    setLabeled(elReasons, { label: "Why", kind: "why", text: rs.join(" · ") });
    setLabeled(elConcerns, { label: "Concerns", kind: "concerns", text: cs.join(" · ") });
  }

  function setLenses(personas) {
    const ps = Array.isArray(personas) ? personas : [];
    const items = ps
      .map((p) => ({
        label: String(p && (p.label || p.persona) ? p.label || p.persona : "").trim(),
        adjustedScore: Number(p && p.adjustedScore),
        delta: Number(p && p.delta),
        notes: Array.isArray(p && p.notes) ? p.notes.map((s) => String(s)).filter(Boolean).slice(0, 2) : []
      }))
      .filter((p) => p.label && Number.isFinite(p.adjustedScore))
      .slice(0, 2);

    if (items.length === 0) {
      setLabeled(elPersonas, { label: "Lenses", kind: "lenses", text: "" });
      return;
    }

    const parts = items.map((p) => {
      const d = Number.isFinite(p.delta) && p.delta !== 0 ? `${p.delta > 0 ? "+" : ""}${p.delta}` : "±0";
      return `${p.label}: ${Math.round(p.adjustedScore)} (${d})`;
    });
    const title = items
      .map((p) => {
        const d = Number.isFinite(p.delta) && p.delta !== 0 ? `${p.delta > 0 ? "+" : ""}${p.delta}` : "±0";
        const note = p.notes.length ? ` — ${p.notes.join(" / ")}` : "";
        return `${p.label} (${d})${note}`;
      })
      .join("\n");

    setLabeled(elPersonas, { label: "Lenses", kind: "lenses", text: parts.join(" · "), title });
  }

  function cleanOneLine(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shortText(s, maxLen) {
    const t = cleanOneLine(s);
    if (!maxLen || t.length <= maxLen) return t;
    return t.slice(0, maxLen).trim() + "…";
  }

  function setNeedsAndValue(needs, hiddenValue, questions) {
    const ns = Array.isArray(needs) ? needs : [];
    const vs = Array.isArray(hiddenValue) ? hiddenValue : [];
    const qs = Array.isArray(questions) ? questions : [];

    const needItems = ns
      .map((n) => ({
        need: cleanOneLine(n && n.need),
        confidence: Number(n && n.confidence),
        evidence: Array.isArray(n && n.evidence) ? n.evidence.map((e) => cleanOneLine(e)).filter(Boolean).slice(0, 2) : []
      }))
      .filter((n) => n.need)
      .slice(0, 3);

    const valueItems = vs
      .map((v) => ({
        value: cleanOneLine(v && v.value),
        maps_to_need: cleanOneLine(v && v.maps_to_need),
        confidence: Number(v && v.confidence),
        evidence: Array.isArray(v && v.evidence) ? v.evidence.map((e) => cleanOneLine(e)).filter(Boolean).slice(0, 2) : []
      }))
      .filter((v) => v.value)
      .slice(0, 3);

    if (needItems.length === 0) {
      setLabeled(elNeeds, { label: "Needs", kind: "needs", text: "" });
    } else {
      const title = needItems
        .map((n) => {
          const conf = Number.isFinite(n.confidence) ? ` (${Math.round(n.confidence * 100)}%)` : "";
          const ev = n.evidence.length ? ` — ${n.evidence.join(" / ")}` : "";
          return `${n.need}${conf}${ev}`;
        })
        .join("\n");
      setLabeled(elNeeds, {
        label: "Needs",
        kind: "needs",
        text: needItems.map((n) => shortText(n.need, 60)).join(" · "),
        title
      });
    }

    if (valueItems.length === 0) {
      setLabeled(elValue, { label: "Value", kind: "value", text: "" });
    } else {
      const qText = qs.map((q) => cleanOneLine(q)).filter(Boolean).slice(0, 6);
      const qBlock = qText.length ? `\n\nQuestions to validate:\n- ${qText.join("\n- ")}` : "";
      const title =
        valueItems
          .map((v) => {
            const conf = Number.isFinite(v.confidence) ? ` (${Math.round(v.confidence * 100)}%)` : "";
            const map = v.maps_to_need ? ` → ${v.maps_to_need}` : "";
            const ev = v.evidence.length ? ` — ${v.evidence.join(" / ")}` : "";
            return `${v.value}${conf}${map}${ev}`;
          })
          .join("\n") + qBlock;

      setLabeled(elValue, {
        label: "Value",
        kind: "value",
        text: valueItems.map((v) => shortText(v.value, 60)).join(" · "),
        title
      });
    }
  }

  function extractTextFrom(el) {
    if (!el) return "";
    const a = (el.innerText || "").trim();
    const b = (el.textContent || "").trim();
    if (!a) return b;
    if (!b) return a;
    return b.length > a.length * 1.15 ? b : a;
  }

  function firstText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = extractTextFrom(el);
      if (t) return t;
    }
    return "";
  }

  function normalizeSpace(s) {
    return String(s || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function truncate(s, maxChars) {
    const t = normalizeSpace(s);
    if (t.length <= maxChars) return t;
    return t.slice(0, maxChars) + "\n\n[truncated]";
  }

  function inferSource() {
    const host = location.hostname;
    if (host.includes("linkedin.com")) return "linkedin";
    if (host.includes("wellfound.com")) return "wellfound";
    if (host.includes("otta.com")) return "otta";
    if (host === "x.com" || host.endsWith(".x.com")) return "x";
    if (host === "jobs.lever.co" || host.endsWith(".lever.co")) return "lever";
    if (host === "jobs.ashbyhq.com") return "ashby";
    if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") return "greenhouse";
    if (host.endsWith(".myworkdayjobs.com") || host.endsWith(".workdayjobs.com")) return "workday";
    if (host === "recruiting.ultipro.com") return "ultipro";
    return "unknown";
  }

  function extractJob() {
    const source = inferSource();
    const url = location.href;

    const titleSelectorsBySource = {
      linkedin: ["h1", ".jobs-unified-top-card__job-title", ".job-details-jobs-unified-top-card__job-title"],
      wellfound: ["h1"],
      otta: ["h1"],
      x: ["article h1", "h1", "title"],
      lever: ["[data-qa='posting-name']", ".posting-headline__title", ".posting-headline h2", "h1", "h2", "title"],
      ashby: ["h1", "[data-testid='job-title']", "title"],
      greenhouse: ["h1", "[data-testid='job-title']", ".job__title", "title"],
      workday: [
        "[data-automation-id='jobPostingHeader'] h1",
        "[data-automation-id='jobPostingHeader'] h2",
        "[data-automation-id='jobPostingHeader']",
        "h1",
        "h2",
        "title"
      ],
      ultipro: ["h1", "[data-automation-id='jobTitle']", ".opportunity-title", "title"]
    };

    const companySelectorsBySource = {
      linkedin: [
        ".job-details-jobs-unified-top-card__company-name",
        ".jobs-unified-top-card__company-name",
        ".jobs-unified-top-card__company-name a"
      ],
      wellfound: ["[data-test='startup-link']", "a[href*='/company/']"],
      otta: ["a[href*='/company/']", "[data-testid='company-name']"],
      x: ["article a[role='link'][href^='/']"],
      lever: ["[data-qa='posting-company-name']", ".posting-headline__company", ".posting-headline .company", ".posting-company"],
      ashby: ["[data-testid='company-name']"],
      greenhouse: ["[data-testid='company-name']", ".company-name"],
      workday: ["[data-automation-id='jobPostingCompany']", "[data-automation-id='company']"],
      ultipro: ["[data-automation-id='companyName']", ".company-name"]
    };

    const locationSelectorsBySource = {
      linkedin: [".jobs-unified-top-card__bullet", ".job-details-jobs-unified-top-card__primary-description-container"],
      wellfound: ["[data-test='JobPostingLocation']", "[data-test='location']"],
      otta: ["[data-testid='job-location']", "[data-testid='location']"],
      x: [],
      lever: ["[data-qa='posting-location']", ".posting-headline__location", ".posting-categories__location", ".location"],
      ashby: ["[data-testid='job-location']", "[data-testid='location']", ".location"],
      greenhouse: ["[data-testid='job-location']", ".job__location", ".location"],
      workday: ["[data-automation-id='locations']", "[data-automation-id='location']", "[data-automation-id='jobPostingLocation']"],
      ultipro: ["[data-automation-id='location']", ".opportunity-location", ".location"]
    };

    const descSelectorsBySource = {
      linkedin: [
        // Legacy/known
        ".jobs-description__content",
        ".jobs-description-content__text",
        ".jobs-box__html-content",
        // Newer SDUI/job-details surfaces (more stable than hashed classnames)
        "div[data-view-name='job-details-job-details-component']",
        "div[data-sdui-component*='aboutTheJob']",
        "div[componentkey*='JobDetails_AboutTheJob']",
        "span[data-test-id='expandable-text-box']",
        // Company / benefits sections on the listing page
        "div[componentkey*='JobDetails_AboutTheCompany']",
        "div[componentkey*='JobDetails_Benefits']"
      ],
      wellfound: ["[data-test='JobPostingDescription']", "main"],
      otta: ["[data-testid='job-description']", "main"],
      x: ["article"],
      lever: ["[data-qa='posting-description']", ".posting-description", ".posting", "main"],
      ashby: ["[data-testid='job-posting-description']", "[data-testid='job-posting']", "main", "article"],
      greenhouse: ["[data-testid='job-post-description']", "#content", "main", "article"],
      workday: [
        "[data-automation-id='jobPostingDescription']",
        "[data-automation-id='jobDescription']",
        "[data-automation-id='jobPostingPage']",
        "main"
      ],
      ultipro: ["#OpportunityDetail", ".opportunity-detail", "[data-automation-id='opportunityDetail']", "main"]
    };

    const title = firstText(titleSelectorsBySource[source] || ["h1", "title"]);
    const company = firstText(companySelectorsBySource[source] || []);
    const locationText = firstText(locationSelectorsBySource[source] || []);

    function stripHtmlTags(s) {
      return String(s || "").replace(/<[^>]*>/g, " ");
    }

    function collectJobPostingNodes(node, out) {
      if (!node) return;
      if (Array.isArray(node)) {
        for (const v of node) collectJobPostingNodes(v, out);
        return;
      }
      if (typeof node !== "object") return;

      const t = node["@type"];
      const types = Array.isArray(t) ? t : t ? [t] : [];
      if (types.some((x) => String(x).toLowerCase() === "jobposting")) out.push(node);

      if (node["@graph"]) collectJobPostingNodes(node["@graph"], out);
      for (const k of Object.keys(node)) {
        if (k === "@type" || k === "@context") continue;
        collectJobPostingNodes(node[k], out);
      }
    }

    function extractJsonLdJobText() {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      const parts = [];
      let bestTitle = "";
      let bestCompany = "";
      let bestLocation = "";

      function pickLocation(j) {
        try {
          const loc = j.jobLocation;
          const first = Array.isArray(loc) ? loc[0] : loc;
          const addr = first?.address || first?.jobLocation?.address || first;
          const locality = addr?.addressLocality || "";
          const region = addr?.addressRegion || "";
          const country = addr?.addressCountry || "";
          const segs = [locality, region, country].map((x) => String(x || "").trim()).filter(Boolean);
          return segs.join(", ");
        } catch {
          return "";
        }
      }

      for (const s of scripts) {
        const raw = (s.textContent || "").trim();
        if (!raw) continue;
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          continue;
        }

        const jobs = [];
        collectJobPostingNodes(data, jobs);
        for (const j of jobs) {
          const title2 = j.title || j.name || "";
          const company2 = j.hiringOrganization?.name || "";
          const loc2 = pickLocation(j);

          if (!bestTitle && title2) bestTitle = String(title2);
          if (!bestCompany && company2) bestCompany = String(company2);
          if (!bestLocation && loc2) bestLocation = String(loc2);

          const desc = stripHtmlTags(j.description || j.articleBody || "");
          const responsibilities = Array.isArray(j.responsibilities) ? j.responsibilities.join("\n") : j.responsibilities || "";
          const qualifications = Array.isArray(j.qualifications) ? j.qualifications.join("\n") : j.qualifications || "";

          const text = normalizeSpace(
            [
              title2 ? `Title: ${title2}` : "",
              company2 ? `Company: ${company2}` : "",
              loc2 ? `Location: ${loc2}` : "",
              desc ? `Description:\n${desc}` : "",
              responsibilities ? `Responsibilities:\n${stripHtmlTags(responsibilities)}` : "",
              qualifications ? `Qualifications:\n${stripHtmlTags(qualifications)}` : ""
            ]
              .filter(Boolean)
              .join("\n\n")
          );
          if (text) parts.push(text);
        }
      }
      return { text: parts.join("\n\n----\n\n"), title: bestTitle, company: bestCompany, location: bestLocation };
    }

    function bodyInnerTextWithoutWidget() {
      try {
        const prev = root.style.display;
        root.style.display = "none";
        const t = document.body ? document.body.innerText : "";
        root.style.display = prev;
        return t;
      } catch {
        return document.body ? document.body.innerText : "";
      }
    }

    const candidates = [];
    const seen = new Set();

    function addCandidate({ label, sourceKind, selector, text, priority }) {
      const cleaned = normalizeSpace(text);
      if (!cleaned) return;
      const lower = cleaned.toLowerCase();
      const head = lower.slice(0, 220);
      const tail = lower.slice(Math.max(0, lower.length - 220));
      const key = `${head}|${tail}|${lower.length}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({
        id: `${sourceKind}:${selector || "na"}:${candidates.length}`,
        label: String(label || ""),
        source: String(sourceKind || ""),
        selector: selector ? String(selector) : "",
        text: truncate(cleaned, 9000),
        priority: Number(priority) || 0
      });
    }

    // 1) Structured data (best when available)
    const jsonLd = extractJsonLdJobText();
    if (jsonLd && jsonLd.text) {
      addCandidate({
        label: "JSON-LD JobPosting",
        sourceKind: "jsonld",
        selector: 'script[type="application/ld+json"]',
        text: jsonLd.text,
        priority: 5
      });
    }

    function metaContent(selectors) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const c = (el.getAttribute("content") || "").trim();
        if (c) return c;
      }
      return "";
    }

    const pageMetaDesc = metaContent([
      "meta[name='description']",
      "meta[property='og:description']",
      "meta[name='twitter:description']"
    ]);
    if (pageMetaDesc) {
      addCandidate({
        label: "Page meta description",
        sourceKind: "meta",
        selector: "meta",
        text: pageMetaDesc,
        priority: 1
      });
    }

    // 2) Site-specific selectors (known description containers)
    for (const sel of descSelectorsBySource[source] || []) {
      const els = Array.from(document.querySelectorAll(sel));
      for (let i = 0; i < els.length; i += 1) {
        const t = extractTextFrom(els[i]);
        if (!t) continue;
        addCandidate({ label: `Description (${sel})`, sourceKind: "selector", selector: sel, text: t, priority: 4 });
      }
    }

    // 2b) Heading-based section blocks (helps pull Requirements / About company / Benefits)
    const headingCategories = [
      {
        id: "responsibilities",
        label: "Responsibilities",
        re: /(responsibilit|what you['’]ll do|what you will do|the role|role overview)/i
      },
      {
        id: "requirements",
        label: "Requirements",
        re: /(qualifications|required|requirements|what you bring|who you are|you have)/i
      },
      {
        id: "about_company",
        label: "About the company",
        re: /(about (the )?(company|us|team)|who we are|company overview|our mission)/i
      },
      {
        id: "benefits",
        label: "Benefits & perks",
        re: /(benefits|perks|compensation|salary|equity|what we offer)/i
      }
    ];

    function bestContainerTextForHeading(h) {
      const els = [];
      const sec = h.closest("section");
      if (sec) els.push(sec);
      if (h.parentElement) els.push(h.parentElement);
      if (h.parentElement && h.parentElement.parentElement) els.push(h.parentElement.parentElement);
      let best = "";
      for (const el of els) {
        const t = normalizeSpace(extractTextFrom(el));
        if (t.length > best.length) best = t;
      }
      return best;
    }

    const bestByCategory = new Map();
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4"));
    for (const h of headings) {
      const ht = normalizeSpace(extractTextFrom(h));
      if (!ht) continue;
      for (const cat of headingCategories) {
        if (!cat.re.test(ht)) continue;
        const blockText = bestContainerTextForHeading(h);
        if (blockText.length < 240) continue;
        const prev = bestByCategory.get(cat.id);
        if (!prev || blockText.length > prev.text.length) bestByCategory.set(cat.id, { heading: ht, text: blockText });
      }
    }

    for (const cat of headingCategories) {
      const found = bestByCategory.get(cat.id);
      if (!found) continue;
      addCandidate({
        label: `${cat.label}: ${found.heading.slice(0, 60)}`,
        sourceKind: "heading",
        selector: cat.id,
        text: found.text,
        priority: 3
      });
    }

    // 3) Generic fallbacks
    addCandidate({
      label: "Main content",
      sourceKind: "main",
      selector: "main",
      text: extractTextFrom(document.querySelector("main")),
      priority: 2
    });
    addCandidate({
      label: "Article content",
      sourceKind: "article",
      selector: "article",
      text: extractTextFrom(document.querySelector("article")),
      priority: 2
    });
    addCandidate({
      label: "Body text",
      sourceKind: "body",
      selector: "body",
      text: bodyInnerTextWithoutWidget(),
      priority: 1
    });

    // Keep the best candidates (prioritize known/structured, then length)
    candidates.sort((a, b) => b.priority - a.priority || b.text.length - a.text.length);
    const bodyCandidate = candidates.find((c) => c.source === "body");
    const bestCandidates = candidates.slice(0, 10).map(({ priority, ...c }) => c);
    if (bodyCandidate && !bestCandidates.some((c) => c.source === "body")) {
      bestCandidates[bestCandidates.length - 1] = (({ priority, ...c }) => c)(bodyCandidate);
    }

    const bestDescription = bestCandidates.length ? bestCandidates[0].text : "";
    const description = truncate(bestDescription, 12000);

    return {
      source,
      url,
      title: truncate(title || jsonLd?.title || "", 200),
      company: truncate(company || jsonLd?.company || "", 200),
      location: truncate(locationText || jsonLd?.location || "", 200),
      description,
      descriptionCandidates: bestCandidates
    };
  }

  function sameJob(a, b) {
    if (!a || !b) return false;
    return a.url === b.url && a.title === b.title;
  }

  async function analyze(opts = {}) {
    if (analyzing) return;
    analyzing = true;
    try {
      const force = Boolean(opts.force);
      const shouldShow = force || shouldShowWidgetOnThisUrl();
      const shouldAutoScore = force || shouldAutoScoreOnThisUrl();
      root.style.display = shouldShow ? "" : "none";
      if (!shouldShow) {
        if (urlLooksLikeJobDetail()) scheduleRetryIfNeeded();
        return;
      }

      if (!shouldAutoScore) {
        if (urlLooksLikeJobDetail()) scheduleRetryIfNeeded();

        const authed = await refreshSignedIn();
        lastJob = null;
        lastAnalysis = null;
        btnShortlist.disabled = false;
        btnShortlist.textContent = authed ? "Analyze" : "Sign in";
        btnRescore.disabled = true;
        setStatus(
          urlLooksLikeJobDetail() ? "Found a job page." : "This page looks job-related.",
          authed ? "Click Analyze to score it." : "Click Sign in."
        );
        setScore(null);
        setSavedIndicator({ saved: false, alreadySaved: false, saved_via: "" });
        setTldr("");
        setTip("");
        setWhy([], []);
        setLenses([]);
        setNeedsAndValue([], [], []);
        return;
      }

      retryUrl = "";
      retryCount = 0;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }

      const authed = await refreshSignedIn();
      if (!authed) {
        lastJob = null;
        lastAnalysis = null;
        btnShortlist.disabled = false;
        btnShortlist.textContent = "Sign in";
        btnRescore.disabled = true;
        setStatus("Sign in to start scoring.", "Click Sign in.");
        setScore(null);
        setSavedIndicator({ saved: false, alreadySaved: false, saved_via: "" });
        setTldr("");
        setTip("");
        setWhy([], []);
        setLenses([]);
        setNeedsAndValue([], [], []);
        return;
      }

      const job = extractJob();
      lastJob = job;
      setStatus("Analyzing job fit…", "");
      setScore(null);
      setSavedIndicator({ saved: false, alreadySaved: false, saved_via: "" });
      setTldr("");
      setTip("");
      setWhy([], []);
      setLenses([]);
      setNeedsAndValue([], [], []);
      btnShortlist.disabled = true;
      btnShortlist.textContent = "Shortlist";
      btnRescore.disabled = true;

      const resp = await sendMessage({ type: "SHORTLISTR_ANALYZE_JOB", job });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Analyze failed.");

      if (!sameJob(job, lastJob)) return;
      lastAnalysis = resp.analysis;

      setScore(resp.analysis.score, resp.analysis.label);
      setSavedIndicator({ saved: resp.saved, alreadySaved: resp.alreadySaved, saved_via: resp.analysis.saved_via });
      setTldr(resp.analysis.tldr);
      setTip(resp.analysis.resume_or_cover_letter_tip);
      setWhy(resp.analysis.reasons, resp.analysis.concerns);
      setLenses(resp.analysis.personas);
      setNeedsAndValue(resp.analysis.implied_company_needs, resp.analysis.candidate_hidden_value, resp.analysis.questions_to_validate);
      const action = resp.analysis.action;
      const label = String(resp.analysis.label || "").trim() || "Fit score";
      let meta = "";
      if (resp.saved) meta = resp.analysis.saved_via === "auto" ? "Auto-saved to Shortlist Inbox." : "Saved to Shortlist Inbox.";
      else if (resp.alreadySaved) meta = resp.analysis.saved_via === "auto" ? "Auto-saved." : "Saved.";
      else if (action === "auto_shortlist") meta = resp.saveError ? "Auto-save failed — click Shortlist to save." : `${label} — click Shortlist to save.`;
      else if (action === "prompt_shortlist") meta = `${label} — click Shortlist to save.`;
      else if (action === "skip") meta = `${label} — save anyway if you want.`;
      setStatus(resp.analysis.summary || "Done.", meta);

      btnShortlist.disabled = resp.saved || resp.alreadySaved;
      btnShortlist.textContent = resp.saved || resp.alreadySaved ? "Saved" : action === "skip" ? "Save" : "Shortlist";
      btnRescore.disabled = false;
    } catch (e) {
      const msg = e?.message || String(e);
      if (/sign in/i.test(msg)) {
        signedIn = false;
        btnShortlist.disabled = false;
        btnShortlist.textContent = "Sign in";
        btnRescore.disabled = true;
        setStatus("Sign in to start scoring.", "Click Sign in.");
      } else if (/daily limit/i.test(msg)) {
        setStatus("Daily limit hit.", "Try again tomorrow.");
      } else {
        setStatus("Couldn’t score this page yet.", msg);
      }
      setScore(null);
      setSavedIndicator({ saved: false, alreadySaved: false, saved_via: "" });
      setTldr("");
      setTip("");
      setWhy([], []);
      setLenses([]);
      setNeedsAndValue([], [], []);
      if (!/sign in/i.test(msg)) btnShortlist.disabled = true;
    } finally {
      analyzing = false;
    }
  }

  btnRescore.addEventListener("click", async () => {
    try {
      if (analyzing) return;
      if (!signedIn) {
        await sendMessage({ type: "SHORTLISTR_OPEN_OPTIONS" });
        return;
      }

      const job = lastJob || extractJob();
      await sendMessage({ type: "SHORTLISTR_CLEAR_JOB_CACHE", job });
      setStatus("Re-scoring…", "");
      setScore(null);
      setWhy([], []);
      btnRescore.disabled = true;
      setTimeout(() => void analyze(), 50);
    } catch (e) {
      const msg = e?.message || String(e);
      if (/daily limit/i.test(msg)) setStatus("Daily limit hit.", "Try again tomorrow.");
      else setStatus("Couldn’t re-score yet.", msg);
      btnRescore.disabled = false;
    }
  });

  btnClearCache.addEventListener("click", async () => {
    try {
      if (analyzing) return;
      const ok = confirm(
        "Clear cached scores for all jobs?\n\nThis forces a fresh score the next time you analyze a posting (more API usage)."
      );
      if (!ok) return;
      await sendMessage({ type: "SHORTLISTR_CLEAR_CACHE" });
      setStatus("Cleared cached scores.", "Click Re-score to refresh this page.");
    } catch (e) {
      const msg = e?.message || String(e);
      setStatus("Couldn’t clear cache.", msg);
    }
  });

  btnShortlist.addEventListener("click", async () => {
    try {
      if (!signedIn) {
        await sendMessage({ type: "SHORTLISTR_OPEN_OPTIONS" });
        return;
      }
      if (!lastAnalysis) {
        btnShortlist.disabled = true;
        btnShortlist.textContent = "Analyzing…";
        await analyze({ force: true });
        return;
      }
      if (!lastJob) lastJob = extractJob();
      btnShortlist.disabled = true;
      btnShortlist.textContent = "Saving…";
      const resp = await sendMessage({ type: "SHORTLISTR_SAVE_JOB", job: lastJob, analysis: lastAnalysis });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Save failed.");
      btnShortlist.textContent = "Saved";
      lastAnalysis = { ...lastAnalysis, saved_via: "manual" };
      setSavedIndicator({ saved: true, alreadySaved: true, saved_via: "manual" });
      setStatus(elSummary.textContent, "Saved to Shortlist Inbox.");
    } catch (e) {
      btnShortlist.disabled = false;
      btnShortlist.textContent = "Shortlist";
      setStatus(elSummary.textContent, e.message || String(e));
    }
  });

  btnInbox.addEventListener("click", () => {
    void sendMessage({ type: "SHORTLISTR_OPEN_INBOX" });
  });

  btnOptions.addEventListener("click", () => {
    void sendMessage({ type: "SHORTLISTR_OPEN_OPTIONS" });
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "SHORTLISTR_EXTRACT_JOB") {
      try {
        sendResponse(extractJob());
      } catch {
        sendResponse({ source: inferSource(), url: location.href, title: "", company: "", location: "", description: "" });
      }
    }
  });

  // Re-analyze when SPA navigation happens
  let lastUrl = location.href;
  const mo = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => void analyze(), 800);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Initial analyze (after content settles)
  setTimeout(() => void analyze(), 900);
})();
