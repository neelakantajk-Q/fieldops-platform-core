/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000120_repair_job_cards.js
 *
 * Hub repair job cards (QEL RPR sheet) on top of the existing job_cards flow:
 *
 *   job_cards           job_type + odometer + repair/intake snapshot fields
 *   repair_inspections  inspection sheet (observations, tests, FQC/CDC, photos)
 *   part_dockets        spare-part docket chain (TH/TD/TS/TP/STD/IC/AR/BR)
 *
 * Existing collections are extended in place; the two new collections are
 * demo-open (like job_cards) so the console can read/write them directly.
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
  const J = (name) => ({ name, type: "json", required: false, unique: false, options: { maxSize: 2000000 } });
  const D = (name, required) => ({ name, type: "date", required: !!required, unique: false, options: { min: "", max: "" } });
  const S = (name, values, required) => ({ name, type: "select", required: !!required, unique: false, options: { maxSelect: 1, values } });
  const F = (name, maxSelect) => ({ name, type: "file", required: false, unique: false, options: { maxSelect: maxSelect || 1, maxSize: 10485760, mimeTypes: ["image/jpeg", "image/png"] } });
  const R = (name, collectionId, required) => ({ name, type: "relation", required: !!required, unique: false, options: { collectionId, cascadeDelete: false, minSelect: 0, maxSelect: 1 } });

  const DEMO_OPEN = { listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "" };

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

  const ensureCollection = (id, name, schema, rules, indexes) => {
    let col = null;
    try { col = dao.findCollectionByNameOrId(name); } catch (err) { col = null; }
    if (!col) {
      col = new Collection(Object.assign({ id, name, type: "base", system: false }, DEMO_OPEN));
      for (let i = 0; i < schema.length; i++) {
        col.schema.addField(new SchemaField(Object.assign({}, schema[i], { unique: false })));
      }
      Object.assign(col, rules || DEMO_OPEN);
      col.indexes = indexes || [];
      dao.saveCollection(col);
    }
    return col;
  };

  /* ------------------------------------------------- job_cards ---------- */
  [
    S("job_type", ["FIELD_SERVICE", "HUB_REPAIR"]),
    N("start_odometer"),
    N("end_odometer"),
    T("odometer_unit"),

    T("vin"),
    T("vehicle_model"),
    T("customer_voice"),

    T("part_code"),
    T("part_name"),
    T("part_serial"),
    T("part_supplier"),
    T("part_spec"),
    T("warranty_status"),

    D("repair_received_at"),
    D("repair_completed_at"),
    N("repair_tat_minutes"),
    T("repair_type")
  ].forEach((f) => ensureField("job_cards", f));

  /* ----------------------------------------- repair_inspections --------- */
  ensureCollection("repair_inspect0", "repair_inspections", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    R("job_card_id", "job_cards000000", true),
    R("vehicle_id", "vehicles0000000"),
    R("inspected_by", "users0000000000"),
    T("inspection_no"),
    D("inspected_at"),

    T("observation_1"), T("observation_2"), T("observation_3"), T("observation_4"),
    T("observation_5"), T("observation_6"), T("observation_7"), T("observation_8"),
    J("observations"),

    T("ocv"),
    T("defect"),
    T("root_cause"),
    T("action_taken"),
    T("parts_replaced"),

    T("leak_test"),
    T("functional_test"),
    T("firmware_update"),
    T("fqc_status"),
    T("cdc_status"),
    T("final_approval"),
    T("mt_status"),

    F("defect_images", 8),
    F("action_images", 8),
    F("final_part_images", 8),

    S("status", ["DRAFT", "SUBMITTED", "APPROVED"]),
    T("notes"),
    T("client_request_id"),
    T("ist_date"),
    T("fiscal_year")
  ], DEMO_OPEN, [
    "CREATE INDEX idx_repair_inspections_job ON repair_inspections (job_card_id)",
    "CREATE INDEX idx_repair_inspections_hub_date ON repair_inspections (hub_id, ist_date)"
  ]);

  /* --------------------------------------------- part_dockets ----------- */
  ensureCollection("part_dockets000", "part_dockets", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    R("job_card_id", "job_cards000000"),
    R("repair_inspection_id", "repair_inspect0"),
    R("issued_by", "users0000000000"),

    T("docket_no", true),
    S("docket_type", ["TH", "TD", "TS", "TP", "STD", "IC", "AR", "BR"], true),
    D("docket_date"),

    T("part_code"),
    T("part_name"),
    T("part_serial"),
    T("part_spec"),
    N("qty"),
    T("supplier"),

    T("from_hub"),
    T("to_hub"),
    T("tracking_no"),
    D("received_at"),
    D("issued_at"),
    D("returned_at"),

    S("status", ["OPEN", "IN_TRANSIT", "RECEIVED", "ISSUED", "RETURNED", "CLOSED"]),
    N("unit_cost"),
    T("notes"),
    T("client_request_id"),
    T("ist_date"),
    T("fiscal_year")
  ], DEMO_OPEN, [
    "CREATE INDEX idx_part_dockets_no ON part_dockets (docket_no)",
    "CREATE INDEX idx_part_dockets_job ON part_dockets (job_card_id)",
    "CREATE INDEX idx_part_dockets_type_date ON part_dockets (docket_type, docket_date)"
  ]);

  /* ------------------------------------------------ backfill job_type --- */
  let jobs = [];
  try {
    jobs = dao.findRecordsByFilter("job_cards", "id != ''", "", 5000, 0) || [];
  } catch (err) { jobs = []; }

  for (let i = 0; i < jobs.length; i++) {
    const rec = jobs[i];
    let dirty = false;
    if (!String(rec.get("job_type") || "")) {
      rec.set("job_type", "FIELD_SERVICE");
      dirty = true;
    }
    if (!rec.get("start_odometer")) {
      const notes = String(rec.get("service_notes") || "");
      const m = /odometer[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i.exec(notes);
      if (m) {
        rec.set("start_odometer", Number(m[1]));
        rec.set("odometer_unit", "km");
        dirty = true;
      }
    }
    if (dirty) {
      try { dao.saveRecord(rec); } catch (err) { /* keep going */ }
    }
  }
}, (db) => {
  const dao = new Dao(db);
  ["part_dockets", "repair_inspections"].forEach((name) => {
    try { dao.deleteCollection(dao.findCollectionByNameOrId(name)); } catch (err) { /* ignore */ }
  });
  try {
    const col = dao.findCollectionByNameOrId("job_cards");
    [
      "job_type", "start_odometer", "end_odometer", "odometer_unit", "vin",
      "vehicle_model", "customer_voice", "part_code", "part_name", "part_serial",
      "part_supplier", "part_spec", "warranty_status", "repair_received_at",
      "repair_completed_at", "repair_tat_minutes", "repair_type"
    ].forEach((f) => { try { col.schema.removeField(f); } catch (err) { /* absent */ } });
    dao.saveCollection(col);
  } catch (err) { /* ignore */ }
});
