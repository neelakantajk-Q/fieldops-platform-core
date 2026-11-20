/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000100_capa_repair_custody.js
 *
 * Adds the three operational flows that sit on top of job cards:
 *
 *   capa_records          extended 5-stage CAPA workflow
 *   repair_orders         repair pipeline for an asset (vehicle)
 *   asset_custody_events  chain of custody (issue / handover / return / gate pass / release)
 *
 * Write access for the two new collections is locked at the API layer; every
 * mutation goes through the server routes in pb_hooks/api_asset_flow.pb.js and
 * pb_hooks/api_capa.pb.js which enforce company / hub scope and audit.
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
  const D = (name, required) => ({ name, type: "date", required: !!required, unique: false, options: { min: "", max: "" } });
  const S = (name, values, required) => ({ name, type: "select", required: !!required, unique: false, options: { maxSelect: 1, values } });
  const R = (name, collectionId, required) => ({ name, type: "relation", required: !!required, unique: false, options: { collectionId, cascadeDelete: false, minSelect: 0, maxSelect: 1 } });
  const F = (name) => ({ name, type: "file", required: false, unique: false, options: { maxSelect: 1, maxSize: 10485760, mimeTypes: ["image/jpeg", "image/png"] } });

  const READ_ONLY_WRITES = { listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null };

  const ensureCollection = (id, name, schema, rules) => {
    let col;
    try { col = dao.findCollectionByNameOrId(name); } catch (err) { col = null; }
    if (!col) {
      col = new Collection({ id, name, type: "base", system: false });
      for (let i = 0; i < schema.length; i++) {
        col.schema.addField(new SchemaField(Object.assign({}, schema[i], { unique: schema[i].unique || false })));
      }
      Object.assign(col, rules || READ_ONLY_WRITES);
      try { dao.saveCollection(col); } catch (err) { /* collection may already exist */ }
    }
    return col;
  };

  /* ---------------- extend capa_records to 5 stages ---------------- */
  const capa = dao.findCollectionByNameOrId("capa_records");
  const addCapaField = (field) => {
    let exists = false;
    try { exists = !!capa.schema.getFieldByName(field.name); } catch (err) { exists = false; }
    if (!exists) capa.schema.addField(new SchemaField(field));
  };

  addCapaField(R("company_id", "companies000000"));
  addCapaField(R("hub_id", "service_hubs000"));
  addCapaField(R("vehicle_id", "vehicles0000000"));
  addCapaField(R("technician_id", "users0000000000"));
  addCapaField(R("hold_id", "job_card_holds0"));
  addCapaField(T("capa_no"));
  addCapaField(S("severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]));
  addCapaField(S("root_cause_category", ["MAN_POWER", "MACHINE", "MATERIAL", "METHOD", "MEASUREMENT", "ENVIRONMENT", "PROCESS", "OTHER"]));
  addCapaField(T("containment_action"));
  addCapaField(D("due_date"));
  addCapaField(D("verified_at"));
  addCapaField(T("effectiveness_notes"));
  addCapaField(D("opened_at"));
  addCapaField(D("closed_at"));
  addCapaField(T("notes"));

  const capaStatus = capa.schema.getFieldByName("status");
  if (capaStatus && capaStatus.options) {
    capaStatus.options.values = ["OPEN", "INVESTIGATING", "ACTION_PLANNED", "VERIFIED", "RESOLVED", "CLOSED"];
  }
  dao.saveCollection(capa);

  /* ---------------- repair_orders ---------------- */
  ensureCollection("repair_orders00", "repair_orders", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    R("vehicle_id", "vehicles0000000"),
    R("job_card_id", "job_cards000000"),
    R("technician_id", "users0000000000"),
    T("repair_no", true, { unique: true }),
    S("stage", ["INTAKE", "DIAGNOSIS", "APPROVAL", "IN_REPAIR", "QA", "RELEASED", "CANCELLED"], true),
    S("priority", ["LOW", "NORMAL", "HIGH", "CRITICAL"]),
    T("reported_fault"),
    T("diagnosis"),
    T("work_done"),
    T("vendor"),
    N("estimated_cost"),
    N("actual_cost"),
    D("promised_at"),
    D("started_at"),
    D("completed_at"),
    D("released_at"),
    T("notes"),
    T("client_request_id"),
    T("fiscal_year")
  ]);

  /* ---------------- asset_custody_events ---------------- */
  ensureCollection("asset_custody00", "asset_custody_events", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    R("vehicle_id", "vehicles0000000", true),
    R("job_card_id", "job_cards000000"),
    R("repair_order_id", "repair_orders00"),
    S("custody_type", ["ISSUE", "HANDOVER", "RETURN", "GATE_PASS", "RELEASE"], true),
    R("from_user_id", "users0000000000"),
    R("to_user_id", "users0000000000"),
    R("from_hub_id", "service_hubs000"),
    R("to_hub_id", "service_hubs000"),
    N("odometer"),
    N("fuel_level"),
    T("condition_notes"),
    F("photo"),
    T("signature"),
    D("occurred_at", true),
    S("status", ["OPEN", "ACKNOWLEDGED", "DISPUTED", "CLOSED"]),
    T("client_request_id"),
    T("notes"),
    T("fiscal_year")
  ]);
}, (db) => {
  const dao = new Dao(db);
  ["asset_custody_events", "repair_orders"].forEach((name) => {
    try { dao.deleteCollection(dao.findCollectionByNameOrId(name)); } catch (err) { /* already gone */ }
  });

  const capa = dao.findCollectionByNameOrId("capa_records");
  [
    "company_id", "hub_id", "vehicle_id", "technician_id", "hold_id", "capa_no",
    "severity", "root_cause_category", "containment_action", "due_date",
    "verified_at", "effectiveness_notes", "opened_at", "closed_at", "notes"
  ].forEach((name) => {
    try {
      const f = capa.schema.getFieldByName(name);
      if (f) capa.schema.removeField(f.id);
    } catch (err) { /* already gone */ }
  });
  const capaStatus = capa.schema.getFieldByName("status");
  if (capaStatus && capaStatus.options) {
    capaStatus.options.values = ["OPEN", "RESOLVED", "CLOSED"];
  }
  dao.saveCollection(capa);
});
