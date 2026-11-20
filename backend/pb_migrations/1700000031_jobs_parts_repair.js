/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000031_jobs_parts_repair.js
 * Creates the structured job-parts and inventory collections required for Phase A
 * (legacy CSV import, bulk parts correction, stock sheet and replenishment).
 *
 * Collections:
 *   job_card_parts, inventory_stock, stock_ledger, part_issues,
 *   import_batches, legacy_import_rows
 *
 * Write rules are locked (admin-only) so that all mutations go through the
 * server-side routes which enforce validation + audit. Reads stay open for the
 * console; lock them down before production (see WARNING in init migration).
 */
migrate((db) => {
  const dao = new Dao(db);

  let company = null;
  try {
    const col = dao.findCollectionByNameOrId("companies");
    const rows = dao.findRecordsByFilter(col, "name = {:n}", "", 1, 0, { n: "QEL Service Hub" });
    company = (rows && rows.length) ? rows[0].get("id") : null;
  } catch (err) { company = null; }

  const ensureCollection = (id, name, schema, rules) => {
    let col;
    try { col = dao.findCollectionByNameOrId(name); } catch (err) { col = null; }
    if (!col) {
      col = new Collection({ id, name, type: "base", system: false });
      for (let i = 0; i < schema.length; i++) {
        col.schema.addField(new SchemaField(Object.assign({}, schema[i], { unique: false })));
      }
      Object.assign(col, rules || {
        listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: ""
      });
      try { dao.saveCollection(col); } catch (err) { /* collection may already exist */ }
    }
    return col;
  };

  const T = (name, required, extra) => Object.assign({ name, type: "text", required: !!required, unique: false, options: { min: null, max: null, pattern: "" } }, extra || {});
  const N = (name, required, extra) => Object.assign({ name, type: "number", required: !!required, unique: false, options: { min: null, max: null, noDecimal: false } }, extra || {});
  const B = (name) => ({ name, type: "bool", required: false, unique: false, options: {} });
  const J = (name) => ({ name, type: "json", required: false, unique: false, options: { maxSize: 2000000 } });
  const D = (name) => ({ name, type: "date", required: false, unique: false, options: { min: "", max: "" } });
  const S = (name, values, required) => ({ name, type: "select", required: !!required, unique: false, options: { maxSelect: 1, values } });
  const R = (name, collectionId, required) => ({ name, type: "relation", required: !!required, unique: false, options: { collectionId, cascadeDelete: false, minSelect: 0, maxSelect: 1 } });

  const DEMO_OPEN = { listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "" };
  const LOCKED_WRITE = { listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null };

  /* ---------------- job_card_parts ---------------- */
  ensureCollection("job_card_parts0", "job_card_parts", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    R("job_card_id", "job_cards000000", true),
    T("part_code", true),
    N("qty", true),
    S("status", ["UNBILLED", "BILLED", "LOCKED"], true),
    B("locked"),
    T("source"),
    T("import_row_id"),
    B("resolved"),
    N("revision"),
    R("corrected_by", "users0000000000"),
    D("corrected_at"),
    T("import_batch_id"),
    T("model"),
  ], company ? DEMO_OPEN : LOCKED_WRITE);

  /* ---------------- inventory_stock ---------------- */
  ensureCollection("inventory_stock0", "inventory_stock", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    T("part_code", true),
    N("on_hand"),
    N("on_order"),
    N("reserved"),
    N("reorder_point"),
    N("safety_stock"),
    N("lead_time_days"),
    N("moq"),
    N("pack_size"),
    D("last_counted_at"),
    N("revision"),
    B("active"),
  ], company ? DEMO_OPEN : LOCKED_WRITE);

  /* ---------------- stock_ledger ---------------- */
  ensureCollection("stock_ledger00", "stock_ledger", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    T("part_code", true),
    D("ist_date"),
    T("movement_type", true),
    N("qty_delta", true),
    N("qty_after", true),
    T("reason"),
    T("note"),
    T("ref_collection"),
    T("ref_id"),
    R("actor_id", "users0000000000"),
    T("client_request_id"),
    D("created"),
  ], company ? DEMO_OPEN : LOCKED_WRITE);

  /* ---------------- part_issues ---------------- */
  ensureCollection("part_issues000", "part_issues", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    R("job_card_id", "job_cards000000"),
    T("part_code", true),
    N("qty", true),
    S("status", ["UNBILLED", "BILLED"], true),
    D("issued_at"),
    R("actor_id", "users0000000000"),
  ], company ? DEMO_OPEN : LOCKED_WRITE);

  /* ---------------- import_batches ---------------- */
  ensureCollection("import_batches00", "import_batches", [
    R("company_id", "companies000000", true),
    T("kind", true),
    T("file_name"),
    T("sha256"),
    R("uploaded_by", "users0000000000"),
    J("filters"),
    B("dry_run"),
    N("row_count"),
    N("accepted"),
    N("rejected"),
    S("status", ["VALIDATED", "APPLIED", "PARTIAL", "FAILED"], true),
    D("created"),
  ], company ? DEMO_OPEN : LOCKED_WRITE);

  /* ---------------- legacy_import_rows ---------------- */
  ensureCollection("legacy_import_rows", "legacy_import_rows", [
    T("batch_id", true),
    N("line_no"),
    T("line_uid"),
    T("status"),
    T("error_code"),
    T("message"),
    J("payload_json"),
  ], company ? DEMO_OPEN : LOCKED_WRITE);

}, (db) => {
  // Jobs/parts/inventory: no downgrade.
});
