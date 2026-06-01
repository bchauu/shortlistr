# Shortlistr — Privacy Policy (Template)

Shortlistr is an applicant-first Chrome extension that scores job fit on the posting.

This document is a template you can publish (after you replace the placeholders). If you publish to the Chrome Web Store, you should host this at a public URL (e.g., `https://YOURDOMAIN.com/privacy`) and link it in your store listing.

**Last updated:** 2026-02-27

## Summary (plain English)

- Shortlistr stores your profile/resume and saved roles so you can quickly shortlist jobs.
- Shortlistr sends job posting text + your profile/resume to your backend to generate a fit score.
- Your backend may send that same information to an AI provider (e.g., OpenAI) to produce the score and rationale.
- Shortlistr does **not** sell your data.

## Data we collect

Depending on what you choose to use, Shortlistr may collect:

- **Account data:** email + password (passwords are stored as a one-way hash on the backend).
- **Profile data:** what you’re looking for, strengths, work highlights, must-haves, nice-to-haves, avoid list, and scoring thresholds.
- **Resume content:** resume text (if you paste it or extract it from an uploaded file).
- **Job posting data:** the job URL, title/company/location, and job posting text extracted from the page.
- **Saved roles:** jobs you save to your Shortlist Inbox + the analysis output.
- **Usage data (limited):** daily analysis usage counters (for rate limiting/abuse prevention).

## What Shortlistr stores locally (on your device)

Stored in `chrome.storage.local` on your device:

- Your preferences (what you’re looking for, strengths, must-haves, avoid list)
- Resume text (if you paste/extract it)
- Shortlisted roles (URL + extracted posting text + fit analysis)

## What Shortlistr sends off-device (to your backend)

When scoring a posting, the extension sends:

- Job posting text (title/company/location/description) extracted from the page (and sometimes multiple extracted candidates to improve accuracy)
- Your preferences (so the score is personalized)
- Your resume text (if you provided it)

## What Shortlistr stores on the backend

When your backend is configured with a database (e.g., MongoDB), it stores data under your account so the extension can sync across devices:

- Your preferences (profile + thresholds)
- Your resume text (if provided)
- Your Shortlist Inbox items (job metadata + extracted text + analysis)

## What the backend sends to the AI provider (e.g., OpenAI)

The backend calls an AI model (e.g., OpenAI) with the same information needed to generate:

- A Shortlistr Score (0–100)
- A short rationale (reasons + concerns)
- Suggested strengths to highlight

In practice this typically includes:

- Job text + job metadata (URL, title, company, location)
- Your profile fields (looking for / strengths / work highlights / preferences)
- Resume text (if provided)

## Data retention

- The extension keeps your data locally unless you clear it.
- If you use backend persistence, your data is retained until you delete it (Shortlist clear, account deletion tooling TBD).
- Hosting providers and service providers may retain limited operational logs for reliability and security.

## Selling / sharing

- **We do not sell** your personal data.
- We may share data with **service providers** (hosting, database, AI model provider) only to operate the service.

## Security

- The extension communicates with your backend over HTTPS (in production).
- Passwords are stored as a one-way hash on the backend (not in plaintext).

## Contact

Support email: `support@YOURDOMAIN.com` (replace)

## Changes

If we update this policy, we will update the “Last updated” date above.

This policy must match your deployed backend behavior. Review and adjust before publishing.
