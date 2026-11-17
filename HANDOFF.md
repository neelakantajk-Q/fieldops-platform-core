# FIELDOPS — CONTINUATION HANDOFF

Read this whole file before changing anything. It compresses everything an
LLM (or human) needs to continue development on a different device, including
the decisions already made, the traps already hit, and the exact next steps.

---

## 1. What this project is

A 50-seat white-labeled **field service & vehicle CAPA platform** ("FieldOps"),
migrating a legacy Google Apps Script + Kodular/WebView Android stack to:

| Layer | Tech | Location |
|---|---|---|
| Backend | PocketBase **0.22.x** (JSVM hooks + JS migrations) | `backend/` |
| Admin web console | React + Vite SPA (legacy GAS portal refactor) | `web-client/` |
| Mobile | **Native Kotlin Android** (overlay bubble, geofence, CameraX+ML Kit OCR) | `app/android/` |
| Mobile spec (reference) | React Native-style JS screens — feature spec, not built | `app/src/` |
| Legacy reference | Read-only copies of the old GAS backend | `legacy-reference/gas-latest/` |

Everything was driven by `INSTRUCTIONS.txt` at the workspace root (outside this
repo) — read it if present; it defines the legacy contract (username +
SHA-256 passwordHash login, single-device sessions, seat limits, geofence
punch validation, TAT on job close).

**Target infra:** managed PocketBase at PocketBase Cloud (instance
`fieldops-db`, PB pinned to **0.22.32**). Keys/URLs in `KEYS_AND_ACCESS.md`.

---

## 2. Current state — DONE and verified

Backend (all hooks are PocketBase **0.22.x JSVM** style):
- `backend/pb_migrations/1700000000_init_fieldops_schema.js` — 18 collections.
  Rule semantics: **`null` = admin-only, `""` = public** (0.22 polarity).
  Operational collections are DEMO_OPEN for the test frontend; `users` LOCKED;
  `audit_logs` READ_ONLY. `ist_date` added by 1700000002, `roaming_requests`
  added by 1700000003.
- `backend/pb_hooks/geofence_check.pb.js` — on attendance HTTP create:
  mock → `Rejected_Mock`, accuracy>25m → `Rejected_Accuracy`,
  distance>radius → `Rejected_Geofence` **unless** hub `allow_roaming` **or**
  a same-IST-day `APPROVED` roaming_request exists (day pass →
  `Verified_Roaming`). Sets `ist_date` server-side (UTC+5:30) so reports group
  by Indian day. `Geo*` events (GeoBreach/GeoTransit/GeoMock/GeoReturn) are
  recorded, **never rejected**; notes carry
  `zone=INSIDE|BUFFER|OUTSIDE dist=N radius=R buffer=100`.
- `backend/pb_hooks/seat_limit.pb.js` — 51st active user of a company → 400.
- `backend/pb_hooks/job_tat_calculator.pb.js` — on job HTTP update to CLOSED:
  gross = completed−started, holds summed from `job_card_holds`,
  wrench = gross−holds, downtime = released−breakdown.
- `backend/pb_hooks/api_fieldops.pb.js` — legacy-contract routes:
  `/api/fieldops/login|logout|health|directory|admin-user|admin-settings`.
  Login = username + SHA-256(passwordHash) + deviceUUID, single-device
  session (409 CONFLICT unless `forceTakeover`), token `TOK-…`, 12h expiry.
- `backend/pb_hooks/mobile_api.pb.js` — roaming approval routes:
  `roaming-request` (idempotent per user+IST-day; PENDING once),
  `roaming-approve` (Supervisor+ only; sets APPROVED/REJECTED + approver),
  `roaming-pending` (company PENDING for approvers; own-today for techs),
  `roaming-status` (day-pass state).
- `backend/seed_schema.js` — seeds demo company/hubs/users (env-driven; works
  against local or cloud; auth endpoint auto-falls back 0.22↔0.23).
- `backend/pbc.json` — PocketBase Cloud deploy config, **pinned 0.22.32**.
- `backend/deploy/` — OCI script + HF Spaces alternative docs.

Tests (all green as of this handoff):
- `tests/test_e2e.js` — 4/4 (logic mirrors, offline).
- `tests/test_integration.js` — **8/8** against a running PB (health, geofence
  in/out/mock/accuracy, seat limit 50/51st, TAT on close).
- `tests/test_roaming.js` — **13/13**: request→PENDING (idempotent), punch
  rejected pre-approval, tech approve → 403, supervisor APPROVED → day pass,
  status=APPROVED, out-of-radius punch → `Verified_Roaming`, control user
  still rejected.

