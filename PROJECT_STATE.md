# FieldOps — Project State & Continuity Log

> **READ THIS FILE FIRST.** It is the single source of truth for the deployed
> architecture, the decisions we made, the live state, and where to resume.
> Update the **Change Log** and **Resume Point** on every change. Do not rely on
> remembering a previous session or on re-reading `git diff`.

Last updated: **2026-11-26**

---

## 0. TL;DR — current snapshot

| Item | Value |
|---|---|
| Canonical app (UI + API) | **Render** — https://fieldops-pb.onrender.com |
| Render service | `fieldops-pb` · id `srv-dc1h5n2jnfac738ov5f0` |
| Render repo / branch | `github.com/neelakantajk-Q/fieldops-platform-core` / `main` |
| Render `autoDeploy` flag | `yes` but **GitHub pushes do NOT trigger deploys** (see §4) |
| Live deploy at last check | `dep-dc1qrl3l550s73f9hbg0` @ commit `2418593` (2026-11-23) |
| Source HEAD at last check | `9d8c2b9` (main == continue/android-overlay-cloud) |
| PocketBase version | 0.22.32 |
| GitHub Pages | **Retired** (workflow still present; only `main` may deploy) |
| PocketBase Cloud (`wzc6…pwz5`) | **Retired** (`paused`, health 502) |
| Data persistence | Render free disk is ephemeral → Google Drive backup/restore + keep-alive pinger |
| Repo visibility | **PUBLIC** — never commit secrets to this file or the repo |

Render API key + service id live **outside the repo** in
`C:\Users\Ashok\Desktop\open_code\open_code\workspace\ccc.txt`
(`rnd_…` key and `tea-…` scope id). Do **not** copy the key into the repo.

---

## 1. Architecture (decided 2026-11-26)

Render runs **one** Docker web service from `render.yaml` + `backend/Dockerfile.render`:

1. Stage 1 builds the React web client with `VITE_SAME_ORIGIN_API=true`.
2. Stage 2 runs PocketBase 0.22.32 and copies the build into `/pb/pb_public`.

One public URL, no CORS:

- `/`   → React web app
- `/api/` → PocketBase REST + `fieldops` routes
- `/_/` → PocketBase admin panel

`backend/entrypoint.sh` on every cold start:

1. Restores the latest Google Drive backup (if configured).
2. Applies `pb_migrations` (idempotent).
3. Ensures the superuser from `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`.
4. Serves PocketBase.

Android points at the same Render URL. Backend source of truth is
`backend/pb_hooks/*.pb.js` + `backend/pb_migrations/*.js`.

**Deploy rule:** feature work on a branch → commit → fast-forward `main` → push →
trigger the Render deploy through the API. Only `main` should reach production.

---

## 2. Product logic (decided)

- **Roles / scopes:** `Platform` (99) → `Administrator` (4, ALL) → `Moderator`
  (3, REGION) → `Supervisor` (2, HUB) → `Technician` (1, SELF).
- **Org hierarchy:** **Zone → Region → Hub → Supervisor → Technician.**
  A zone is the `regions.zone` text field (migration `1700000130_region_zone`).
- **Admin-only operations:**
  - Map regions to zones: `POST /api/fieldops/region-zone`
  - Broadcast an alert to a zone / region / hub:
    `POST /api/fieldops/alert-broadcast`
- **Performance page:** "Hub Performance", "Your Performance", "Hub TAT".
  TAT is computed from `job_cards.gross_tat_minutes` / `tat_minutes` for
  `CLOSED` jobs, grouped by hub and by engineer.
- **Demo logins (seeded):** `admin` / `admin`, `mod` / `1`,
  `user1` / `password`.
- **API rules:** demo-open collections remain for the pilot. Production must
  replace them with scope-aware rules (see `HANDOFF.md` §W5).

---

## 3. Decision log (append-only)

| Date | Decision | Rationale |
|---|---|---|
| 2026-11-26 | **Render is the single canonical host.** GitHub Pages and PocketBase Cloud are retired. | One URL for UI + API, no CORS, one deploy target. PB Cloud trial expired/paused. |
| 2026-11-26 | **Data durability = Google Drive backup/restore + free keep-alive pinger.** | Render free disk is ephemeral; Drive backup code already exists and needs no card. |
| 2026-11-26 | **Deploy = push `main`, then trigger Render via API.** | Render's GitHub auto-deploy has not fired since 2026-11-23; we drive it explicitly until the webhook is fixed. |
| 2026-11-26 | **Finish and ship Zone + broadcast + TAT work.** | Already partially implemented; complete and deploy. |
| 2026-11-11 | IST (`ist_date`, +05:30) for reports; raw timestamps UTC. | Reporting day boundaries. |
| 2026-11-11 | Breach = radius + 100 m buffer; punch validation uses strict radius. | User requirement + hysteresis. |
| 2026-11-11 | PocketBase pinned **0.22.32**; hooks use 0.22 JSVM idioms. | Do not move to 0.23+ without porting hooks. |
| 2026-11-11 | Keep legacy login contract (SHA-256 hash + deviceUUID + single-device session). | Android client parity. |

---

## 4. Render deployment — findings & fix

