# FIELDOPS — NEXT SESSION PLAN (written 2026-11-11, resume 2026-11-12)

Read this first, then `HANDOFF.md`, then query `graphify-out/` instead of grepping.
This file records the **planned** work discussed on 2026-11-11 (nothing below is
implemented yet) plus the verified state so tomorrow continues without re-reading code.

## 1. Verified state at end of 2026-11-11
- Cloud instance `fieldops-db` (`wzc6r4fspi7fdd2`, PocketBase 0.22.32):
  all 5 hooks ACTIVE, migration `1700000003_roaming_requests` applied, seeded.
  Cloud test results: integration 8/8, roaming 13/13, e2e 4/4.
- Web console live: https://cj0jzgjbxy8nywl.pwz5.pocketbasecloud.com
  (built with `VITE_API_BASE_URL` = cloud URL; GitHub repo variable + workflow).
- GitHub: private `neelakantajk-Q/fieldops-platform-core`, branch
  `continue/android-overlay-cloud` (latest commit = this note).
- APK: `FieldOps-v2.0.0-debug.apk` (48.4 MB) committed at repo root.
- Graph: `graphify-out/graph.json` (820 nodes / 1881 edges). Refresh with
  `scripts\sync_graph_shims.ps1` + `graphify update .` after code changes;
  graphify is code-only, so this Markdown is NOT in the graph — read the file.
- Cloud admin: `itadmin@fieldops.local` / `FieldOps#2026`. The admins table was
  EMPTY (platform superuser sync does not seed it); created via
  `POST /api/admins`. If auth ever 400s again, check for an empty admins table.
- `pbc pocketbase deploy` uploads new hooks but does NOT activate them →
  always run `pbc pocketbase hooks push pb_hooks` afterwards
  (`scripts/deploy_backend_cloud.ps1` already does this).

## 2. Requirements locked by the user (2026-11-11)
1. Notification must start when the app is logged in (persistent FGS); the
   overlay keeps working while the app is backgrounded; notifications are also
   needed when the app is fully closed, in a few cases.
2. Peers receive notifications too, for held jobs / interrupted jobs etc.
3. Moderator/Admin can edit notification rules; Admin has special rights to
   assign roles (and hub/region/scope) to people.
4. Telemetry is written every 30 minutes, and immediately when any
   sup/mod/admin triggers a sync from the frontend.
5. Images are moved to free external storage; only media links are stored in PB.
6. Escalation is included.
7. Historic/excess data is archived to a Google-Sheets-like store and queried
   later with tolerance for latency, to protect PB quota.

## 3. Design decisions so far (not implemented)
### Realtime + notifications
- PB realtime SSE: `GET /api/realtime` then `POST /api/realtime`
  `{clientId, subscriptions:["notifications/*"]}`. `roaming_requests` has
  `listRule: ""` (public) so SSE works without PB auth.
- New `notifications` collection (migration 1700000004): company_id, user_id,
  type, title, body, ref_collection, ref_id, priority,
  status (UNREAD/READ/ACTED), ist_date, escalated_to, created.
  Dedupe by (type, ref_id, user_id). Fan-out written by backend hooks.
- Audience resolution from `users.role/hub_id/region_id/reports_to` +
  `service_hubs.region_id`:
  peers (same-hub Technicians), Supervisor (hub), Moderator (region),
  Administrator/Platform (company). One row per recipient.
- Default event matrix: roaming/transit -> chain only (peers off);
  geo breach/mock -> peers + chain; job ON_HOLD / interrupted -> peers + chain;
  job closed / TAT breach -> peers + chain; escalation -> chain.
- Config in `settings`: `notify.<event>.levels`, `.peers`, `.scope`
  (HUB|REGION|COMPANY), per-hub `notify.hub.<hubId>.<event>.*`,
  `notify.escalate_minutes` (default 15), `notify.escalate.levels`
  (MODERATOR,ADMIN), `notify.escalate.max`. Read >= Supervisor, write >= Moderator.
