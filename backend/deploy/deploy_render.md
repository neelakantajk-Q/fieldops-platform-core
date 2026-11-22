# Fresh free cloud demo on Render - ONE URL for UI + API (no card, no payment)

This deploys PocketBase **and** the React web client together on Render's free
tier. PocketBase serves the built UI from `pb_public`, so there is a single
public URL:

- `https://<name>.onrender.com/`     -> web app
- `https://<name>.onrender.com/api/` -> PocketBase REST API
- `https://<name>.onrender.com/_/`   -> admin panel

No CORS, no second service, no local Node install. The multi-stage Dockerfile
(`backend/Dockerfile.render`) builds the web client inside Render and bakes it
into the image.

## What changed in the repo

- `render.yaml` - free Docker web service, builds `backend/Dockerfile.render`
  with the repo root as context.
- `backend/Dockerfile.render` - stage 1 builds the web client
  (`VITE_SAME_ORIGIN_API=true`), stage 2 runs PocketBase 0.22.32 and copies the
  build into `/pb/pb_public`.
- `backend/entrypoint.sh` - restores the latest Google Drive backup on cold
  start, applies migrations, ensures the superuser, then serves.
- `backend/pb_hooks/api_drive_backup.pb.js` - cron job that uploads a full
  `pb_data` snapshot to Google Drive while the service is awake.
- `backend/deploy/BackupWebApp.gs` - the Google Apps Script sink (Drive).
- `.dockerignore` (repo root) - keeps the build context small (excludes APKs,
  node_modules, pb_data, etc.).
- `web-client/src/config.js` - when built with `VITE_SAME_ORIGIN_API=true`, the
  UI calls the same origin it is served from instead of the legacy Apps Script
  URL. Other builds are unchanged.

## Trade-offs for $0

- Free service **sleeps after 15 minutes without traffic**; the next request
  takes ~1 minute to wake it. Keep it warm during the demo (see below).
- Disk is **ephemeral**: data resets on redeploy/restart/spin-down. Migrations
  re-create the schema and seed on every boot, so the demo always starts clean.
  Enable the Google Drive backup/restore (section 7) to keep captured data.

## 1. Commit and push

From `fieldops-platform-core`:

```powershell
git add render.yaml .dockerignore backend/Dockerfile backend/Dockerfile.render `
  backend/pb_hooks backend/pb_migrations `
  web-client/src/config.js web-client/src/lib/pb.js
git commit -m "deploy: one-URL free Render demo (PB + web client)"
git push
```

## 2. Create the service on Render

1. Sign in at https://render.com with GitHub (no card).
2. **New -> Blueprint** -> pick this repo -> Render reads `render.yaml`.
3. Region: **Singapore** if offered (closest to India). Approve.
4. First build downloads Node deps + PocketBase and takes a few minutes.
5. Copy the URL Render gives you, e.g. `https://fieldops-pb.onrender.com`.

If the name `fieldops-pb` is taken, edit `name:` in `render.yaml` (Render then
uses that name in the URL) and redeploy.

## 3. Create the superuser (fresh instance = empty admins table)

```powershell
$url  = "https://fieldops-pb.onrender.com"
$body = @{ email="itadmin@fieldops.local"; password="YourStrongPass12"; passwordConfirm="YourStrongPass12" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$url/api/admins" -ContentType "application/json" -Body $body
```

If it says the admin already exists, skip - use that login or reset it at
`$url/_/`.

## 4. Demo data and logins (seeded automatically - no Node needed)

Migrations run on every boot:

- `1700000060_demo_login_users.js` creates the legacy login users with the
  SHA-256 hashes the client sends.
- `1700000110_seed_demo_data.js` upserts a clean QEL demo dataset: 6 clients,
  10 vehicles, 18 complaints, 15 job cards (6 closed, 4 in progress, 3 on hold,
  2 open), attendance, holds, parts/stock, invoices, dealers/visits, CAPA,
  notifications, audit logs and settings. The seed is idempotent, so restarts
  and redeploys do not duplicate rows.

No seeding step is required.

| Username | Password   | Role          |
|----------|------------|---------------|
| `admin`  | `admin`    | Administrator |
| `mod`    | `1`        | Moderator     |
| `user1`  | `password` | Technician    |

(If you later add a Node machine, `backend/seed_schema.js` remains available,
but it is optional.)

## 5. Open the demo

- Web app: `https://fieldops-pb.onrender.com/` (log in as `admin` / `admin`)
- Admin: `https://fieldops-pb.onrender.com/_/`
- Android app: on the login screen set the server URL to the same URL.

