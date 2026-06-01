# Development

This repo is a monorepo with:

- `extension/` — Chrome extension (React + Vite)
- `backend/` — Node/Express API (Render-friendly)

## Backend (local)

1. Install deps:
   - `npm install`
2. Start the API:
   - `npm run dev:backend`
3. Set env vars (example):
   - `OPENAI_API_KEY=...`
   - `OPENAI_MODEL=gpt-4o-mini` (optional)
   - `MONGODB_URI=...` (required for accounts + sync)
   - `MONGODB_DB=shortlistr` (optional)
   - `JWT_SECRET=...` (required)
   - `JWT_EXPIRES_DAYS=30` (optional)
   - `PORT=8787` (optional)
   - Copy `backend/.env.example` → `backend/.env` if you prefer

Health check: `http://localhost:8787/health`

## Extension (local)

1. Install deps:
   - `npm install`
2. Build:
   - `npm run build:extension`
3. Load unpacked in Chrome:
   - `chrome://extensions` → enable Developer mode
   - “Load unpacked” → select `extension/dist`

## Configure the extension

Open **Options**:

- Sign up / sign in (stores a JWT in the extension)
- Fill out your profile + strengths + avoid list
- Upload/paste your resume
- Click **Save** to sync everything to your account (MongoDB)

Backend URL is fixed inside the extension:

- Update `extension/public/src/background/service_worker.js` → `FIXED_API_BASE_URL`
- Rebuild and reload the extension

Note: For local dev (`http://localhost:8787`), Chrome may prompt for permission on first sign-in (optional host permissions). For production, prefer adding your API origin to `extension/public/manifest.json` under `host_permissions` before publishing.

## Chrome Web Store release ZIP

To create a production-ready ZIP (with `manifest.json` at the ZIP root, no localhost endpoints, and a fixed HTTPS API base URL):

1. Deploy the backend (e.g., Render) and decide your production API base URL (must be HTTPS).
2. Run:
   - `SHORTLISTR_API_BASE_URL="https://your-api.example.com" bash extension/scripts/package-release.sh`
3. Upload the generated ZIP:
   - `shortlistr-extension.zip`