- Routes: `/api/fieldops/notify-config`, `notifications-list`,
  `notification-read`, `request-sync` (>= Supervisor), `archive-query`.
  Admin role/hierarchy assignment: extend existing `/api/fieldops/admin-user`
  (currently role/phone/status only) with hub_id, region_id, scope.
- Escalation: `cronAdd` every minute for aged PENDING requests and aged job
  holds; write rows and set `escalated_to` (no re-notify of the same level).
- Android: new `RealtimeService` (FGS specialUse) holds the SSE stream,
  posts `Notify.alert` (APPROVE/REJECT actions reuse `RoamingActionReceiver`),
  60 s poll fallback when SSE drops. Group notifications under one summary.
- Web: approvals card + notification bell on the same subscription; add
  `roamingPending` / `roamingDecision` actions to `web-client/src/lib/pb.js`.
- Production hardening later (W5): PB-auth token mapping so realtime rules can
  be user-scoped instead of public + client-side filtering.

### Telemetry
- `GeofenceService`: periodic fix every 30 min (`1_800_000 ms`,
  PRIORITY_BALANCED_POWER_ACCURACY); immediate push on zone transitions and on
  `SYNC_NOW`.
- `POST /api/fieldops/request-sync {sessionToken, scope, ids?}` (>= Supervisor)
  writes SYNC_NOW notifications; devices push immediately with source=ON_DEMAND.
- Web `broadcastSync` (currently a stub returning `{ok:true}` in
  `web-client/src/lib/pb.js`) becomes the trigger.
- Retention cron: delete telemetry older than 45 days (Free) / 180 (Starter).

### Media offload
- Provider (pending answer): Cloudinary free (25 credits/mo = 25 GB storage
  or 25k transformations) via unsigned upload preset; alternatives Supabase
  Storage 1 GB / Cloudflare R2 10 GB.
- Migration adds `photo_url`, `photo_public_id`, `media_provider` to
  `attendance`, `captures`, `job_cards` (old file fields stay, unused).
- Android `MediaUploader`: upload first, then write the record with URLs;
  offline retries. Config via `settings` keys `media.*` + `/api/fieldops/media-config`.
- Web pages render `photo_url`; optional cron delete of Cloudinary assets.

### Cold archive (Google Sheets + Apps Script)
- Hot/cold split: PB keeps telemetry 30 days (~24 MB), attendance 90, audit 180,
  notifications 30, captures 90 (URL only). Historic rows exported to monthly
  Sheets tabs (`telemetry_2026-11`), then deleted from PB **only after ack**.
- Pipeline: PB daily cron -> `$http.send` POST to GAS `doPost`
  (1,000–2,000 rows per batch, one `setValues()` call) -> GAS `manifest` tab
  dedupes `batch_id`, `LockService` serializes -> returns `{ok, rows, checksum}`.
- PB `archive_batches` collection + `archived`/`archive_batch` flags on
  archivable collections; failures keep rows and notify Admins; backfill action.
- Query: `POST /api/fieldops/archive-query` (rank-gated) proxies GAS and caches
  identical queries 1 h in `archive_cache` — GAS consumer quota is 90 trigger
  minutes/day, so caching is mandatory. GAS verified limits: 6 min/execution,
  20,000 URL fetches/day, 50 MB POST. Sheets limit 10M cells → telemetry
  ~576k cells/month ≈ 17 months per spreadsheet (one spreadsheet per collection
  per year).
- Alternatives if query latency/TPI matters: Supabase Postgres free (500 MB,
  ~100–300 ms), Cloudflare D1 + Worker (5 GB, ~50–150 ms), BigQuery free tier
  (needs OAuth; PB 0.22 JSVM cannot sign RS256 → proxy).
- PII: archived rows contain GPS/usernames/phones — share Sheets only with
  Admin accounts; GAS requires a long random secret; optionally archive derived
  zone/distance instead of raw lat/lng.

