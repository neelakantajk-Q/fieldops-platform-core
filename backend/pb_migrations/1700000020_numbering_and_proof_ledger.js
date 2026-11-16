/// <reference path="../pb_data/types.d.ts" />
/**
 * Server-authoritative numbering + proof ledger (locked 2026-11-15, option A).
 *
 *   job      JC-{YY}-{ENG4}-{NNNN}          per engineer + IST year
 *   complaint CMP-{YY}-{REG3}-{HUB4}-{NNNN} per hub + IST year
 *   shift    SH-{YY}-{ENG4}-{NNNN}          per engineer + IST year
 *   capture  CAP-{YY}-{ENG4}-{NNNN}         per engineer + IST year
 *   expense  EXP-{YY}-{NNNN}                per company + IST year
 *
 * Adds:
 *   - complaints            customer-facing ticket, region/hub identifier
 *   - sequence_counters     atomic per-scope allocation (hooks use tx)
 *   - proof_files           modern proof ledger {ENG4}_{entity}_{kind}_{ts}_{6hex}
 *   - job_cards.complaint_id / complaint_no / code_version (legacy rows = 1)
 *   - regions/service_hubs/users .short_code (3/4/4, unique per company)
 *
 * Legacy job codes (JOB-â€¦ / J-â€¦) are NEVER rewritten; code_version=1.
 * New rows are allocated by pb_hooks/record_defaults.pb.js (code_version=2).
 */