Android (`app/android/`, package `com.fieldops.mobile`, minSdk 26, target 34):
- **`gradle assembleDebug` builds successfully** — APK committed at repo root
  `FieldOps-v2.0.0-debug.apk` (~48MB, ML Kit bundled).
- Login (`LoginActivity`) — legacy login route, session-conflict takeover.
- `MainActivity` — punches (CheckIn/Out), zone display (INSIDE/BUFFER/OUTSIDE),
  transit status, start/end job, services toggles, supervisor polling.
- `OverlayBubbleService` — draggable floating bubble over any app:
  TRANSIT REQ / START JOB / END JOB / CAPTURE OCR / HIDE (the legacy bubble,
  reimplemented natively).
- `GeofenceService` — foreground location service; registers OS geofence at
  **radius + 100m buffer**; periodic telemetry pushes (zone, battery, mock).
- `GeofenceReceiver` — EXIT beyond radius+100 → `GeoBreach` event + breach
  notification; ENTER → `GeoReturn`; mock → `GeoMock`.
- `RoamingActionReceiver` — APPROVE/REJECT action buttons on transit-request
  notifications (Supervisor+ phones poll every 30s via MainActivity handler).
- `CameraOcrActivity` — CameraX capture → ML Kit text recognition (Indian
  plate regex) → `Watermark.stamp` (time/GPS/plate/user) → upload to
  `captures`, linked to open job when present.
- `Api.kt` — all PocketBase REST calls + fieldops routes; day-pass awareness.
- Gradle wrapper generated (`app/android/gradlew.bat`).

