/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000140_backfill_zones.js
 * Safety net for installations where 1700000130 added regions.zone but the
 * backfill ran with an empty filter (which returns no rows on PB 0.22), leaving
 * every zone blank. Idempotent: only fills regions whose zone is still empty.
 *
 * PB 0.22 JSVM: keep every helper inside the migrate callback.
 */
migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("regions");

  try {
    if (!c.schema.getFieldByName("zone")) {
      c.schema.addField(new SchemaField({
        name: "zone", type: "text", required: false, unique: false,
        options: { min: null, max: null, pattern: "" }
      }));
      dao.saveCollection(c);
    }
  } catch (err) { /* field already present */ }

  const derive = (name) => {
    const prefix = String(name || "").trim().split(/[._\-\s]/)[0];
    return prefix || "General";
  };

  let rows = [];
  try {
    rows = dao.findRecordsByFilter("regions", "id != ''", "", 500, 0) || [];
  } catch (err) {
    rows = [];
  }

  for (const r of rows) {
    if (String(r.get("zone") || "").trim()) continue;
    const zone = derive(r.get("name"));
    if (zone) {
      r.set("zone", zone);
      dao.saveRecord(r);
    }
  }
}, (db) => {
  // Data-only backfill: no downgrade.
});
