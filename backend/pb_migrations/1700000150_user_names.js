/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000150_user_names.js
 * Adds first_name / last_name to users so the complaint number can embed the
 * technician initials (J26ML0001). Additive and idempotent.
 *
 * PB 0.22 JSVM: keep every helper inside the migrate callback.
 */
migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("users");

  const ensure = (name) => {
    try {
      if (c.schema.getFieldByName(name)) return false;
    } catch (err) { /* missing */ }
    c.schema.addField(new SchemaField({
      name: name, type: "text", required: false, unique: false,
      options: { min: null, max: null, pattern: "" }
    }));
    return true;
  };

  const addedFirst = ensure("first_name");
  const addedLast = ensure("last_name");
  if (addedFirst || addedLast) dao.saveCollection(c);

  // Best-effort backfill: only split usernames that clearly contain two tokens
  // (e.g. "manoj.lal" -> Manoj / Lal). Single-token logins stay blank so the
  // numbering hook falls back to short_code/user_code initials.
  const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1).toLowerCase();
  let rows = [];
  try { rows = dao.findRecordsByFilter("users", "id != ''", "", 500, 0) || []; } catch (err) { rows = []; }
  for (const r of rows) {
    if (String(r.get("first_name") || "").trim() || String(r.get("last_name") || "").trim()) continue;
    const un = String(r.get("username") || "").trim();
    const parts = un.split(/[._\-\s]+/).filter(Boolean);
    if (parts.length < 2) continue;
    r.set("first_name", cap(parts[0]));
    r.set("last_name", cap(parts[parts.length - 1]));
    try { dao.saveRecord(r); } catch (err) { /* keep going */ }
  }
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("users");
  try {
    const a = c.schema.getFieldByName("first_name");
    if (a) c.schema.removeField(a.id);
  } catch (err) { /* already gone */ }
  try {
    const b = c.schema.getFieldByName("last_name");
    if (b) c.schema.removeField(b.id);
  } catch (err) { /* already gone */ }
  dao.saveCollection(c);
});