Tooling proven on the dev machine (Windows): JDK 17.0.21 + Android SDK 34 +
Gradle 8.7 + `pbc` 0.9.9 — all portable installs under
`C:\Users\<user>\dev-tools\`, env vars persisted at user level.
`scripts/setup_new_device.ps1` reproduces this on a fresh machine.

---

## 3. TODO — what the next LLM should do, in order

BEFORE grepping or mass-reading files: a graphify knowledge graph of this repo
is committed at `graphify-out/` (820 nodes / 1881 edges: web client, backend,
tests, Android app, hook shims). Query it first (§9). Read `HANDOFF.md` +
`graphify-out/GRAPH_REPORT.md`, then open only the files a query points to.

**2026-11-12 plan:** see `NEXT_SESSION.md` — it records the verified state,
the locked requirements (hierarchical peer notifications, 30-min telemetry +
sync-now, external image storage, escalation, Google-Sheets cold archive),
the design, the open questions, the implementation order, and resume commands.

### W1 (RESOLVED 2026-11-11) — Cloud admin auth returned 400 "Failed to authenticate"
Root cause: the cloud instance's `admins` table was **empty**. PocketBase Cloud's
`pbc pocketbase superuser sync` only updates the platform-side record + the
credentials shown by `pbc pocketbase info`; it never writes a row into the
instance DB. Wrong-password 400s are therefore expected for every combo.
Fix that worked: PB 0.22 allows unauthenticated admin creation while the table
is empty —
`POST /api/admins {"email":"itadmin@fieldops.local","password":"<REDACTED>","passwordConfirm":"…"}`
→ created, then auth + seed + all tests work. If this ever 401s again, the table
already has an admin (use the panel or `pbc pocketbase superuser sync` +
instance redeploy). Don't bother with the old debug checklist below.
Old notes (kept for context):
1. `superuser sync` "succeeds" but is not authoritative for the instance DB.
2. Portal panel `/_/` uses the same API — it fails identically while the table is empty.
3. Do NOT test four cred permutations in a loop and conclude "lockout"; it's a missing row.

### W2 (DONE 2026-11-11) — New backend files deployed to the cloud
Live on `fieldops-db` (`wzc6r4fspi7fdd2`, revision 2): `mobile_api.pb.js`,
`geofence_check.pb.js` (Geo* bypass + day pass), migration
`1700000003_roaming_requests.js` (collection verified via 401 on
`/api/collections/roaming_requests`). Cloud seeded and verified:
`test_integration.js` **8/8** and `test_roaming.js` **13/13** against the cloud URL.
IMPORTANT: `pbc pocketbase deploy` uploads new hook files but does **not**
activate them — a newly added hook shows blank ACTIVE in
`pbc pocketbase hooks ls` and its routes 404. Run
`pbc pocketbase hooks push pb_hooks` (or redeploy) to activate; all 5 hooks
must read `yes`.
Remaining W2 sub-task: none.

### W3 (PARTIAL 2026-11-11) — Web client: live on PocketBase Cloud; roaming card remains
Built and deployed against the cloud: **https://cj0jzgjbxy8nywl.pwz5.pocketbasecloud.com**
(frontend `fieldops-web`, deployed with `scripts/deploy_frontend_cloud.ps1`;
bundle has `VITE_API_BASE_URL` baked = cloud URL; CORS verified `*`; page +
assets 200 via Cloudflare; API e2e `test_e2e.js` 4/4 against the cloud).
GitHub integration: repo variable `VITE_API_BASE_URL` + root workflow
`.github/workflows/web-client.yml` (npm ci → build → asserts the cloud URL is
baked → uploads artifact). GitHub Pages is NOT usable while the repo is private
on the free plan, hence pbc frontend hosting is the live target.
Still to do: add a "Transit approvals" card
(poll `POST /api/fieldops/roaming-pending` with a sessionToken from
`/api/fieldops/login`, APPROVE/REJECT buttons → `roaming-approve`) on the
Attendance or Dashboard page. Also confirm `getAttendance` uses `ist_date`
(see `web-client/src/lib/pb.js`).

### W4 — Android hardening
- `MainActivity.refreshTransitStatus()` string handling is minimal — consider
  a dedicated TextView.
- Foreground-service start while app is backgrounded on Android 15+ needs
  `FOREGROUND_SERVICE_TYPE_…` exemptions review.
- Add WorkManager/AlarmManager retry queue for offline punches
  (`offline_sync` flag + `client_request_id` idempotency already exist).
- True instant push: FCM (needs a Firebase project + `google-services.json`);
  current sup notifications are 30s polling while the app is open.
- Release signing + `assembleRelease` (R8 currently off).

### W5 — Cloud hygiene
- Free trial expires ~2026-11-18; add a card or move to OCI/HF (docs in
  `backend/deploy/`).
- Before production: replace DEMO_OPEN rules with scope-aware rules
  (SELF/HUB/REGION/ALL) — see the WARNING comment in the init migration.

---

## 4. Decisions & rules already locked in

1. **IST everywhere for reports** (`ist_date`, UTC+5:30 fixed offset, no DST).
   Raw timestamps stay UTC (anti-cheat). IST day bounds:
   `new Date(ms + 19800000)`, `YYYY-MM-DD`.
2. **Breach = beyond radius + 100m buffer** (user requirement; hysteresis:
   INSIDE ≤ r < BUFFER ≤ r+100 < OUTSIDE). Punch validation still uses the
   strict radius. Buffer default 100, overridable via settings key
   `geofence_buffer_meters`.
3. **Day pass:** one PENDING roaming_request per user per IST day;
   Supervisor+ approval = APPROVED for the whole day; hook honors it with
   `Verified_Roaming`. Requests may be posted from bubble, app, or web.
4. **PocketBase version pinned 0.22.32** (cloud `--pb-version`; local binary
   0.22.18 — hook API identical across 0.22.x; do NOT deploy to a 0.23+ host
   without porting hooks: `onRecordBefore*Request` → `onRecord*` + `e.next()`,
   `$app.dao()` → new DAO API, admin auth path changes).
5. **PocketBase 0.22 JSVM quirks (critical):** top-level `const`/`let` AND
   `function` declarations do NOT survive into hook callbacks — inline
   everything inside each callback. PB date fields read back as
   `2006-01-02 15:04:05.000Z` (space) which Goja's Date cannot parse —
   normalize with `String(v).replace(" ", "T")`.
6. **Legacy client contract kept:** login via `/api/fieldops/login` with
   SHA-256 password hash + deviceUUID + single-device session; writes go
   straight to PocketBase REST (collections are DEMO_OPEN server-validated
   by hooks).
7. **Legacy mobile parity delivered natively:** floating bubble (overlay
   service), geofence events (BREACH/TRANSIT/MOCK/RETURN), OCR plate capture
   from a floating window (ML Kit), telemetry fixes.

## 5. Gotchas hit (don't re-trip)

- PowerShell in this repo: **no `&&`/`||`** — use `;` and `if ($?) {}`.
- `pbc` CLI: first-time creation needs `deploy --new <name>` (docs say
  `--name`); `pbc admin login` uses the 0.23+ `_superusers` endpoint →
  404 against 0.22 instances (platform limitation, not our bug).
- PocketBase Cloud portal ZIP upload ignores `pb_hooks/` — deploy hooks via
  CLI only. `pb_migrations` are MERGED on deploy, `pb_public` replaced.
- Cloud `deploy` prints generated admin login; our `--admin-*` flags are
  echoed but may not be applied to 0.22 instances (see W1).
- seat-limit hook blocks creating test users in the shared demo company —
  tests create their own company (`test_roaming.js` pattern).
- Gradle wrapper generation requires network URL validation; if it fails,
  `gradle wrapper --offline` works.
- Android `Tasks.await(task)` (blocking) inside services; `getCurrentLocation`
  needs permissions guarded; `Location.isMock` is API 31+ (use
  `isFromMockProvider` with deprecation suppression below).
- Notification actions must use immutable PendingIntents except geofence
  PendingIntents (`FLAG_MUTABLE` required by Play Services geofencing).

## 6. Command cheat-sheet

```powershell
# Fresh machine (one time, no admin rights):
powershell -ExecutionPolicy Bypass -File scripts\setup_new_device.ps1

