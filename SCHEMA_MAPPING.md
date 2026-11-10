# FieldOps Platform — Legacy GAS → PocketBase Schema Mapping

> **Source of truth:** the live Google Apps Script project
> (`scriptId 17Gilh4r6VXMNQpuffEC1Yc3_x-LNGkjGFsyL3FMBMm2QzQtWw3ZiKHWe`),
> pulled on 2026-11-10 into `legacy-reference/gas-latest/` (21 files).
> The three files previously in `src/` were stale (Oct 28) and incomplete.

## 0. What the legacy system actually is

- **Product:** "Field Operations & HRMS Portal", backend `ping` reports `version 2.0.0`, `SCHEMA_VERSION = '4'`.
- **Transport:** single JSON `doPost` dispatcher (`Router.js` → `ACTIONS` map). Request body:
  `{ action, clientRequestId, deviceUUID, sessionToken, ...payload }` posted as `text/plain`.
  Response envelope from `Utils.js`: `{ ok, success, code, serverTime, ...data }` or `{ ok:false, success:false, code, message }`.
- **Storage:** one Google Sheet per fiscal year (`<Table>_FYxxxx`) plus tenant tables and a `Settings` key/value sheet.
- **Auth:** server-side password verify (`v1$1024$salt$hash`, plus legacy client SHA-256 accepted), **single-device sessions** bound to `ActiveDeviceToken`/`ActiveDeviceUUID`, session expires at midnight or hard cap (8h admin / 12h others).
- **Roles:** `Technician(1) < Supervisor(2) < Moderator(3) < Administrator(4) < Platform(99)`. Legacy `StandardUser`→`Technician`, `SuperAdmin`→`Administrator`.
- **Scopes:** `SELF`, `HUB`, `REGION`, `ALL`.
- **Mobile client:** a **Kodular/Android WebView** wrapping the portal; native bridge `window.AndroidBridge` exposes `cloudPost`, `adoptSession`, `setLoggedIn`, `logout`. There is **no Android/Gradle/Flutter source in this workspace** — the app is the hosted `index.html` + bridge.

## 1. Legacy sheets (from `Repo.js` SCHEMA / FY_SCHEMA)

| Legacy sheet | Columns (verbatim) |
|---|---|
| `MasterMetadata` (users) | UserId, Username, Role, Status, AssignedHub, WorkMode, ShiftStart, ShiftEnd, ModuleRights, PhoneNumber, LastLogin, ActiveSessionToken, ActiveDeviceUUID, PasswordHash, SessionExpiry, Region, Scope, TokenNonce, CheckInAt, CheckInProofUrl, CheckInSession, ReportsTo, Capability, AllowSelfReset |
| `Settings` | Key, Value |
| `Workflows` | DocId, Title, Category, Content, MinRoleRequired, CommercialDetails |
| `FormsRegistry` | FormId, FormName, FieldKey, Label, ControlType, ValidationRegex, Options, MinRole |
| `ToDoReminders` | ReminderId, UserId, Username, Title, Note, ReminderAt, Status, CreatedAt, UpdatedAt |
| `ToDoReminderLogs` | LogId, ReminderId, UserId, Username, Action, Note, Timestamp |
| `Regions` | RegionId, Name, Notes, Active, CreatedAt, CreatedBy, UpdatedAt, UpdatedBy |
| `Hubs` | HubId, Name, Region, Lat, Lng, RadiusMeters, Active, CreatedAt, CreatedBy, UpdatedAt, UpdatedBy |
| `Clients` | ClientId, Name, HubId, Region, Address, Lat, Lng, ContactName, ContactPhone, Active, CreatedAt, CreatedBy, UpdatedAt, UpdatedBy |
| `Attendance_<FY>` | Timestamp, UserId, Action, Lat, Long, WithinGeoFence, OfflineSync, HubName, PhotoProofUrl, DeviceUUID, SessionId, Accuracy, MockFlag, ClientRequestId, Notes |
| `Tasks_<FY>` (job cards) | JobId, AssignedUserId, Hub, Client, Status, StartTime, EndTime, TurnaroundMinutes, ServiceNotes, VehicleNo, Checklist, PartsUsed, JobCardPhotoUrl, PlateSource, OcrConfidence, SessionId, DelayCategory, DelayReason, InterruptedReason, CreatedAt, CreatedBy, UpdatedAt, UpdatedBy, OvertimeAlertedAt, ResumedFrom, ClientId, PhotoFileId |
| `Vehicles_<FY>` | PlateNo, PlateRaw, Make, Model, AssignedUserId, Hub, Status, LastSeenLat, LastSeenLng, LastSeenAt, AnomalyFlags, Source, OcrConfidence, Notes, CreatedAt, CreatedBy, UpdatedAt, UpdatedBy, Active |
| `Captures_<FY>` | CaptureId, UserId, DeviceUUID, PlateNo, PlateRaw, Confidence, Source, CapturedAt, JobId, PhotoUrl, AnomalyFlags, ClientRequestId |
| `Telemetry_<FY>` | LogId, UserId, DeviceUUID, Timestamp, Lat, Lng, Accuracy, DistanceMeters, Zone, BatteryPct, MockFlag, Source, ClientRequestId |
| `AuditLogs_<FY>` | LogId, Timestamp, UserId, ActivityType, Details, DisruptionFlag |