migrate((db) => {
  const dao = new Dao(db);

  const ensureField = (colName, def) => {
    const col = dao.findCollectionByNameOrId(colName);
    let existing = null;
    try { existing = col.schema.getFieldByName(def.name); } catch (err) { existing = null; }
    if (!existing) col.schema.addField(new SchemaField(Object.assign({}, def, { unique: false })));
    /* Hook-assigned codes must NOT be required: PB validates BEFORE the
       before-create request hook fires, so a required hook-assigned field
       can never pass validation (catch-22). Mutating the existing field
       does not persist on 0.22 - remove and re-add instead. */
    else if (existing.required && def.required === false) {

      col.schema.removeField(existing.id);
      col.schema.addField(new SchemaField(Object.assign({}, def, { unique: false, id: existing.id })));
    }
    dao.saveCollection(col);
    return col;
  };

  /* ------------------------------------------------ complaints ------- */
  const complaints = new Collection({
    id: "complaints00000",
    name: "complaints",
    type: "base",
    system: false,
    // Read open (web console + Android expand); creates go through the
    // record_defaults hook which allocates CMP numbers server-side.
    // update/delete stay admin-only so ticket numbers and status stay clean.
    listRule: "", viewRule: "",
    createRule: "", updateRule: null, deleteRule: null
  });
  [
    { name: "complaint_no", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "company_id", type: "relation", required: true, options: { collectionId: "companies000000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "region_id", type: "relation", required: false, options: { collectionId: "regions00000000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "hub_id", type: "relation", required: false, options: { collectionId: "service_hubs000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "client_id", type: "relation", required: false, options: { collectionId: "clients00000000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "vehicle_id", type: "relation", required: false, options: { collectionId: "vehicles0000000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "plate_no", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "customer_name", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "customer_phone", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "description", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "status", type: "select", required: true, options: { maxSelect: 1, values: ["OPEN", "ASSIGNED", "JOB_CREATED", "CLOSED", "CANCELLED"] } },
    { name: "reported_at", type: "date", required: false, options: { min: "", max: "" } },
    { name: "reported_by", type: "relation", required: false, options: { collectionId: "users0000000000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "ist_date", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "code_version", type: "number", required: false, options: { min: null, max: null, noDecimal: true } },
    { name: "fiscal_year", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "client_request_id", type: "text", required: false, options: { min: null, max: null, pattern: "" } }
  ].forEach((f) => complaints.schema.addField(new SchemaField(Object.assign({}, f, { unique: false }))));
  complaints.indexes = [
    "CREATE UNIQUE INDEX idx_complaints_no ON complaints (complaint_no)",
    "CREATE INDEX idx_complaints_hub_date ON complaints (hub_id, ist_date)"
  ];
dao.saveCollection(complaints);

/* ------------------------------------------------ sequence_counters  */
  const seq = new Collection({
    id: "seq_counters000",
    name: "sequence_counters",
    type: "base",
    system: false,
    // Internal: written only by the record_defaults hook inside a write
    // transaction. Keep admin-only so numbers can never be tampered with.
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null
  });
  [
    { name: "key", type: "text", required: true, options: { min: null, max: null, pattern: "" } },
    { name: "value", type: "number", required: true, options: { min: null, max: null, noDecimal: true } },
    { name: "scope", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "ist_date", type: "text", required: false, options: { min: null, max: null, pattern: "" } }
  ].forEach((f) => seq.schema.addField(new SchemaField(Object.assign({}, f, { unique: false }))));
  seq.indexes = [
    "CREATE UNIQUE INDEX idx_seq_counter_key ON sequence_counters (key)"
  ];
  dao.saveCollection(seq);

  /* ------------------------------------------------ proof_files ------- */
  const proofs = new Collection({
    id: "proof_files0000",
    name: "proof_files",
    type: "base",
    system: false,
    // Internal ledger: rows are created by the record_defaults hook when a
    // proof upload is renamed to the modern canonical filename.
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null
  });
  [
    { name: "company_id", type: "relation", required: false, options: { collectionId: "companies000000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "collection_name", type: "text", required: true, options: { min: null, max: null, pattern: "" } },
    { name: "record_id", type: "text", required: true, options: { min: null, max: null, pattern: "" } },
    { name: "field_name", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "kind", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "filename", type: "text", required: true, options: { min: null, max: null, pattern: "" } },
    { name: "original_name", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "mime_type", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "bytes", type: "number", required: false, options: { min: null, max: null, noDecimal: true } },
    { name: "latitude", type: "number", required: false, options: { min: null, max: null, noDecimal: false } },
    { name: "longitude", type: "number", required: false, options: { min: null, max: null, noDecimal: false } },
    { name: "accuracy_m", type: "number", required: false, options: { min: null, max: null, noDecimal: false } },
    { name: "distance_from_hub_m", type: "number", required: false, options: { min: null, max: null, noDecimal: false } },
    { name: "zone", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "is_mock", type: "bool", required: false, options: {} },
    { name: "ist_date", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "captured_at", type: "date", required: false, options: { min: "", max: "" } },
    { name: "watermark_version", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "watermark_lines", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "metadata_json", type: "json", required: false, options: { maxSize: 2000000 } },
    { name: "visibility", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "sha256", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "job_code", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "complaint_no", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "region_code", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "hub_code", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "engineer_code", type: "text", required: false, options: { min: null, max: null, pattern: "" } },
    { name: "uploader_id", type: "relation", required: false, options: { collectionId: "users0000000000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } },
    { name: "archived_at", type: "date", required: false, options: { min: "", max: "" } },
    { name: "deleted_at", type: "date", required: false, options: { min: "", max: "" } }
  ].forEach((f) => proofs.schema.addField(new SchemaField(Object.assign({}, f, { unique: false }))));
  proofs.indexes = [
    "CREATE UNIQUE INDEX idx_proof_filename ON proof_files (filename)",
    "CREATE INDEX idx_proof_record ON proof_files (collection_name, record_id)"
  ];
  dao.saveCollection(proofs);

  /* ------------------------------------------------ existing columns -- */
  /* job_code is required:true in the init schema; the job hook assigns it
     server-side AFTER validation, so it must be non-required. */
  ensureField("job_cards", { name: "job_code", type: "text", required: false, options: { min: null, max: null, pattern: "" } });
  ensureField("job_cards", { name: "complaint_id", type: "relation", required: false, options: { collectionId: "complaints00000", cascadeDelete: false, minSelect: 0, maxSelect: 1 } });
  ensureField("job_cards", { name: "complaint_no", type: "text", required: false, options: { min: null, max: null, pattern: "" } });
  ensureField("job_cards", { name: "code_version", type: "number", required: false, options: { min: null, max: null, noDecimal: true } });
  const jobCol = dao.findCollectionByNameOrId("job_cards");
  jobCol.indexes = ["CREATE INDEX idx_job_cards_complaint_no ON job_cards (complaint_no)"];
  dao.saveCollection(jobCol);

  ensureField("regions", { name: "short_code", type: "text", required: false, options: { min: null, max: null, pattern: "" } });
  ensureField("service_hubs", { name: "short_code", type: "text", required: false, options: { min: null, max: null, pattern: "" } });
  ensureField("users", { name: "short_code", type: "text", required: false, options: { min: null, max: null, pattern: "" } });

  /* ------------------------------------------------ backfill ---------- */
  // Short codes: regions 3, hubs 4, users 4 â€” unique per company, immutable
  // after first use. Derived from existing *_code / name / username.
  const mkCode = (raw, len) => {
    let s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) s = "X";
    while (s.length < len) s += "X";
    return s.slice(0, len);
  };
  const uniqueShort = (colName, companyId, want) => {
    let code = want;
    for (let i = 0; i < 60; i++) {
      let clash = false;
      try {
        const rows = dao.findRecordsByFilter(colName, "short_code = {:s}", "", 500, 0, { s: code });
        for (let r = 0; r < rows.length; r++) {
          if (String(rows[r].get("company_id") || "") === String(companyId || "")) { clash = true; break; }
        }
      } catch (err) { clash = false; }
      if (!clash) return code;
      const suffix = String(i + 2);
      code = (want.slice(0, Math.max(1, want.length - suffix.length)) + suffix).slice(0, want.length);
    }
    return want;
  };

  // Raw row scanning: dbx needs a destination slice (arrayOf + DynamicModel).
  const rowIds = (table, where) => {
    const dest = arrayOf(new DynamicModel({ id: "" }));
    db.newQuery("SELECT [id] FROM [" + table + "] WHERE " + where).all(dest);
    return dest.map((row) => (typeof row.get === "function" ? row.get("id") : row.id));
  };

  // job_cards: legacy rows keep their code, flagged version 1.
  rowIds("job_cards", "[code_version] IS NULL OR [code_version] = 0").forEach((id) => {
    try {
      const rec = dao.findRecordById("job_cards", id);
      rec.set("code_version", 1);
      dao.saveRecord(rec);
    } catch (err) { /* skip broken row */ }
  });

  const backfillShort = (colName, len, pick) => {
    rowIds(colName, "[short_code] IS NULL OR [short_code] = ''").forEach((id) => {
      try {
        const rec = dao.findRecordById(colName, id);
        const want = mkCode(pick(rec), len);
        rec.set("short_code", uniqueShort(colName, rec.get("company_id"), want));
        dao.saveRecord(rec);
      } catch (err) { /* skip broken row */ }
    });
  };
  backfillShort("regions", 3, (rec) => rec.get("region_code") || rec.get("name"));
  backfillShort("service_hubs", 4, (rec) => rec.get("hub_code") || rec.get("name"));
  backfillShort("users", 4, (rec) => rec.get("user_code") || rec.get("username"));
}, (db) => {
  const dao = new Dao(db);
  ["proof_files", "sequence_counters", "complaints"].forEach((name) => {
    try { dao.deleteCollection(dao.findCollectionByNameOrId(name)); } catch (e) { /* ignore */ }
  });
  // Best-effort removal of the added columns on downgrade.
  [["job_cards", ["complaint_id", "complaint_no", "code_version"]],
   ["regions", ["short_code"]], ["service_hubs", ["short_code"]], ["users", ["short_code"]]]
    .forEach(([colName, fields]) => {
      try {
        const col = dao.findCollectionByNameOrId(colName);
        fields.forEach((f) => { try { col.schema.removeField(f); } catch (err) { /* absent */ } });
        dao.saveCollection(col);
      } catch (err) { /* ignore */ }
    });
});



