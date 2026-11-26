/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000160_job_remarks.js
 * Adds a free-text `remarks` field to job_cards so engineers/supervisors can
 * leave a short note that is visible on the job detail view. Additive.
 *
 * PB 0.22 JSVM: keep every helper inside the migrate callback.
 */
migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("job_cards");
  try {
    if (!c.schema.getFieldByName("remarks")) {
      c.schema.addField(new SchemaField({
        name: "remarks", type: "text", required: false, unique: false,
        options: { min: null, max: null, pattern: "" }
      }));
      dao.saveCollection(c);
    }
  } catch (err) { /* field already present */ }
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("job_cards");
  try {
    const f = c.schema.getFieldByName("remarks");
    if (f) c.schema.removeField(f.id);
  } catch (err) { /* already gone */ }
  dao.saveCollection(c);
});