Key legacy enums:
- Job status (`Tasks.js` `JOB_STATUS`): `InProgress | Completed | Delayed | Interrupted | Cancelled`.
- Vehicle status: `Active | Idle | OutOfZone | Unknown | Archived`. Anomaly flags: `UNKNOWN_VEHICLE | PLATE_MISMATCH | DUPLICATE_ACTIVE | MOCK_GPS`.
- Attendance Action: `CheckIn | CheckOut | GeoBreach | GeoTransit | GeoMock | GeoReturn`.
- `ModuleRights`: comma list, e.g. `ALL` or `Tasks,Attendance,Vehicles,Reports,Audit,Forms,Docs,Bubble`.

## 2. Legacy actions → PocketBase target (from `Router.js` `ACTIONS`)

| Legacy action | Gate | PocketBase mapping |
|---|---|---|
| `login` | public | `POST /api/collections/users/auth-with-password` (extend with `device_uuid`, single-device rule) |
| `requestPasswordReset` / `confirmPasswordReset` | public | custom route `/api/fieldops/password-reset/{request,confirm}` |
| `getSplashMetadata` / `platformConfig` / `ping` | public | custom route `/api/fieldops/config` + `GET /api/health` |
| `bootstrap` / `sessionStatus` | session | `POST /api/collections/users/auth-refresh` + `/api/fieldops/bootstrap` |
| `logout` | session | `POST /api/collections/users/auth-refresh` revoke + clear device binding |
| `getUsers` / `adminCreateUser` / `adminSetPassword` / `adminUpdateUser` / `setPasswordHash` | admin | `users` collection + `seat_limit` hook |
| `getTeam` / `getOrgTree` | session | `users` (filter by hub/region/reports_to) |
| `mastersList` / `masterCreate` / `masterUpdate` / `masterArchive` | session/admin | `regions`, `service_hubs`, `clients` collections |
| `getAttendance` | session | `attendance` (scope-filtered) |
| `logAttendance` / `attendanceCheckIn` / `attendanceCheckOut` / `geofenceEvent` | session + module + check-in | `attendance` + `geofence_check` hook |
| `getTasks` / `saveTask` / `updateTaskStatus` | session + module + check-in | `job_cards` (+ `job_tat_calculator` on `Completed`) |
| `jobDelayReason` / `jobInterrupt` / `jobResume` | session | `job_cards` status transitions; **maps to new `job_card_holds`** |
| `getVehicles`/`vehicleList`/`vehicleGet`/`vehicleUpsert`/`vehicleUpdate`/`vehicleArchive` | session | `vehicles` |
| `getCaptureFeed` / `ocrCapture` / `logVehicleAI` / `linkCaptureToJob` | session + check-in | `captures` |
| `telemetryBatch` / `getTelemetry` | session | `telemetry` |
| `getAnalytics` / `getAuditLogs` / `getWorkflows` / `getDynamicForms` / `saveDynamicField` | session/admin | `analytics` views + `audit_logs`, `workflows`, `forms_registry` |
| `getReminders` / `saveReminder` / `updateReminderStatus` | session | `reminders`, `reminder_logs` |
| `getAdminSettings` / `updateAdminSettings` / `updateSplashMetadata` / `updateFirebaseSettings` / `broadcastSync` / `runFinancialClosing` | admin/coordinator | `settings` collection (singleton) |
| `updatePlatformUrls` / `seedSampleData` / `clearSampleData` | platform capability | platform-only routes |
| `setupAll` | bootstrap | first-run schema seeder |

