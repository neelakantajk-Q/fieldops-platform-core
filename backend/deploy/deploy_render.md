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
- `.dockerignore` (repo root) - keeps the build context small (excludes APKs,
  node_modules, pb_data, etc.).
- `web-client/src/config.js` - when built with `VITE_SAME_ORIGIN_API=true`, the
  UI calls the same origin it is served from instead of the legacy Apps Script
  URL. Other builds are unchanged.

## Trade-offs for $0

- Free service **sleeps after 15 minutes without traffic**; the next request
  takes ~1 minute to wake it. Keep it warm during the demo (see below).
- Disk is **ephemeral**: data resets on redeploy/restart. Migrations re-create
  the schema and seed on every boot, so the demo always starts clean.

## 1. Commit and push

From `fieldops-platform-core`:

```powershell
git add render.yaml .dockerignore backend/Dockerfile.render `
  backend/pb_migrations/1700000060_demo_login_users.js `
  web-client/src/config.js
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

## 4. Demo logins (seeded automatically - no Node needed)

Migration `1700000060_demo_login_users.js` creates the legacy login users on
boot, using the SHA-256 hashes the client sends. No seeding step is required.

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
- **Data vanished after a redeploy**: expected on the free ephemeral disk.