# Local backend + all tests (needs backend\bin\pocketbase.exe + pb_data):
powershell -ExecutionPolicy Bypass -File scripts\run_local_tests.ps1
# Fresh pb_data: start serve once, then:
#   backend\bin\pocketbase.exe admin create itadmin@fieldops.local "<REDACTED>"
#   node backend\seed_schema.js   (with PB_URL/PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD env)

# APK:
powershell -ExecutionPolicy Bypass -File scripts\build_apk.ps1
adb install -r FieldOps-v2.0.0-debug.apk

# Cloud deploy:
powershell -ExecutionPolicy Bypass -File scripts\deploy_backend_cloud.ps1
# Cloud tests:
$env:PB_URL="https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com"
node tests\test_integration.js ; node tests\test_roaming.js
```

## 7. New/modified file map (this continuation)

```
backend/pb_migrations/1700000003_roaming_requests.js   new collection + rules
backend/pb_hooks/mobile_api.pb.js                      roaming-* routes (0.22 JSVM)
backend/pb_hooks/geofence_check.pb.js                  Geo* bypass + day pass + zone notes
backend/pbc.json                                       cloud deploy config (PB 0.22.32 pin)
backend/.pbcignore                                     excludes pb_data/bin/logs from deploys
app/android/**                                         full native Kotlin project (builds)
app/FieldOps-v2.0.0-debug.apk → repo root APK artifact
tests/test_roaming.js                                  13 checks, all passing
scripts/setup_new_device.ps1 | build_apk.ps1 | deploy_backend_cloud.ps1 | run_local_tests.ps1
KEYS_AND_ACCESS.md                                     cloud creds + pbc token (handoff)
.gitignore                                             android build dirs + APK exception
```

## 8. Git state

Repo: `fieldops-platform-core` (self-contained; clone/bundle and go).
Branch with this continuation: `continue/android-overlay-cloud` on top of
`main`. A transfer bundle `fieldops-continue.bundle` sits next to the repo
folder (workspace root) — on another machine:
`git clone fieldops-continue.bundle fieldops-platform-core` then
`git checkout continue/android-overlay-cloud`.

GitHub (private, pushed 2026-11-11):
`https://github.com/neelakantajk-Q/fieldops-platform-core`
Both `main` and `continue/android-overlay-cloud` are on origin. The 48 MB APK
is inside the repo (under GitHub's 100 MB limit); future release APKs should
go to GitHub Releases instead.

## 9. Graphify knowledge graph — query, don't grep
`graphify-out/` holds a code-only (no LLM/API key needed) knowledge graph of
the whole repo, built with graphify v0.9.106 (`pip install --user graphifyy`,
double-y; CLI `%APPDATA%\Python\Python312\Scripts\graphify.exe`, on PATH for
new terminals). Committing it means a fresh session can answer "where/how"
questions without reading files:

- `graphify-out/GRAPH_REPORT.md` — highlights, god-nodes, communities
- `graphify-out/graph.json` — full graph (what queries traverse)
- `graphify-out/graph.html` — interactive viz, open in a browser
- Commands (exit 0 = answer, 3 = ambiguous name, 4 = no match):
  `graphify query "roaming approval flow"` | `explain "GeofenceService"` |
  `path "LoginActivity" "attendance"` | `affected "geofence_check"`
- After editing code: `powershell -File scripts\sync_graph_shims.ps1` then
  `graphify update .` (incremental, no LLM). Use `--force` after deletions.
- Why `graphify-shims/` exists: graphify doesn't classify the `.pb.js`
  extension, so the 5 PocketBase hooks (the backend's core logic) are copied
  there as `.js` by the sync script purely for indexing. EDIT HOOKS IN
  `backend/pb_hooks/` ONLY and re-sync; never edit shims.
- The opencode skill + grep-interrupt hook were installed on this machine via
  `graphify install opencode` (writes to `~/.config/opencode/`); on a new
  machine run that once after installing graphifyy. `graphify install` also
  supports claude/codex/cursor/etc.
