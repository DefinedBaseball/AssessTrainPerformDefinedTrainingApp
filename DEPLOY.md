# Go-Live Deployment (Render + Bunny Stream)

This repo is set up to deploy as **two Render services + one managed Postgres**,
with video on **Bunny Stream**. Local dev is unaffected — it stays on SQLite +
local-disk video. The Postgres switch happens only inside the Render build
(`apps/api/scripts/use-postgres.js`).

## 1. Create accounts (you)
- **Render** — render.com
- **Bunny.net** → create a **Stream** library → open the library's **Encoding**
  tab → **enable "MP4 Fallback"** (required: our custom synced/drawing/
  frame-by-frame player needs a progressive MP4, not Bunny's iframe player).
  Note: MP4 fallback renditions cap at 720p — fine for our high-res recordings;
  if you ever upload a sub-720p clip, set `BUNNY_STREAM_MP4_QUALITY` lower (e.g.
  `480p`). Copy three values:
  - **Library ID**
  - **API key** (library API key)
  - **CDN hostname** (pull-zone host, e.g. `vz-xxxx-yyy.b-cdn.net`)
- **GitHub** — push this repo to a private repo (Render deploys from Git).

## 2. Deploy (Render Blueprint)
Point Render at this repo; it reads `render.yaml` and provisions:
`pdev-postgres`, `pdev-api`, `pdev-web`. `DATABASE_URL` and `JWT_SECRET` are wired
automatically. The API build flips Prisma to Postgres, pushes the schema, and runs
the idempotent prod seed (admin coach + drill library).

## 3. Set the dashboard env vars (not committed)
**pdev-api**
| Var | Value |
|-----|-------|
| `CORS_ORIGINS` | your web origin, e.g. `https://app.definedbaseball.com` |
| `STORAGE_DRIVER` | `bunny` (already defaulted in the blueprint) |
| `BUNNY_STREAM_LIBRARY_ID` | from Bunny |
| `BUNNY_STREAM_API_KEY` | from Bunny |
| `BUNNY_STREAM_CDN_HOSTNAME` | from Bunny (e.g. `vz-xxxx.b-cdn.net`) |
| `BUNNY_STREAM_MP4_QUALITY` | `720p` (default; match a resolution enabled on the library) |
| `SEED_PW_CONNOR` / `SEED_PW_JACOB` / `SEED_PW_DANIEL` | optional — override the 3 admin seed passwords (they default to `PasswordCoach`). Rotate at go-live. |

The 3 Admin coach accounts (`connor` / `jacob` / `daniel@definedbaseball.com`) are
seeded automatically as **Admin** level. They sign in, then create Coach/Viewer
accounts under Settings → Staff.

**pdev-web**
| Var | Value |
|-----|-------|
| `API_PROXY_TARGET` | the pdev-api public URL, e.g. `https://pdev-api-xxxx.onrender.com` |

## 4. Domain + HTTPS
Add a custom domain (e.g. `app.definedbaseball.com`) to **pdev-web** in Render, add
the CNAME it gives you at your DNS provider — Render issues TLS automatically. Then
set `CORS_ORIGINS` (api) to that origin and redeploy.

## 5. Smoke test
Log in as the admin → create a coach + player → record a clip and confirm it plays
on **iPhone and Android** → save a report → download a schedule PDF. Delete the test
accounts.

## Fast-follow (not required to launch)
- **SendGrid** + **Twilio** to deliver the Email/SMS notification channels and the
  forgot-password flow (the in-app bell works without them).
- A Bunny **webhook** to flip a video's status PROCESSING→READY precisely (today the
  API marks READY optimistically; short clips transcode in seconds).

## Rollback
The pre-go-live state is tagged: `git checkout save/pre-golive-postgres`.
