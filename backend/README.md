# Shortlistr Backend

Node/Express API that runs the Shortlistr AI scoring pipeline.

## Endpoints

- `GET /health`
- `POST /v1/auth/signup`
- `POST /v1/auth/login`
- `GET /v1/state`
- `PUT /v1/state`
- `GET /v1/shortlist`
- `POST /v1/shortlist/upsert`
- `POST /v1/shortlist/delete`
- `POST /v1/shortlist/clear`
- `POST /v1/analyze`
- `POST /v1/resume/extract` (multipart form field: `file`)

## Environment variables

- `OPENAI_API_KEY` (required for AI scoring)
- `OPENAI_MODEL` (optional, default: `gpt-4o-mini`)
- `MONGODB_URI` (required for accounts + sync)
- `MONGODB_DB` (optional, default: `shortlistr`)
- `JWT_SECRET` (required; used to sign/verify JWTs)
- `JWT_EXPIRES_DAYS` (optional, default: `30`)
- `PORT` (optional, default: `8787`)
- `RATE_LIMIT_PER_MINUTE` (optional, default: `60`)
- `CORS_ORIGINS` (optional, comma-separated; if unset, allows all origins)

## Run locally

- `npm install`
- `npm run dev`
