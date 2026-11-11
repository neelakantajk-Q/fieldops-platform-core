/// <reference path="../pb_data/types.d.ts" />
/**
 * Day-scoped transit (roaming) approval requests.
 *
 * A technician outside the hub radius posts a request (bubble / app / web),
 * a Supervisor+ approves from the Android notification actions or the web
 * console. APPROVED = day pass: the geofence_check hook then accepts the
 * user's punches outside the radius for that IST day (Verified_Roaming).
 */
migrate((db) => {
  const dao = new Dao(db);
  const c = new Collection({
    id: "roaming_requests0",
    name: "roaming_requests",
    type: "base",
    system: false,
    // Public read (web console + app poll via custom routes); writes happen
    // server-side through /api/fieldops/roaming-* routes with role checks,
    // so direct API writes stay admin-only.
    listRule: "", viewRule: "",
    createRule: null, updateRule: null, deleteRule: null
  });
  [
    { name: "company_id", type: "relation", required: true, options: { collectionId: "companies000000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "user_id", type: "relation", required: true, options: { collectionId: "users0000000000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "hub_id", type: "relation", required: false, options: { collectionId: "service_hubs000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "request_type", type: "select", required: true, options: { maxSelect: 1, values: ["PUNCH_IN", "PUNCH_OUT", "JOB_START", "TRANSIT"] } },
    { name: "ist_date", type: "text", required: true, options: { min: null, max: null, pattern: "" } },
    { name: "status", type: "select", required: true, options: { maxSelect: 1, values: ["PENDING", "APPROVED", "REJECTED"] } },
    { name: "latitude", type: "number", required: false, options: { min: null, max: null, noDecimal: false } },
    { name: "longitude", type: "number", required: false, options: { min: null, max: null, noDecimal: false } },
    { name: "distance_from_hub_meters", type: "number", required: false, options: { min: null, max: null, noDecimal: false } },
    { name: "accuracy_meters", type: "number", required: false, options: { min: null, max: null, noDecimal: false } },
    { name: "notes", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "requested_at", type: "date", required: false, options: { min: "", max: "" } },
    { name: "approved_by", type: "relation", required: false, options: { collectionId: "users0000000000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "approved_at", type: "date", required: false, options: { min: "", max: "" } },
    { name: "approver_name", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "client_request_id", type: "text", required: false, options: { min: null, max: null, pattern: "" } }
  ].forEach((f) => c.schema.addField(new SchemaField(Object.assign({}, f, { unique: false }))));
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId("roaming_requests0")); } catch (e) { /* ignore */ }
});
