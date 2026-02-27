# Shortlistr — Privacy (Draft)

Shortlistr is an applicant-first Chrome extension that scores job fit on the posting.

## What Shortlistr stores locally

Stored in `chrome.storage.local` on your device:

- Your preferences (what you’re looking for, strengths, must-haves, avoid list)
- Resume text (if you paste/extract it)
- Shortlisted roles (URL + extracted posting text + fit analysis)

## What Shortlistr sends to the backend

When scoring a posting, the extension sends:

- Job posting text (title/company/location/description) extracted from the page
- Your preferences (so the score is personalized)
- Your resume text (if you provided it)

## What Shortlistr stores on the backend (when enabled)

If you run the backend with MongoDB configured, the backend stores data under your account so the extension can sync across devices:

- Your preferences (profile + thresholds)
- Your resume text (if provided)
- Your Shortlist Inbox items (job metadata + extracted text + analysis)

## What the backend sends to the AI provider

The backend calls an AI model (e.g., OpenAI) with the same information needed to generate:

- A Shortlistr Score (0–100)
- A short rationale (reasons + concerns)
- Suggested strengths to highlight

## Data retention

- The extension keeps your data locally unless you clear it.
- If you enable MongoDB persistence on the backend, data is retained until you delete it (Shortlist clear, account deletion tooling TBD).
- Hosting providers may retain operational logs.

## Notes

This is a draft privacy summary for development. If you plan to publish to the Chrome Web Store, you should provide a full privacy policy consistent with your deployed backend and logging setup.
