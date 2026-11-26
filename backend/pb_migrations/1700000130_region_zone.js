/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000130_region_zone.js
 * Adds a real Zone level above Region.
 *
 *   regions.zone  text  — free-form zone label (e.g. "South", "North")
 *
 * Existing regions are backfilled from their name prefix so the Team tree
 * renders a Zone > Region > Hub > Manager > Technician hierarchy immediately
 * (South-1 / South-2 -> South, East -> East, North -> North, ...).
 */
migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("regions");

  try {
    const existing = c.schema.getFieldByName("zone");
    if (!existing) {
      c.schema.addField(new SchemaField({
        name: "zone", type: "text", required: false, unique: false,
        options: { min: null, max: null, pattern: "" }
      }));
    }
  } catch (err) {
    c.schema.addField(new SchemaField({
      name: "zone", type: "text", required: false, unique: false,
      options: { min: null, max: null, pattern: "" }
    }));
  }
  dao.saveCollection(c);

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
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("regions");
  try {
    const f = c.schema.getFieldByName("zone");
    if (f) c.schema.removeField(f.id);
  } catch (err) { /* already gone */ }
  dao.saveCollection(c);
});
