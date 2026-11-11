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

### W1 (blocker) — Cloud admin auth returns 400 "Failed to authenticate"
The cloud instance rejects `/api/admins/auth-with-password` for
`itadmin@fieldops.local / FieldOps#2026` even though
`pbc pocketbase superuser sync` reports success and
`pbc pocketbase info` shows those creds. Local PB auths fine with the same
code path. Debug checklist:
1. Wait 10+ minutes (PB brute-force lockout after ~8 failures) and retry ONCE.
2. Try the portal admin panel at `https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com/_/`
   (human login) — if the panel works but REST 400s, inspect request shape.
3. Portal → instance → admin credentials → **Reset Password** (needs 12–20
   chars; e.g. `FieldOps#2026!X`), then re-run `scripts/run_local_tests.ps1`
   style checks against `PB_URL=https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com`.
4. Nuclear option: delete instance, recreate via
   `pbc pocketbase deploy --new fieldops-db2 --pb-version 0.22.32
   --admin-email itadmin@fieldops.local --admin-password '…20 chars…'`,
   then redeploy backend + seed (`PB_URL=… node backend/seed_schema.js`).
5. After auth works: run `tests/test_integration.js` + `tests/test_roaming.js`
   against the cloud URL (set `PB_URL`), then verify seeded data in the panel.

### W2 — Deploy the new backend files to the cloud
`mobile_api.pb.js`, `geofence_check.pb.js` (Geo* bypass + day pass), and
migration `1700000003_roaming_requests.js` are committed but the cloud
instance was deployed BEFORE they existed. Run
`powershell -File scripts/deploy_backend_cloud.ps1` (or portal ZIP upload —
but note portal upload **ignores pb_hooks**; CLI deploy carries hooks).
Verify: `POST /api/fieldops/roaming-status` returns 200 shape
`{success:true, approved:false, pending:false}` (needs a valid sessionToken;
an empty token returns 401 SESSION_INVALID — that also proves the route lives).

### W3 — Web client: finish install + roaming card
`web-client/` npm install was interrupted once; re-run `npm install` then
`npm run build` and fix any errors. Add a "Transit approvals" card
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
#   backend\bin\pocketbase.exe admin create itadmin@fieldops.local "FieldOps#2026"
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