**Finding (2026-11-26):** the service is `autoDeploy: yes`, branch `main`, but the
deploy history contains **only `api` and `manual` triggers — no GitHub-triggered
deploys**. The last live deploy is commit `2418593` (2026-11-23). Newer commits on
`main` (`515e1b0`, `e95571b`, `78cf80d`, `9d8c2b9`) never reached Render.

**Implication:** pushing to GitHub alone is not enough. Trigger a deploy through
the Render REST API after pushing. (Long-term fix: reconnect the GitHub webhook /
confirm the Render integration has access to the repo.)

**Render REST quick reference** (key from workspace `ccc.txt`, not committed):

```powershell
$key = "<RENDER_API_KEY>"           # rnd_…
$h   = @{ Authorization = "Bearer $key" }
$id  = "srv-dc1h5n2jnfac738ov5f0"

# list services / deploys
Invoke-RestMethod "https://api.render.com/v1/services?limit=50" -Headers $h
Invoke-RestMethod "https://api.render.com/v1/services/$id/deploys?limit=20" -Headers $h

# trigger a deploy (after pushing main)
$body = @{ clearCache = "do_not_clear" } | ConvertTo-Json
Invoke-RestMethod "https://api.render.com/v1/services/$id/deploys" -Method Post -Headers $h -ContentType 'application/json' -Body $body
```

First request after idle can take ~60 s (free instance wake-up). Allow timeouts
of at least 60–90 s when checking the live site.

---

## 5. Data durability & keep-alive

Environment variables expected on the Render service:

| Variable | Purpose |
|---|---|
| `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD` | superuser created/updated on boot |
| `BACKUP_WEBAPP_URL` | Google Apps Script Web App that stores/returns the snapshot |
| `BACKUP_WEBAPP_TOKEN` | shared secret for the Web App |
| `BACKUP_CRON` | backup cadence (default `*/5 * * * *`) |

`backend/pb_hooks/api_drive_backup.pb.js` uploads a full `pb_data` snapshot while
the service is awake; `entrypoint.sh` restores it on cold start. Data written in
the last ~5 minutes before a spin-down can still be lost.

Keep-alive: point a free pinger (cron-job.org / UptimeRobot) at
`https://fieldops-pb.onrender.com/api/fieldops/health` every 5–10 minutes.

---

## 6. Deploy runbook

```powershell
# 0. from the repo root
# 1. build + syntax checks
cd web-client; $env:VITE_SAME_ORIGIN_API="true"; npm run build; cd ..
node --check backend/pb_hooks/api_fieldops.pb.js
node --check backend/pb_migrations/1700000130_region_zone.js

# 2. commit on a feature branch, then fast-forward main
git add -A
git commit -m "<message>"
git push origin HEAD
git checkout main; git merge --ff-only <branch>; git push origin main

# 3. trigger Render + verify
powershell -File scripts/verify_live.ps1   # (to be added, see §9)
```

`git checkout main` / merge steps assume `main` is an ancestor of the feature
branch (it is when the branch was cut from `main`).

---

## 7. Open questions / risks

1. **Secrets in a public repo.** `KEYS_AND_ACCESS.md` is committed; the repo is
   public. Rotate/remove real credentials before production.
2. **Render GitHub auto-deploy is dead.** Fix the webhook or keep using the API
   trigger in §4.
3. **Demo-open API rules.** Scope enforcement is not yet enforced by PocketBase
   rules; hooks guard the new admin routes only.
4. **Drive backup env vars** — confirm they are set on Render, and confirm the
   Apps Script sink returns a snapshot.
5. **Pinger** — confirm an external keep-alive is configured.
6. **Real accounts vs demo logins** — decide before sharing the URL widely.
7. **Android** — default server URL should be the Render URL; confirm before a
   new APK release.

---

## 8. Change log (append-only)

| Date | Change | Files | Commit | Verified |
|---|---|---|---|---|
| 2026-11-26 | Session 1: mapped Render architecture; found stale live deploy (`2418593`) and dead GitHub auto-deploy; created continuity files. | `PROJECT_STATE.md`, `AGENTS.md` | _(pending)_ | n/a |
| 2026-11-26 | In-flight (pre-existing, uncommitted): backend `region-zone` + `alert-broadcast`, `regions.zone` migration, directory zone, TAT analytics; web Zone tree + broadcast modal, Performance/Team/Home renames + TAT. | `backend/pb_hooks/api_fieldops.pb.js`, `backend/pb_migrations/1700000130_region_zone.js`, `web-client/src/lib/pb.js`, `web-client/src/pages/Team.jsx`, `web-client/src/pages/Performance.jsx`, `web-client/src/mobile/Home.jsx`, `web-client/src/mobile/tree.js`, `web-client/src/nav.js` | _(pending)_ | build OK |

---

## 9. Resume point (next steps)

1. Review/finish the in-flight Zone + broadcast + TAT work; add `reports_to` on
   `admin-user` create for parity.
2. Build, commit, fast-forward `main`, push.
3. Trigger a Render deploy via the API (§4) and verify the live asset hash +
   `/api/fieldops/health` + login.
4. Add `scripts/verify_live.ps1`, retire the GitHub Pages workflow, and update
   `KEYS_AND_ACCESS.md` / `HANDOFF.md` / `NEXT_SESSION.md` to point here.
5. Verify the live app end-to-end and record the result here.