Because the UI is same-origin, it talks to the API automatically - no URL entry
needed on the web login.

## 6. Keep it awake for the demo

Free services sleep after 15 idle minutes. Add a free pinger
(https://cron-job.org or UptimeRobot) hitting
`https://fieldops-pb.onrender.com/api/health` every 5-10 minutes on demo day.

## 7. Durability: automatic Google Drive backup/restore (no card)

> Note: the hosting mode above uses **DIRECT** deployment. Render's free
> services do not survive 15+ minutes of inactivity, and any rollback restarts
> them; either way the demo data is rebuilt from the seed. Durability adds a
> Google Drive backup that you can pull back manually.
Render's free disk is ephemeral, so a spin-down wipes `pb_data`. To make
captured demo data survive, the repo includes an automatic backup that stores a
full `pb_data` snapshot in Google Drive:

- `backend/pb_hooks/api_drive_backup.pb.js` - a PocketBase cron job (every 5 min
  while the service is awake) creates a full backup via the superuser Backups
  API, reads the zip and uploads it to a Google Apps Script Web App.
- `backend/deploy/BackupWebApp.gs` - the Web App. It stores the latest snapshot
  as `fieldops_latest.zip` in the `FieldOpsBackups` Drive folder and serves it
  on request. It uses `DriveApp.getFoldersByName`, so the script needs the
  `https://www.googleapis.com/auth/drive` scope granted once by the deploying
  account in the editor (Run `selfTest` + Allow).
- `backend/entrypoint.sh` - on every cold start, downloads that snapshot and
  unpacks it into `pb_data` before PocketBase serves, then applies migrations
  and ensures the superuser exists.

Setup (already done on the Render instance; recreate the sink if it is lost):

- The Google Apps Script sink is an **Apps Script Web App** that creates/uses a
  Drive folder named `FieldOpsBackups` in the deployer's Drive (uses
  `https://www.googleapis.com/auth/drive`; the script must have been granted
  full Drive access once - see step 1 of the hosting notes).
- `BACKUP_WEBAPP_URL` is the Web App URL:
  `https://script.google.com/macros/s/AKfycbw8lUdJIdrlqEPAuoyZ4p2-p5UyB2YNnWXLp7KEMyNd9uTp8nJZpPl8DXbahRzshU3IHw/exec`
- `BACKUP_WEBAPP_TOKEN` is the shared secret sent in the request.
- `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` are the superuser used for the
  Backups API (set on Render).
- `BACKUP_CRON` defaults to `*/5 * * * *`.

If you need to recreate the Web App:
1. Open the Apps Script editor at
   `https://script.google.com/d/1qVu0MpKll0nYef7nPes7oqJlJ3xeuuJUOtakSCGSP4lPp71UW05At_wR/edit`,
   paste `backend/deploy/BackupWebApp.gs` to Code.gs.
2. Set a long `SHARED_TOKEN`.
3. Deploy as Web App: **Deploy > Publish** (or Manage deployments), access
   **Anyone**, run **selfTest**, and click through the one-time Drive
   authorization prompt (full Drive scope).
4. Copy the `.../macros/s/{DEPLOYMENT_ID}/exec` URL into the Render env var.

Notes:

- The snapshot includes the SQLite DB **and** uploaded files, so photos survive.
- Backups run only while the service is awake; the latest snapshot is roughly
  `BACKUP_CRON` old (5 min). If the gap grows noticeably, check the Render
  logs (`drive backup ...`) for the latest `drive backup:` line.
- Without these env vars the app still works, but data resets on spin-down.
- The demo runs fully on Render; the PocketBase Cloud instance is not used.

## Alternative: always-on (no cold starts)

Deploy the same `backend/Dockerfile.render` on **Northflank Sandbox** (free,
always-on, no sleeping per their pricing page). Create a service that builds
from your GitHub repo with:

- Dockerfile: `backend/Dockerfile.render`
- Build context: repository root

Then repeat step 3 with the Northflank URL (demo logins seed automatically).

## Troubleshooting

- **Build fails at `npm install`**: the lockfile may be stale; the Dockerfile
  already uses `npm install` so it self-heals. Check Render's build logs.
- **Health check fails**: PocketBase returns 200 at `/api/health`; give the
  first boot time for migrations.
- **First request slow**: free instance woke from sleep; normal.
- **Data vanished after a redeploy/spin-down**: expected on the free ephemeral
  disk unless the Google Drive backup is configured (section 7).
