# Graph Report - fieldops-platform-core  (2026-11-18)

## Corpus Check
- 111 files · ~113,302 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 42 file(s) not represented in the graph (top: .xml 30, (none) 5, .properties 2)
- WARNING: 42 of 179 files seen (23%) have no supported extractor and are missing from this graph entirely. It may look complete while representing only part of the codebase.

## Summary
- 990 nodes · 2261 edges · 69 communities (36 shown, 33 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 107 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `87ab91b1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- call
- pb.js
- Api
- Notify.kt
- Utils.js
- CameraOcrActivity.kt
- with
- Router.js
- MainActivity
- MainActivity
- api_fieldops.js
- Repo.js
- Masters.js
- pages.yml
- package.json
- Rbac.js
- listRecords
- JobCardScreen.js
- Attendance.js
- Vehicles.js
- App.js
- geofence_check.js
- app/src/config.js
- Auth.js
- Reminders.js
- Tasks.js
- CameraService
- LocationService
- appsscript.json
- test_roaming.js
- mobile_api.js
- test_e2e.js
- seat_limit.js
- Code.js
- Audit.js
- DynamicForms.js
- Seed.js
- Telemetry.js
- gradlew
- api_fieldops.pb.js
- runFinancialClosing_
- deploy_oci.sh
- app/build.gradle.kts

## God Nodes (most connected - your core abstractions)
1. `call()` - 60 edges
2. `Api` - 51 edges
3. `OverlayBubbleService` - 34 edges
4. `Card()` - 34 edges
5. `Spinner()` - 33 edges
6. `useAsync()` - 33 edges
7. `Btn()` - 32 edges
8. `PageHeader()` - 31 edges
9. `pbCall()` - 27 edges
10. `MainActivity` - 26 edges

## Surprising Connections (you probably didn't know these)
- `call()` --calls--> `pbCall()`  [EXTRACTED]
  web-client/src/api.js → web-client/src/lib/pb.js
- `poll()` --calls--> `call()`  [EXTRACTED]
  web-client/src/App.jsx → web-client/src/api.js
- `setPassword()` --calls--> `call()`  [EXTRACTED]
  web-client/src/pages/Admin.jsx → web-client/src/api.js
- `save()` --calls--> `call()`  [EXTRACTED]
  web-client/src/pages/Admin.jsx → web-client/src/api.js
- `save()` --calls--> `call()`  [EXTRACTED]
  web-client/src/pages/Jobs.jsx → web-client/src/api.js

## Import Cycles
- None detected.

## Communities (69 total, 33 thin omitted)

### Community 0 - "call"
Cohesion: 0.08
Nodes (101): react, call(), clearSession(), currentSession(), isAuthenticated(), post(), session, allowed() (+93 more)

### Community 1 - "pb.js"
Cohesion: 0.07
Nodes (52): ApiError, ensureOk(), saveSession(), BRAND, decodeDefaultEndpoint(), DEVICE_KEY, getApiBaseUrl(), SESSION_KEY (+44 more)

### Community 2 - "Api"
Cohesion: 0.07
Nodes (7): OverlayBubbleService, Stage, AWAITING_APPROVAL, JOB_ACTIVE, NEED_CHECKIN, ON_HOLD, READY_JOB

### Community 4 - "Utils.js"
Cohesion: 0.08
Nodes (4): FieldOpsApp, Notify, Prefs, RoamingActionReceiver

### Community 5 - "CameraOcrActivity.kt"
Cohesion: 0.05
Nodes (8): CameraOcrActivity, OnImageSavedCallback, Mode, ATTENDANCE, CAPTURE, JOB, LoginActivity, Watermark

### Community 6 - "with"
Cohesion: 0.10
Nodes (19): appError_(), bool_(), boolText_(), bytesToHex_(), constantEquals_(), createJsonResponse(), error_(), fiscalYear_() (+11 more)

### Community 7 - "Router.js"
Cohesion: 0.07
Nodes (28): defaults, env, runs-on, steps, run, VITE_API_BASE_URL, jobs, build (+20 more)

### Community 8 - "MainActivity"
Cohesion: 0.14
Nodes (18): getAnalyticsData_(), getAuditLogsList_(), getWorkflowsList_(), handleRequest_(), setupAction_(), setupAllStores(), toErrorResponse_(), bootstrap_() (+10 more)

### Community 9 - "MainActivity"
Cohesion: 0.05
Nodes (4): GeofenceReceiver, GeofenceService, GeoMath, MainActivity

### Community 10 - "api_fieldops.js"
Cohesion: 0.12
Nodes (4): PortalActivity, OnBackPressedCallback, WebChromeClient, WebViewClient

### Community 11 - "Repo.js"
Cohesion: 0.17
Nodes (14): activeFy_(), cell_(), ensureHeaders_(), fySheet_(), getOrCreateStoreTable(), getPrimaryStore(), getSetting_(), getSettingsMap_() (+6 more)

### Community 12 - "Masters.js"
Cohesion: 0.27
Nodes (19): clientsSheet_(), clientToJson_(), coordinate_(), findClient_(), findHub_(), hubRegion_(), hubsSheet_(), listClients_() (+11 more)

### Community 13 - "pages.yml"
Cohesion: 0.05
Nodes (38): defaults, env, runs-on, steps, concurrency, cancel-in-progress, group, run (+30 more)

### Community 14 - "package.json"
Cohesion: 0.16
Nodes (10): currentToken(), login(), logout(), pbAuth(), persist(), AttendanceScreen(), init(), performCheckIn() (+2 more)

### Community 15 - "Rbac.js"
Cohesion: 0.12
Nodes (19): leaflet, react-dom, vite, @vitejs/plugin-react, dependencies, leaflet@^1.9.4, react@^18.3.1, react-dom@^18.3.1 (+11 more)

### Community 16 - "listRecords"
Cohesion: 0.32
Nodes (18): ALL, api(), bad(), chkCapture(), chkComp(), chkCompSeq(), chkDup(), chkImmut() (+10 more)

### Community 17 - "JobCardScreen.js"
Cohesion: 0.16
Nodes (7): canSeeRow_(), defaultScope_(), normalizeRole_(), requireRowAccess_(), resolveSession_(), roleRank_(), sessionExpiry_()

### Community 18 - "Attendance.js"
Cohesion: 0.23
Nodes (12): createRecord(), listRecords(), updateRecord(), HOLD_REASONS, ReportsScreen(), loadAnalytics(), loadAuditLogs(), loadVehicleUptime() (+4 more)

### Community 19 - "Vehicles.js"
Cohesion: 0.14
Nodes (6): JOB_CODE_PREFIX, JOB_STATUS, Button(), HOLD_OPTIONS, JobCardScreen(), WatermarkService

### Community 20 - "App.js"
Cohesion: 0.23
Nodes (15): attendanceCheckIn_(), attendanceCheckOut_(), attendanceRow_(), attendanceToJson_(), canSeePerson_(), getAttendance_(), getOrgTree_(), sortTree() (+7 more)

### Community 21 - "geofence_check.js"
Cohesion: 0.28
Nodes (15): captureFeed_(), captureRow_(), capturesForPlate_(), captureToJson_(), countOpenJobsForPlate_(), findVehicleRow_(), openJobPlateMismatch_(), recordCapture_() (+7 more)

### Community 23 - "app/src/config.js"
Cohesion: 0.13
Nodes (3): HomeStack(), Stack, Tab

### Community 24 - "Auth.js"
Cohesion: 0.27
Nodes (3): ATTENDANCE_ACTIONS, CONFIG, JOB_CODE_FORMAT

### Community 25 - "Reminders.js"
Cohesion: 0.21
Nodes (10): adminCreateUser_(), adminSetPassword_(), adminUpdateUser_(), authenticateUser_(), confirmPasswordReset_(), getUsersList_(), logoutUser_(), requestPasswordReset_() (+2 more)

### Community 26 - "Tasks.js"
Cohesion: 0.39
Nodes (10): getReminders_(), logReminder_(), reminderDate_(), reminderHeaders_(), reminderLogHeaders_(), reminderRecord_(), reminderText_(), requireTenantOrSupervisor_() (+2 more)

### Community 27 - "CameraService"
Cohesion: 0.45
Nodes (10): assertAssignableUser_(), assertVehicleExists_(), findTaskRow_(), getTasksList_(), jobDelayReason_(), jobInterrupt_(), jobResume_(), saveTaskRecord_() (+2 more)

### Community 31 - "test_roaming.js"
Cohesion: 0.22
Nodes (8): dependencies, exceptionLogging, oauthScopes, runtimeVersion, timeZone, webapp, access, executeAs

### Community 32 - "mobile_api.js"
Cohesion: 0.42
Nodes (8): base64Url_(), base64UrlBytes_(), firebaseAccessToken_(), firebaseAlert_(), firebaseBaseUrl_(), firebaseMirrorSettings_(), firebaseMirrorVehicle_(), firebasePush_()

### Community 33 - "test_e2e.js"
Cohesion: 0.33
Nodes (7): api(), assert(), BASE, crypto, fieldopsLogin(), makeUser(), sha256()

### Community 35 - "seat_limit.js"
Cohesion: 0.43
Nodes (7): check(), geofenceCheck(), healthCheck(), holdTATCheck(), results, run(), seatLimitCheck()

### Community 36 - "Code.js"
Cohesion: 0.43
Nodes (7): api(), assert(), BASE, check(), fail(), main(), pass()

### Community 38 - "DynamicForms.js"
Cohesion: 0.70
Nodes (4): assertNoIdentityOverride_(), auditAccessDenied_(), auditIdentityMismatch_(), writeAudit_()

### Community 39 - "Seed.js"
Cohesion: 0.70
Nodes (4): getDynamicForms_(), getFormsRegistryStore(), saveDynamicField_(), VALIDATION_ROLE_()

### Community 40 - "Telemetry.js"
Cohesion: 0.50
Nodes (4): applyProofFolders_(), clearSampleData_(), ensureMigrated_(), seedSampleData_()

### Community 41 - "gradlew"
Cohesion: 0.50
Nodes (4): geofenceEvent_(), getTelemetry_(), telemetryBatch_(), touchVehicleLastSeen_()

### Community 43 - "api_fieldops.pb.js"
Cohesion: 0.67
Nodes (3): api(), BASE, main()

## Knowledge Gaps
- **8 isolated node(s):** `AWAITING_APPROVAL`, `JOB_ACTIVE`, `NEED_CHECKIN`, `ON_HOLD`, `READY_JOB` (+3 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 262 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **33 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `call` to `pb.js`, `package.json`, `Rbac.js`, `Vehicles.js`, `app/src/config.js`, `Auth.js`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `Api` (e.g. with `.requestTransit()` and `.saveCapture()`) actually correct?**
  _`Api` has 21 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AWAITING_APPROVAL`, `JOB_ACTIVE`, `NEED_CHECKIN` to the rest of the system?**
  _8 weakly-connected nodes found - possible missing edges._
- **Should `call` be split into smaller, more focused modules?**
  _Cohesion score 0.07658012063991608 - nodes in this community are weakly interconnected._
- **Why does `Api` connect `Notify.kt` to `MainActivity`, `Api`, `Utils.js`, `CameraOcrActivity.kt`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Should `pb.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0673076923076923 - nodes in this community are weakly interconnected._
- **Should `Api` be split into smaller, more focused modules?**
  _Cohesion score 0.07456140350877193 - nodes in this community are weakly interconnected._