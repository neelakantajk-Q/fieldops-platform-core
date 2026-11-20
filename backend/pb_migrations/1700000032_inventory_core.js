/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000032_inventory_core.js
 * Inventory core collections for the parts/stock flow:
 *   inventory_stock, stock_ledger, replenishment_requests, notifications,
 *   part_usage_daily
 *
 * Also extends parts_master with lead_time / MOQ / pack / safety fields used
 * by forecasting and reorder suggestions.
 *
 * Write rules are locked (server routes only); reads stay open for the console.
 */
migrate((db) => {
  const dao = new Dao(db);

  const companyId = (() => {
    try {
      const col = dao.findCollectionByNameOrId("companies");
      const rows = dao.findRecordsByFilter(col, "name = {:n}", "", 1, 0, { n: "QEL Service Hub" }) || [];
      return rows.length ? rows[0].get("id") : null;
    } catch (err) { return null; }
  })();

  const ensureCollection = (id, name, schema, rules) => {
    let col;
    try { col = dao.findCollectionByNameOrId(name); } catch (err) { col = null; }
    if (!col) {
      col = new Collection({ id, name, type: "base", system: false });
      for (let i = 0; i < schema.length; i++) {
        col.schema.addField(new SchemaField(Object.assign({}, schema[i], { unique: false })));
      }
      Object.assign(col, rules || { listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "" });
      try { dao.saveCollection(col); } catch (err) { /* may already exist */ }
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
  ], companyId ? DEMO_OPEN : LOCKED_WRITE);

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
  ], companyId ? DEMO_OPEN : LOCKED_WRITE);

  /* ---------------- replenishment_requests ---------------- */
  ensureCollection("replenishment_req", "replenishment_requests", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    T("part_code", true),
    N("current_qty"),
    N("on_order"),
    N("reorder_point"),
    N("suggested_qty"),
    S("priority", ["CRITICAL", "HIGH", "NORMAL"], true),
    S("status", ["OPEN", "ACK", "APPROVED", "ORDERED", "RECEIVED", "CANCELLED"], true),
    R("assigned_to", "users0000000000"),
    T("source"),
    D("raised_at"),
    D("due_at"),
    D("resolved_at"),
    T("notes"),
    T("last_notified_at"),
  ], companyId ? DEMO_OPEN : LOCKED_WRITE);

  /* ---------------- notifications ---------------- */
  ensureCollection("notifications000", "notifications", [
    R("company_id", "companies000000", true),
    R("user_id", "users0000000000"),
    T("type", true),
    T("title", true),
    T("body"),
    T("ref_collection"),
    T("ref_id"),
    S("priority", ["LOW", "NORMAL", "HIGH"], false),
    S("status", ["UNREAD", "READ", "ACTED"], true),
    D("ist_date"),
    D("created"),
  ], companyId ? DEMO_OPEN : LOCKED_WRITE);

  /* ---------------- part_usage_daily rollup ---------------- */
  ensureCollection("part_usage_daily", "part_usage_daily", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    D("ist_date", true),
    T("part_code", true),
    T("model"),
    B("historical"),
    N("qty"),
    N("jobs"),
    N("vehicles"),
  ], companyId ? DEMO_OPEN : LOCKED_WRITE);

  /* ---------------- extend parts_master with inventory fields ---------------- */
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

  const pm = companyId ? null : null; // parts_master exists from migration 30
  try {
    const pmCol = dao.findCollectionByNameOrId("parts_master");
    for (const def of [
      N("lead_time_days", false),
      N("moq", false),
      N("pack_size", false),
      N("safety_days", false)
    ]) {
      ensureField("parts_master", Object.assign({}, def, { name: def.name }));
    }
  } catch (err) { /* parts_master may not exist yet */ }

}, (db) => {
  // Inventory core: no downgrade.
});
