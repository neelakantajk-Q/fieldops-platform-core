# Graph Report - fieldops-platform-core  (2026-11-11)

## Corpus Check
- 102 files · ~68,081 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 21 file(s) not represented in the graph (top: .xml 9, (none) 5, .properties 2)

## Summary
- 819 nodes · 1878 edges · 68 communities (30 shown, 38 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 89 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fada6510`
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
- OverlayBubbleService
- api_fieldops.js
- Repo.js
- Masters.js
- app/src/api.js
- package.json
- Rbac.js
- listRecords
- JobCardScreen.js
- Attendance.js
- Vehicles.js
- App.js
- app/src/config.js
- Auth.js
- Reminders.js
- Tasks.js
- CameraService
- LocationService
- appsscript.json
- Firebase.js
- test_roaming.js
- test_e2e.js
- test_integration.js
- Code.js
- Audit.js
- DynamicForms.js
- Seed.js
- Telemetry.js
- seed_schema.js
- api_fieldops.pb.js
- runFinancialClosing_
- deploy_oci.sh
- GeofenceReceiver.kt
- LoginActivity.kt
- GeofenceService
- Watermark.kt

## God Nodes (most connected - your core abstractions)
1. `call()` - 56 edges
2. `Api` - 43 edges
3. `Btn()` - 32 edges
4. `Card()` - 30 edges
5. `Spinner()` - 29 edges
6. `useAsync()` - 29 edges
7. `PageHeader()` - 27 edges
8. `pbCall()` - 27 edges
9. `react` - 25 edges
10. `useToast()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `ApiError` --inherits--> `PbError`  [EXTRACTED]
  web-client/src/api.js → web-client/src/lib/pb.js
- `call()` --calls--> `pbCall()`  [EXTRACTED]
  web-client/src/api.js → web-client/src/lib/pb.js
- `poll()` --calls--> `call()`  [EXTRACTED]
  web-client/src/App.jsx → web-client/src/api.js
- `setPassword()` --calls--> `call()`  [EXTRACTED]
  web-client/src/pages/Admin.jsx → web-client/src/api.js
- `save()` --calls--> `call()`  [EXTRACTED]
  web-client/src/pages/Admin.jsx → web-client/src/api.js

## Import Cycles
- None detected.

## Communities (68 total, 38 thin omitted)

### Community 0 - "call"
Cohesion: 0.09
Nodes (91): react, ApiError, call(), clearSession(), currentSession(), ensureOk(), isAuthenticated(), post() (+83 more)

### Community 1 - "pb.js"
Cohesion: 0.08
Nodes (43): decodeDefaultEndpoint(), DEVICE_KEY, getApiBaseUrl(), SESSION_KEY, setApiBaseUrl(), companyId(), create(), currentToken() (+35 more)

### Community 3 - "Notify.kt"
Cohesion: 0.09
Nodes (4): FieldOpsApp, Notify, Prefs, RoamingActionReceiver

### Community 4 - "Utils.js"
Cohesion: 0.10
Nodes (19): appError_(), bool_(), boolText_(), bytesToHex_(), constantEquals_(), createJsonResponse(), error_(), fiscalYear_() (+11 more)

### Community 6 - "with"
Cohesion: 0.07
Nodes (28): defaults, env, runs-on, steps, run, VITE_API_BASE_URL, jobs, build (+20 more)

### Community 7 - "Router.js"
Cohesion: 0.15
Nodes (17): getAnalyticsData_(), getAuditLogsList_(), getWorkflowsList_(), handleRequest_(), setupAction_(), setupAllStores(), toErrorResponse_(), bootstrap_() (+9 more)

### Community 11 - "Repo.js"
Cohesion: 0.17
Nodes (14): activeFy_(), cell_(), ensureHeaders_(), fySheet_(), getOrCreateStoreTable(), getPrimaryStore(), getSetting_(), getSettingsMap_() (+6 more)

### Community 12 - "Masters.js"
Cohesion: 0.27
Nodes (19): clientsSheet_(), clientToJson_(), coordinate_(), findClient_(), findHub_(), hubRegion_(), hubsSheet_(), listClients_() (+11 more)

### Community 13 - "app/src/api.js"
Cohesion: 0.16
Nodes (10): currentToken(), login(), logout(), pbAuth(), persist(), AttendanceScreen(), init(), performCheckIn() (+2 more)

### Community 14 - "package.json"
Cohesion: 0.13
Nodes (17): react-dom, vite, @vitejs/plugin-react, dependencies, react@^18.3.1, react-dom@^18.3.1, devDependencies, vite@^5.4.10 (+9 more)

### Community 15 - "Rbac.js"
Cohesion: 0.16
Nodes (7): canSeeRow_(), defaultScope_(), normalizeRole_(), requireRowAccess_(), resolveSession_(), roleRank_(), sessionExpiry_()

### Community 16 - "listRecords"
Cohesion: 0.23
Nodes (12): createRecord(), listRecords(), updateRecord(), HOLD_REASONS, ReportsScreen(), loadAnalytics(), loadAuditLogs(), loadVehicleUptime() (+4 more)

### Community 17 - "JobCardScreen.js"
Cohesion: 0.14
Nodes (6): JOB_CODE_PREFIX, JOB_STATUS, Button(), HOLD_OPTIONS, JobCardScreen(), WatermarkService

### Community 18 - "Attendance.js"
Cohesion: 0.23
Nodes (15): attendanceCheckIn_(), attendanceCheckOut_(), attendanceRow_(), attendanceToJson_(), canSeePerson_(), getAttendance_(), getOrgTree_(), sortTree() (+7 more)

### Community 19 - "Vehicles.js"
Cohesion: 0.25
Nodes (16): captureFeed_(), captureRow_(), capturesForPlate_(), captureToJson_(), countOpenJobsForPlate_(), findVehicleRow_(), linkCaptureToJob_(), openJobPlateMismatch_() (+8 more)

### Community 20 - "App.js"
Cohesion: 0.13
Nodes (3): HomeStack(), Stack, Tab

### Community 23 - "app/src/config.js"
Cohesion: 0.27
Nodes (3): ATTENDANCE_ACTIONS, CONFIG, JOB_CODE_FORMAT

### Community 24 - "Auth.js"
Cohesion: 0.21
Nodes (10): adminCreateUser_(), adminSetPassword_(), adminUpdateUser_(), authenticateUser_(), confirmPasswordReset_(), getUsersList_(), logoutUser_(), requestPasswordReset_() (+2 more)

### Community 25 - "Reminders.js"
Cohesion: 0.39
Nodes (10): getReminders_(), logReminder_(), reminderDate_(), reminderHeaders_(), reminderLogHeaders_(), reminderRecord_(), reminderText_(), requireTenantOrSupervisor_() (+2 more)

### Community 26 - "Tasks.js"
Cohesion: 0.45
Nodes (10): assertAssignableUser_(), assertVehicleExists_(), findTaskRow_(), getTasksList_(), jobDelayReason_(), jobInterrupt_(), jobResume_(), saveTaskRecord_() (+2 more)

### Community 29 - "appsscript.json"
Cohesion: 0.22
Nodes (8): dependencies, exceptionLogging, oauthScopes, runtimeVersion, timeZone, webapp, access, executeAs

### Community 30 - "Firebase.js"
Cohesion: 0.42
Nodes (8): base64Url_(), base64UrlBytes_(), firebaseAccessToken_(), firebaseAlert_(), firebaseBaseUrl_(), firebaseMirrorSettings_(), firebaseMirrorVehicle_(), firebasePush_()

### Community 31 - "test_roaming.js"
Cohesion: 0.33
Nodes (7): api(), assert(), BASE, crypto, fieldopsLogin(), makeUser(), sha256()

### Community 33 - "test_e2e.js"
Cohesion: 0.43
Nodes (7): check(), geofenceCheck(), healthCheck(), holdTATCheck(), results, run(), seatLimitCheck()

### Community 34 - "test_integration.js"
Cohesion: 0.43
Nodes (7): api(), assert(), BASE, check(), fail(), main(), pass()

### Community 37 - "Audit.js"
Cohesion: 0.70
Nodes (4): assertNoIdentityOverride_(), auditAccessDenied_(), auditIdentityMismatch_(), writeAudit_()

### Community 38 - "DynamicForms.js"
Cohesion: 0.70
Nodes (4): getDynamicForms_(), getFormsRegistryStore(), saveDynamicField_(), VALIDATION_ROLE_()

### Community 39 - "Seed.js"
Cohesion: 0.50
Nodes (4): applyProofFolders_(), clearSampleData_(), ensureMigrated_(), seedSampleData_()

### Community 40 - "Telemetry.js"
Cohesion: 0.50
Nodes (4): geofenceEvent_(), getTelemetry_(), telemetryBatch_(), touchVehicleLastSeen_()

### Community 42 - "seed_schema.js"
Cohesion: 0.67
Nodes (3): api(), BASE, main()

## Knowledge Gaps
- **38 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `call` to `app/src/api.js`, `package.json`, `JobCardScreen.js`, `App.js`, `app/src/config.js`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Are the 15 inferred relationships involving `Api` (e.g. with `.saveCapture()` and `.onReceive()`) actually correct?**
  _`Api` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Should `call` be split into smaller, more focused modules?**
  _Cohesion score 0.08655083655083655 - nodes in this community are weakly interconnected._
- **Why does `Api` connect `Api` to `LoginActivity.kt`, `Notify.kt`, `CameraOcrActivity.kt`, `MainActivity`, `OverlayBubbleService`, `GeofenceReceiver.kt`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Should `pb.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08144796380090498 - nodes in this community are weakly interconnected._
- **Why does `call()` connect `call` to `pb.js`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Should `Api` be split into smaller, more focused modules?**
  _Cohesion score 0.14268292682926828 - nodes in this community are weakly interconnected._