## 3. Target PocketBase collections

### 3.1 Tenant & org
- **`companies`** — `name`, `seat_limit` (default 50), `status` (`Active|Suspended|Expired`).
- **`regions`** — `company_id`, `region_code`, `name`, `notes`, `active`.
- **`service_hubs`** (legacy `Hubs`) — `company_id`, `hub_code`, `name`, `region_id`, `latitude`, `longitude`, `radius_meters` (legacy default 300–800), `allow_roaming`, `active`.
- **`clients`** (legacy `Clients`) — `company_id`, `client_code`, `name`, `hub_id`, `region_id`, `address`, `latitude`, `longitude`, `contact_name`, `contact_phone`, `active`.

### 3.2 People
- **`users`** (legacy `MasterMetadata`) — `company_id`, `user_code` (legacy `UserId`), `username` (unique), `passwordHash`, `role` (`Technician|Supervisor|Moderator|Administrator|Platform`), `status` (`Active|Suspended`), `hub_id`, `region_id`, `work_mode`, `shift_start`, `shift_end`, `module_rights`, `phone_number`, `reports_to`, `scope` (`SELF|HUB|REGION|ALL`), `allow_self_reset`, `capability`, `last_login`, `active_device_uuid`, `active_session_token`, `session_expiry`, `check_in_at`, `check_in_proof`, `check_in_session`.

### 3.3 Field operations
- **`attendance`** (legacy `Attendance_<FY>`) — `company_id`, `user_id`, `hub_id`, `action`, `timestamp`, `latitude`, `longitude`, `within_geofence`, `offline_sync`, `hub_name`, `photo_proof`, `device_uuid`, `session_id`, `accuracy_meters`, `mock_flag`, `client_request_id`, `notes`, `distance_from_hub_meters`, `status` (`Verified|Verified_Roaming|Rejected_Geofence|Rejected_Mock|Rejected_Accuracy`).
- **`vehicles`** (legacy `Vehicles_<FY>`) — `company_id`, `plate_no` (unique), `plate_raw`, `vin`, `make`, `model`, `assigned_user_id`, `hub_id`, `status`, `last_seen_lat/lng/at`, `anomaly_flags`, `source`, `ocr_confidence`, `notes`, `active`.
- **`captures`** (legacy `Captures_<FY>`) — `company_id`, `capture_code`, `user_id`, `device_uuid`, `plate_no`, `plate_raw`, `confidence`, `source`, `captured_at`, `job_card_id`, `photo`, `anomaly_flags`, `client_request_id`.
- **`job_cards`** (legacy `Tasks_<FY>`) — `company_id`, `job_code` (legacy `JobId`; new sequential `JC-YYYYMM-HUB-XXXX`), `vehicle_id`, `technician_id`, `hub_id`, `client_id`, `status` (`OPEN|IN_PROGRESS|ON_HOLD|CLOSED|CANCELLED` — legacy `InProgress|Completed|Delayed|Interrupted|Cancelled` mapped), `breakdown_reported_at`, `job_started_at` (legacy `StartTime`), `job_completed_at` (legacy `EndTime`), `vehicle_released_at`, `service_notes`, `checklist`, `parts_used`, `start_proof_photo`, `end_proof_photo` (legacy `JobCardPhotoUrl`/`PhotoFileId`), `plate_source`, `ocr_confidence`, `delay_category`, `delay_reason`, `interrupted_reason`, `resumed_from`, `overtime_alerted_at`, `client_request_id`, **computed:** `gross_tat_minutes`, `total_hold_minutes`, `active_wrench_minutes`, `total_downtime_minutes`.
- **`job_card_holds`** (NEW — derives from legacy `Delayed`/`Interrupted`/`ResumedFrom`) — `job_card_id`, `reason` (`WAITING_FOR_SPARES|WAITING_APPROVAL|FACILITY_LIMITATION`), `notes`, `held_at`, `resumed_at`, `duration_minutes`.
- **`capa_records`** (NEW — no legacy equivalent) — `job_card_id`, `root_cause`, `corrective_action`, `preventive_action`, `verified_by`, `status` (`OPEN|RESOLVED|CLOSED`).

