# Chrome Web Store listing — Shortlistr

## Name

Shortlistr

## Category

Productivity

## Tagline

Read less. Apply smarter.

## Short description (≤ 132 chars)

Turn job boards into a shortlist. AI-powered fit scoring on the posting—so you read less and apply smarter.

## Detailed description

Shortlistr is an AI-powered, applicant-first Chrome extension that turns long job posts into a clear decision.

Open a job posting and Shortlistr generates an AI-powered **Shortlistr Score (0–100)** based on the job’s description + requirements, matched against what **you’re looking for**, the **strengths you want to highlight**, and your **resume** (if you provide it)—not just keyword matching.

### What you get

- **Shortlistr Score (0–100)** directly on the posting
- **Fit rationale**: the signals that matter, plus gaps/red flags that waste time
- **Resume-aware scoring (optional)**: bring your experience into the fit evaluation
- **Fuzzy-role decoding**: helps interpret messy titles and vague requirements
- **Shortlist**: save roles in one click when you want to apply
- **Shortlist Inbox**: a saved-roles view so you can batch your next steps

### Smart saving

Score bands (what the number means):
- **95–100:** Exceptional / bullseye
- **87–94:** Very strong fit
- **79–86:** Good shot
- **70–78:** Apply, but odds are modest
- **65–69:** Edge-case / long-shot
- **0–64:** Probably no

Default behavior:
- **79+** auto-saves to your **Shortlist Inbox**
- **70–78** prompts you to save
- **<70** manual save only

### Supported sites (initial)

- LinkedIn
- X
- Wellfound
- Otta

### Screenshots (recommended 3–5)

Capture screenshots that show:

1. Popup on a job posting (score + summary)
2. Expanded details (TL;DR / concerns / highlights)
3. Shortlist Inbox (saved roles, sorting, open selected)
4. Options (profile + resume + thresholds)

Recommended sizes: 1280×800 or 640×400 (Chrome Web Store accepts multiple sizes).

## Required fields (fill in before publishing)

- **Support email:** `support@YOURDOMAIN.com` (replace)
- **Privacy policy URL:** `https://YOURDOMAIN.com/privacy` (replace)

### Not affiliated

Shortlistr is not affiliated with LinkedIn, X, Wellfound, or Otta.

## Permissions justification (for review)

- `storage`: save your profile/resume preferences, cached scores, and saved roles.
- `activeTab`: analyze the current tab only when you click “Analyze”.
- `scripting`: inject the content script/CSS needed to extract job text from the page.
- `permissions`: request optional site access only when you enable auto-analyze on a specific site.
- `sidePanel`: show the Shortlist Inbox as a side panel.

Host permissions are limited to supported job sites (and your API domain). Optional host permissions are used only for user-enabled auto-analyze on additional job-board platforms.
