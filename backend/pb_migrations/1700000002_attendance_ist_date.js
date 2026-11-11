/// <reference path="../pb_data/types.d.ts" />
/**
 * Adds `ist_date` (YYYY-MM-DD, Indian Standard Time) to attendance.
 * Set server-side by geofence_check.pb.js at capture time so daily
 * reports group punches by IST calendar day regardless of device TZ.
 */
migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("attendance");
  c.schema.addField(new SchemaField({
    name: "ist_date", type: "text", required: false, unique: false,
    options: { min: null, max: null, pattern: "" }
  }));
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("attendance");
  try {
    const f = c.schema.getFieldByName("ist_date");
    if (f) c.schema.removeField(f.id);
    dao.saveCollection(c);
  } catch (err) { /* field already gone */ }
});