### 3.4 Observability & config
- **`telemetry`** (legacy `Telemetry_<FY>`) — `company_id`, `user_id`, `device_uuid`, `timestamp`, `latitude`, `longitude`, `accuracy_meters`, `distance_meters`, `zone`, `battery_pct`, `mock_flag`, `source`, `client_request_id`.
- **`audit_logs`** (legacy `AuditLogs_<FY>`) — `company_id`, `timestamp`, `user_id`, `activity_type`, `details`, `disruption_flag`.
- **`settings`** (legacy `Settings` K/V, singleton per company) — plate_format, realtime_enabled, sync_push_enabled, current_fy, geofence_radius_meters, geofence_buffer_meters, telemetry_push_minutes, max_users, firebase_db_url, api_endpoint, asset_base, splash_*.
- **`workflows`** (legacy `Workflows`) — `doc_code`, `title`, `category`, `content`, `min_role`, `commercial_details`.
- **`forms_registry`** (legacy `FormsRegistry`) — `form_code`, `form_name`, `field_key`, `label`, `control_type`, `validation_regex`, `options`, `min_role`.
- **`reminders`** / **`reminder_logs`** (legacy `ToDoReminders` / `ToDoReminderLogs`).

## 4. Fiscal-year handling

Legacy suffixes every operational table with `_FYxxxx` (`FY_SCHEMA`). In PocketBase this becomes a `fiscal_year` text field on `attendance`, `job_cards`, `vehicles`, `captures`, `telemetry`, `audit_logs`, with a `CurrentFY` value in `settings`. No table duplication per year.

## 5. Behaviour that must be preserved in hooks

1. **Single-device session:** one `active_session_token` + `active_device_uuid` per user; a second device is rejected with `AUTH_REVOKED`/`sessionConflict` unless `forceTakeover`.
2. **Photo check-in gate:** `saveTask`, `recordCapture`, `jobResume` require `checkedIn` → `CHECKIN_REQUIRED`.
3. **Geofence:** server-side Haversine vs `Hubs.RadiusMeters`; `allow_roaming` bypass; mock flag + accuracy ≤ 25 m anti-cheat.
4. **Seat limit:** `MaxUsers` (legacy default 30, new contractual **50**) enforced on user creation.
5. **Idempotency:** every mutating call carries `clientRequestId`; repeats are acknowledged without duplicate rows.
6. **RBAC:** role rank + module rights + SELF/HUB/REGION/ALL scope, evaluated server-side only.
7. **TAT:** legacy stored only `TurnaroundMinutes` on `Completed`; the new platform adds gross/hold/wrench/downtime via `job_tat_calculator.pb.js`.
