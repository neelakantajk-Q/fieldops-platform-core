/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000101_billing.js
 * Per-job customer invoicing:
 *   invoices       — header + totals (parts + labour + consumables, GST)
 *   invoice_lines  — frozen line snapshot (part price/tax from parts_master)
 *
 * Lifecycle: DRAFT -> ISSUED -> PAID, with CANCELLED from DRAFT/ISSUED.
 * Issuing marks the job's job_card_parts as BILLED; cancelling reverts them
 * to UNBILLED so the job can be re-invoiced.
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
        col.schema.addField(new SchemaField(Object.assign({}, schema[i])));
      }
    } else {
      for (let i = 0; i < schema.length; i++) {
        let exists = null;
        try { exists = col.schema.getFieldByName(schema[i].name); } catch (err) { exists = null; }
        if (!exists) col.schema.addField(new SchemaField(Object.assign({}, schema[i])));
      }
    }
    Object.assign(col, rules || { listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null });
    dao.saveCollection(col);
    return col;
  };

  const T = (name, required, extra) => Object.assign({ name, type: "text", required: !!required, unique: false, options: { min: null, max: null, pattern: "" } }, extra || {});
  const N = (name, required, extra) => Object.assign({ name, type: "number", required: !!required, unique: false, options: { min: null, max: null, noDecimal: false } }, extra || {});
  const D = (name) => ({ name, type: "date", required: false, unique: false, options: { min: "", max: "" } });
  const S = (name, values, required) => ({ name, type: "select", required: !!required, unique: false, options: { maxSelect: 1, values } });
  const R = (name, collectionId, required) => ({ name, type: "relation", required: !!required, unique: false, options: { collectionId, cascadeDelete: false, minSelect: 0, maxSelect: 1 } });

  const LOCKED_WRITE = { listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null };

  /* ---------------- invoices ---------------- */
  ensureCollection("invoices0000000", "invoices", [
    R("company_id", "companies000000", true),
    R("hub_id", "service_hubs000"),
    R("job_card_id", "job_cards000000", true),
    R("client_id", "clients00000000"),
    R("vehicle_id", "vehicles0000000"),
    T("invoice_no", true, { unique: true }),
    S("status", ["DRAFT", "ISSUED", "PAID", "CANCELLED"], true),
    T("customer_name"),
    T("customer_gstin"),
    T("customer_address"),
    T("plate"),
    T("currency"),
    N("labour_amount"),
    N("labour_tax_rate"),
    N("consumables_amount"),
    N("consumables_tax_rate"),
    N("parts_subtotal"),
    N("parts_tax"),
    N("labour_subtotal"),
    N("labour_tax"),
    N("consumables_subtotal"),
    N("consumables_tax"),
    N("subtotal"),
    N("tax_total"),
    N("round_off"),
    N("total"),
    N("line_count"),
    N("revision"),
    D("due_date"),
    D("issued_at"),
    D("paid_at"),
    D("cancelled_at"),
    T("payment_ref"),
    T("notes"),
    T("source"),
    R("created_by", "users0000000000")
  ], LOCKED_WRITE);

  /* ---------------- invoice_lines ---------------- */
  ensureCollection("invoice_lines00", "invoice_lines", [
    R("company_id", "companies000000", true),
    R("invoice_id", "invoices0000000", true),
    R("job_card_id", "job_cards000000"),
    R("job_card_part_id", "job_card_parts0"),
    S("kind", ["PART", "LABOUR", "CONSUMABLES", "OTHER"], true),
    T("part_code"),
    T("description"),
    T("hsn_code"),
    N("qty"),
    N("unit_price"),
    N("tax_rate"),
    N("line_subtotal"),
    N("line_tax"),
    N("line_total"),
    N("sort_order")
  ], LOCKED_WRITE);

}, (db) => {
  // Billing: no downgrade.
});