### Capacity conclusion
- Free plan (50 MB storage, 5k API req/hour) is viable for a 50-user pilot with
  30-min telemetry + external media + 45-day retention (~25–35 MB steady state,
  ~300–800 req/hour).
- Starter $10/mo (3 GB, unlimited API, custom domain, 5 regions) for production.
- Concurrency is not the constraint; plan quota/storage is.

## 4. Open questions (answer before coding)
1. Media provider: Cloudinary (recommended) / Supabase Storage / R2?
2. Escalation delay 15 min and levels Moderator -> Admin — confirm?
3. Peers on roaming/transit notifications by default: on or off?
   (recommend off; on for job hold/interrupt/breach)
4. Stay on Free for the pilot or upgrade to Starter now (custom domain)?
5. Proof-photo retention: forever / 90 / 180 days?
6. Archive: which Google account owns it, is GPS data in Sheets acceptable,
   retention days per collection, in-app historic queries needed, auto-delete
   after ack or manual purge?

## 5. Implementation order (after answers)
1. **Backend P1**: migration 1700000004 (notifications + media URL fields) and
   1700000005 (archive flags/batches/cache); `backend/pb_hooks/notify.pb.js`
   (fan-out, config, escalation + retention crons, request-sync);
   extend `admin-user` route; `backend/pb_hooks/archive.pb.js`; GAS app in
   `archive/gas/` (`Code.gs`, `appsscript.json`, README).
2. **Android P2**: `RealtimeService.kt`; auto-start services on login
   (`LoginActivity.goMain` + `MainActivity.onCreate`) and on boot
   (`BootReceiver`); `START_STICKY`; grouped notifications; 30-min telemetry +
   SYNC_NOW in `GeofenceService`; `MediaUploader.kt` (URL flow).
3. **Web P3**: approvals card, notification bell, Notification Rules UI
   (Moderator/Admin), Admin hub/region/scope selects, broadcastSync trigger,
   media URL rendering, History/Archive page.
4. **Verify P4**: new `tests/test_notifications.js` (matrix, peers, per-hub
   override, region isolation, escalation, dedupe), telemetry cadence +
   sync-now, media URL persistence, `tests/test_archive.js` (ack-before-delete,
   idempotent replay, bad secret, aggregate parity); regressions 8/8, 13/13,
   4/4; build APK; deploy (`deploy` + `hooks push`); `sync_graph_shims.ps1` +
   `graphify update .`; commit/push; rebuild `fieldops-continue.bundle`.

## 6. Known traps (do not re-trip)
- PB 0.22 JSVM: top-level const/let/function do NOT survive into callbacks —
  inline every helper. Dates read back with a space; normalize with
  `String(v).replace(" ", "T")`.
- Cloud: empty admins table is the real cause of auth 400 (platform superuser
  sync only updates platform metadata); hooks stay inactive until
  `pbc pocketbase hooks push pb_hooks`.
- `graphify` skips `.pb.js`; `graphify-shims/*.js` are generated copies — edit
  hooks only in `backend/pb_hooks/`, then `scripts\sync_graph_shims.ps1`.
- PowerShell in this sandbox: no `&&`/`||`; background processes are killed
  between tool calls (co-run server + tests in one command).
- GitHub Pages is unavailable for this private repo on the free plan; the live
  frontend is PocketBase Cloud hosting (`scripts/deploy_frontend_cloud.ps1`).

## 7. Resume commands
```powershell
# from C:\Users\Ashok\Desktop\open_code\open_code\workspace\fieldops-platform-core
git pull; git log --oneline -3
graphify query "roaming approval flow"        # query the graph, don't grep
powershell -File scripts\run_local_tests.ps1  # local 8/8 + 13/13
$env:PB_URL="https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com"
$env:PB_ADMIN_EMAIL="itadmin@fieldops.local"; $env:PB_ADMIN_PASSWORD="FieldOps#2026"
node tests\test_integration.js; node tests\test_roaming.js
powershell -File scripts\deploy_backend_cloud.ps1   # deploy + hooks push
powershell -File scripts\build_apk.ps1
```