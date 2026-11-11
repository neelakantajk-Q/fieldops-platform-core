/// <reference path="../pb_data/types.d.ts" />
/**
 * Initial FieldOps schema for PocketBase 0.22.x.
 * Mirrors legacy GAS sheets (see SCHEMA_MAPPING.md) plus the new
 * job_card_holds / capa_records collections required by the platform brief.
 *
 * WARNING â€” DEMO RULES: to let the GitHub Pages test frontend talk to the API
 * directly, operational collections are open. `users` stays locked and is
 * only reachable through /api/fieldops/* routes. Before production, replace
 * every null rule below with scope-aware rules (SELF/HUB/REGION/ALL).
 */
migrate((db) => {
  const dao = new Dao(db);

  const T = (name, required, extra) => Object.assign({
    name, type: "text", required: !!required, unique: false,
    options: { min: null, max: null, pattern: "" }
  }, extra || {});
  const N = (name, required, extra) => Object.assign({
    name, type: "number", required: !!required, unique: false,
    options: { min: null, max: null, noDecimal: false }
  }, extra || {});
  const B = (name) => ({ name, type: "bool", required: false, unique: false, options: {} });
  const D = (name, required) => ({ name, type: "date", required: !!required, unique: false, options: { min: "", max: "" } });
  const S = (name, values, required) => ({ name, type: "select", required: !!required, unique: false, options: { maxSelect: 1, values } });
  const J = (name) => ({ name, type: "json", required: false, unique: false, options: { maxSize: 2000000 } });
  const F = (name, maxSelect) => ({ name, type: "file", required: false, unique: false, options: { maxSelect: maxSelect || 1, maxSize: 10485760, mimeTypes: ["image/jpeg", "image/png"] } });
  const R = (name, collectionId, required) => ({ name, type: "relation", required: !!required, unique: false, options: { collectionId, cascadeDelete: false, minSelect: 0, maxSelect: 1 } });

  const IDs = {
    companies: "companies000000",
    regions: "regions00000000",
    hubs: "service_hubs000",
    clients: "clients00000000",
    users: "users0000000000",
    vehicles: "vehicles0000000",
    attendance: "attendance00000",
    captures: "captures0000000",
    jobCards: "job_cards000000",
    holds: "job_card_holds0",
    capa: "capa_records000",
    telemetry: "telemetry00000",
    audit: "audit_logs00000",
    settings: "settings0000000",
    workflows: "workflows00000",
    forms: "forms_registry0",
    reminders: "reminders00000",
    reminderLogs: "reminder_logs00"
  };

  // PocketBase 0.22 rule semantics: null = admin-only, "" = public.
  // Operational collections are open (demo); users is admin-only; audit_logs read-only.
  const DEMO_OPEN = {
    listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: ""
  };
  const LOCKED = {
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null
  };
  const READ_ONLY = { listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null };

  const save = (name, id, schema, rules, opts) => {
    const c = new Collection(Object.assign({
      id, name, type: "base", system: false
    }, DEMO_OPEN, opts || {}, rules || {}));
    for (let i = 0; i < schema.length; i++) {
      c.schema.addField(new SchemaField(Object.assign({}, schema[i], { unique: false })));
    }
    dao.saveCollection(c);
  };

  // PocketBase ships a default auth collection named "users" on fresh
  // databases; FieldOps owns "users", so the stock one goes first.
  try {
    const stockUsers = dao.findCollectionByNameOrId("users");
    if (stockUsers && stockUsers.id !== IDs.users) {
      dao.deleteCollection(stockUsers);
    }
  } catch (err) { /* not present */ }

  save("companies", IDs.companies, [
    T("name", true), N("seat_limit"), S("status", ["Active", "Suspended", "Expired"])
  ]);

  save("regions", IDs.regions, [
    R("company_id", IDs.companies, true), T("region_code"), T("name", true), T("notes"), B("active")
  ]);

  save("service_hubs", IDs.hubs, [
    R("company_id", IDs.companies, true), T("hub_code"), T("name", true),
    R("region_id", IDs.regions), N("latitude"), N("longitude"),
    N("radius_meters"), B("allow_roaming"), B("active")
  ]);

  save("clients", IDs.clients, [
    R("company_id", IDs.companies, true), T("client_code"), T("name", true),
    R("hub_id", IDs.hubs), R("region_id", IDs.regions), T("address"),
    N("latitude"), N("longitude"), T("contact_name"), T("contact_phone"),
    B("active")
  ]);

  save("users", IDs.users, [
    R("company_id", IDs.companies, true), T("user_code"), T("username", true, { unique: true }),
    T("password_hash"), S("role", ["Technician", "Supervisor", "Moderator", "Administrator", "Platform"]),
    S("status", ["Active", "Suspended"]), R("hub_id", IDs.hubs), R("region_id", IDs.regions),
    T("work_mode"), T("shift_start"), T("shift_end"), T("module_rights"), T("phone_number"),
    T("reports_to"), S("scope", ["SELF", "HUB", "REGION", "ALL"]), B("allow_self_reset"),
    T("capability"), D("last_login"), T("active_device_uuid"), T("active_session_token"),
    N("session_expiry"), D("check_in_at"), T("check_in_proof"), T("check_in_session")
  ], LOCKED);

  save("vehicles", IDs.vehicles, [
    R("company_id", IDs.companies, true), T("plate_no", true, { unique: true }), T("plate_raw"),
    T("vin"), T("make"), T("model"), R("assigned_user_id", IDs.users), R("hub_id", IDs.hubs),
    S("status", ["Active", "Idle", "OutOfZone", "Unknown", "Archived"]),
    N("last_seen_lat"), N("last_seen_lng"), D("last_seen_at"), T("anomaly_flags"),
    T("source"), N("ocr_confidence"), T("notes"), B("active"),
    T("fiscal_year")
  ]);

  save("attendance", IDs.attendance, [
    R("company_id", IDs.companies, true), R("user_id", IDs.users, true), R("hub_id", IDs.hubs),
    S("action", ["CheckIn", "CheckOut", "GeoBreach", "GeoTransit", "GeoMock", "GeoReturn"], true),
    D("timestamp", true), N("latitude"), N("longitude"), B("within_geofence"), B("offline_sync"),
    T("hub_name"), F("photo_proof"), T("device_uuid"), T("session_id"), N("gps_accuracy_meters"),
    B("is_mock_provider"), T("client_request_id"), T("notes"), N("distance_from_hub_meters"),
    S("status", ["Verified", "Verified_Roaming", "Rejected_Geofence", "Rejected_Mock", "Rejected_Accuracy"]),
    T("fiscal_year")
  ], { listRule: "" });

  save("captures", IDs.captures, [
    R("company_id", IDs.companies, true), T("capture_code"), R("user_id", IDs.users),
    T("device_uuid"), T("plate_no"), T("plate_raw"), N("confidence"),
    S("source", ["OCR", "MANUAL"]), D("captured_at"), R("job_card_id", IDs.jobCards),
    F("photo"), T("anomaly_flags"), T("client_request_id"), T("fiscal_year")
  ]);

  save("job_cards", IDs.jobCards, [
    R("company_id", IDs.companies, true), T("job_code", true, { unique: true }),
    R("vehicle_id", IDs.vehicles), R("technician_id", IDs.users), R("hub_id", IDs.hubs),
    R("client_id", IDs.clients),
    S("status", ["OPEN", "IN_PROGRESS", "ON_HOLD", "CLOSED", "CANCELLED"]),
    D("breakdown_reported_at"), D("job_started_at"), D("job_completed_at"), D("vehicle_released_at"),
    T("service_notes"), T("checklist"), T("parts_used"),
    F("start_proof_photo"), F("end_proof_photo"),
    T("plate_source"), N("ocr_confidence"), T("delay_category"), T("delay_reason"),
    T("interrupted_reason"), T("resumed_from"), D("overtime_alerted_at"), T("client_request_id"),
    N("gross_tat_minutes"), N("total_hold_minutes"), N("active_wrench_minutes"), N("total_downtime_minutes"),
    T("fiscal_year")
  ]);

  save("job_card_holds", IDs.holds, [
    R("job_card_id", IDs.jobCards, true),
    S("reason", ["WAITING_FOR_SPARES", "WAITING_APPROVAL", "FACILITY_LIMITATION"], true),
    T("notes"), D("held_at"), D("resumed_at"), N("duration_minutes")
  ]);

  save("capa_records", IDs.capa, [
    R("job_card_id", IDs.jobCards, true), T("root_cause"), T("corrective_action"),
    T("preventive_action"), R("verified_by", IDs.users),
    S("status", ["OPEN", "RESOLVED", "CLOSED"])
  ]);

  save("telemetry", IDs.telemetry, [
    R("company_id", IDs.companies, true), R("user_id", IDs.users), T("device_uuid"),
    D("timestamp"), N("latitude"), N("longitude"), N("accuracy_meters"), N("distance_meters"),
    T("zone"), N("battery_pct"), B("is_mock_provider"), T("source"), T("client_request_id"),
    T("fiscal_year")
  ]);

  save("audit_logs", IDs.audit, [
    R("company_id", IDs.companies), D("timestamp"), R("user_id", IDs.users),
    T("activity_type"), T("details"), B("disruption_flag"), T("fiscal_year")
  ]);

  save("settings", IDs.settings, [
    R("company_id", IDs.companies), T("key", true), T("value")
  ]);

  save("workflows", IDs.workflows, [
    R("company_id", IDs.companies), T("doc_code"), T("title"), T("category"), T("content"),
    T("min_role"), T("commercial_details")
  ]);

  save("forms_registry", IDs.forms, [
    R("company_id", IDs.companies), T("form_code"), T("form_name"), T("field_key"), T("label"),
    T("control_type"), T("validation_regex"), T("options"), T("min_role")
  ]);

  save("reminders", IDs.reminders, [
    R("company_id", IDs.companies), R("user_id", IDs.users), T("title"), T("note"),
    D("reminder_at"), S("status", ["Pending", "Done", "Dismissed"])
  ]);

  save("reminder_logs", IDs.reminderLogs, [
    R("company_id", IDs.companies), R("reminder_id", IDs.reminders), R("user_id", IDs.users),
    T("action"), T("note"), D("timestamp")
  ]);
}, (db) => {
  const dao = new Dao(db);
  [
    "reminder_logs", "reminders", "forms_registry", "workflows", "settings", "audit_logs",
    "telemetry", "capa_records", "job_card_holds", "job_cards", "captures", "attendance",
    "vehicles", "users", "clients", "service_hubs", "regions", "companies"
  ].forEach((name) => {
    try { dao.deleteCollection(dao.findCollectionByNameOrId(name)); } catch (e) { /* ignore */ }
  });
});

