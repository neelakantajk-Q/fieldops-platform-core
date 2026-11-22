/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000050_autocheckout_dealer_visits.js
 *
 * Auto-checkout + shift metrics, job-card stop-proof extraction state, and the
 * dealer visit flow (dealer locations get coordinates; dealer visits and
 * dealer verification codes are new).
 *
 *   attendance  checkout_photo, auto_checkout, checkout_reason/source,
 *               photo_pending, breach_started_at, last_zone, shift/job metrics
 *   users       geofence_buffer_m, breach_grace_minutes, breach_started_at,
 *               breach_alerted_at, last_zone/lat/lng/geo_at/address
 *   job_cards   hold_to_stop_minutes, parts_extract_status/_at,
 *               parts_confirmed_at/by
 *   job_card_parts  confidence, needs_review
 *   dealer_locations latitude, longitude, radius_m, qr_token
 *   dealer_visits    manager visit ledger (photo + code + geofence)
 *   dealer_visit_codes  backend-issued single-use verification codes
 *
 * All helpers are inlined in the migrate callback (JSVM has no hoisting).
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
  const F = (name, maxSelect) => ({ name, type: "file", required: false, unique: false, options: { maxSelect: maxSelect || 1, maxSize: 10485760, mimeTypes: ["image/jpeg", "image/png"] } });
  const R = (name, collectionId, required) => ({ name, type: "relation", required: !!required, unique: false, options: { collectionId, cascadeDelete: false, minSelect: 0, maxSelect: 1 } });

  const ensureField = (colName, def) => {
    const col = dao.findCollectionByNameOrId(colName);
    let existing = null;
    try { existing = col.schema.getFieldByName(def.name); } catch (err) { existing = null; }
    if (!existing) {
      col.schema.addField(new SchemaField(Object.assign({}, def, { unique: false })));
      dao.saveCollection(col);
    }
    return col;
  };

  const newCollection = (id, name, schema, rules, indexes) => {
    const c = new Collection(Object.assign({
      id, name, type: "base", system: false,
      listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: ""
    }, rules || {}));
    for (let i = 0; i < schema.length; i++) {
      c.schema.addField(new SchemaField(Object.assign({}, schema[i], { unique: false })));
    }
    c.indexes = indexes || [];
    dao.saveCollection(c);
    return c;
  };

  /* ------------------------------------------------- attendance --------- */
  [
    F("checkout_photo"),
    B("auto_checkout"),
    S("checkout_reason", ["MANUAL", "AUTO_GEOFENCE", "AUTO_EOD", "AUTO_JOB_BREACH"]),
    S("checkout_source", ["APP", "BUBBLE", "WEB", "CRON"]),
    B("photo_pending"),
    D("photo_completed_at"),
    D("breach_started_at"),
    S("last_zone", ["INSIDE", "OUTSIDE", "UNKNOWN"]),
    N("shift_minutes"),
    N("job_minutes"),
    N("cards_closed"),
    N("cards_held"),
    N("hold_minutes"),
    T("last_address")
  ].forEach((f) => ensureField("attendance", f));

  /* ------------------------------------------------------ users --------- */
  [
    N("geofence_buffer_m"),
    N("breach_grace_minutes"),
    D("breach_started_at"),
    D("breach_alerted_at"),
    S("last_zone", ["INSIDE", "OUTSIDE", "UNKNOWN"]),
    N("last_lat"),
    N("last_lng"),
    D("last_geo_at"),
    T("last_address"),
    D("last_address_at")
  ].forEach((f) => ensureField("users", f));

  /* --------------------------------------------------- job_cards -------- */
  [
    N("hold_to_stop_minutes"),
    S("parts_extract_status", ["NONE", "PENDING", "DONE", "FAILED"]),
    D("parts_extract_at"),
    D("parts_confirmed_at"),
    R("parts_confirmed_by", "users0000000000")
  ].forEach((f) => ensureField("job_cards", f));

  /* ----------------------------------------------- job_card_parts ------ */
  [
    N("confidence"),
    B("needs_review")
  ].forEach((f) => ensureField("job_card_parts", f));

  /* ----------------------------------------------- job_card_holds ------ */
  [
    R("company_id", "companies000000"),
    T("ist_date")
  ].forEach((f) => ensureField("job_card_holds", f));

  /* --------------------------------------------- dealer_locations ------- */
  [
    N("latitude"),
    N("longitude"),
    N("radius_m"),
    T("qr_token")
  ].forEach((f) => ensureField("dealer_locations", f));

  /* ------------------------------------------------- dealer_visits ------ */
  newCollection("dealer_visits0", "dealer_visits", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    R("dealer_id", "dealers00000", true),
    R("dealer_location_id", "dealer_locs00"),
    R("manager_id", "users0000000000", true),
    R("visit_code_id", "dealer_visit_codes0"),
    S("visit_type", ["ROUTINE", "COMPLAINT", "AUDIT", "COLLECTION"], true),
    S("status", ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"], true),
    S("verification_mode", ["APP_CODE", "APP_QR", "WEB_CODE", "WEB_QR", "STATIC_QR", "MANUAL"], true),
    D("planned_at"), D("check_in_at"), D("check_out_at"),
    F("check_in_photo"), F("check_out_photo"),
    N("latitude"), N("longitude"), T("address"),
    N("distance_from_dealer_m"), T("notes"), T("outcome"), T("next_action"),
    T("ist_date"), N("duration_minutes"), T("client_request_id"), T("fiscal_year"),
    T("visit_no"), B("outside_geofence"), B("pending_approval"),
    T("code"), T("qr_token")
  ], null, [
    "CREATE INDEX idx_dealer_visits_manager_date ON dealer_visits (manager_id, ist_date)",
    "CREATE INDEX idx_dealer_visits_dealer_date ON dealer_visits (dealer_id, ist_date)"
  ]);

  /* -------------------------------------------- dealer_visit_codes ----- */
  newCollection("dealer_visit_codes0", "dealer_visit_codes", [
    R("company_id", "companies000000", true),
    R("dealer_id", "dealers00000", true),
    R("dealer_location_id", "dealer_locs00"),
    T("code", true),
    T("qr_payload"),
    R("issued_for", "users0000000000"),
    D("expires_at", true),
    D("used_at"),
    R("used_by_manager", "users0000000000"),
    R("visit_id", "dealer_visits0"),
    S("status", ["ACTIVE", "USED", "EXPIRED", "REVOKED"], true),
    T("ist_date"), T("client_request_id")
  ], null, [
    "CREATE INDEX idx_dvc_code_status ON dealer_visit_codes (code, status)",
    "CREATE INDEX idx_dvc_dealer_status ON dealer_visit_codes (dealer_id, status)"
  ]);

  /* ------------------------------------------------ settings seeds ------ */
  const settingsCol = dao.findCollectionByNameOrId("settings");
  const defaults = [
    ["attendance.breach_grace_minutes", "15"],
    ["attendance.breach_buffer_m", "100"],
    ["attendance.active_job_action_minutes", "15"],
    ["attendance.siren_interval_minutes", "5"],
    ["attendance.eod_time", "23:55"],
    ["attendance.shift_start", "09:00"],
    ["attendance.shift_end", "18:00"],
    ["attendance.checkout_photo_required", "1"],
    ["dealer.visit_radius_m", "100"],
    ["dealer.code_ttl_minutes", "10"]
  ];

  let companies = [];
  try {
    companies = dao.findRecordsByFilter("companies", "id != ''", "", 100, 0) || [];
  } catch (err) { companies = []; }
  if (!companies.length) companies = [{ id: "" }];

  for (let ci = 0; ci < companies.length; ci++) {
    const companyId = companies[ci].id;
    for (let si = 0; si < defaults.length; si++) {
      const key = defaults[si][0];
      const value = defaults[si][1];
      let exists = false;
      try {
        const rows = dao.findRecordsByFilter(
          "settings", "company_id = {:c} && key = {:k}", "", 1, 0,
          { c: String(companyId || ""), k: key }
        ) || [];
        exists = rows.length > 0;
      } catch (err) { exists = false; }
      if (exists) continue;
      try {
        const rec = new Record(settingsCol);
        rec.set("company_id", String(companyId || ""));
        rec.set("key", key);
        rec.set("value", value);
        dao.saveRecord(rec);
      } catch (err) { /* best effort */ }
    }
  }
}, (db) => {
  const dao = new Dao(db);
  ["dealer_visit_codes", "dealer_visits"].forEach((name) => {
    try { dao.deleteCollection(dao.findCollectionByNameOrId(name)); } catch (e) { /* ignore */ }
  });
  [
    ["attendance", ["checkout_photo", "auto_checkout", "checkout_reason", "checkout_source",
      "photo_pending", "photo_completed_at", "breach_started_at", "last_zone",
      "shift_minutes", "job_minutes", "cards_closed", "cards_held", "hold_minutes", "last_address"]],
    ["users", ["geofence_buffer_m", "breach_grace_minutes", "breach_started_at",
      "breach_alerted_at", "last_zone", "last_lat", "last_lng", "last_geo_at",
      "last_address", "last_address_at"]],
    ["job_cards", ["hold_to_stop_minutes", "parts_extract_status", "parts_extract_at",
      "parts_confirmed_at", "parts_confirmed_by"]],
    ["job_card_parts", ["confidence", "needs_review"]],
    ["job_card_holds", ["company_id", "ist_date"]],
    ["dealer_locations", ["latitude", "longitude", "radius_m", "qr_token"]]
  ].forEach(([colName, fields]) => {
    try {
      const col = dao.findCollectionByNameOrId(colName);
      fields.forEach((f) => { try { col.schema.removeField(f); } catch (err) { /* absent */ } });
      dao.saveCollection(col);
    } catch (err) { /* ignore */ }
  });
  try {
    const rows = dao.findRecordsByFilter("settings", "key LIKE 'attendance.%' || key LIKE 'dealer.%'", "", 500, 0) || [];
    for (const r of rows) dao.deleteRecord(r);
  } catch (err) { /* ignore */ }
});
