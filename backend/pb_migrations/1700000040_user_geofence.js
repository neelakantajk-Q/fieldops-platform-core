/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000040_user_geofence.js
 * Per-user geofence override (manager-drawn zones on the Live Map).
 *
 *   geofence_mode       INHERIT_HUB (default when empty) | CUSTOM | ROAMING
 *   geofence_lat/lng    center used when mode = CUSTOM
 *   geofence_radius_m   radius used when mode = CUSTOM (25..5000)
 *   geofence_updated_by / _at   last change (username + ISO timestamp)
 *
 * Enforcement lives in pb_hooks/geofence_check.pb.js; writes go through
 * POST /api/fieldops/geofence-set (role + scope checked server-side).
 */
migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("users");

  const addField = (field) => {
    try {
      const existing = c.schema.getFieldByName(field.name);
      if (!existing) c.schema.addField(new SchemaField(field));
    } catch (err) {
      c.schema.addField(new SchemaField(field));
    }
  };

  addField({
    name: "geofence_mode", type: "select", required: false, unique: false,
    options: { maxSelect: 1, values: ["INHERIT_HUB", "CUSTOM", "ROAMING"] }
  });
  addField({
    name: "geofence_lat", type: "number", required: false, unique: false,
    options: { min: -90, max: 90, noDecimal: false }
  });
  addField({
    name: "geofence_lng", type: "number", required: false, unique: false,
    options: { min: -180, max: 180, noDecimal: false }
  });
  addField({
    name: "geofence_radius_m", type: "number", required: false, unique: false,
    options: { min: 25, max: 5000, noDecimal: false }
  });
  addField({
    name: "geofence_updated_by", type: "text", required: false, unique: false,
    options: { min: null, max: null, pattern: "" }
  });
  addField({
    name: "geofence_updated_at", type: "date", required: false, unique: false,
    options: { min: "", max: "" }
  });

  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("users");
  ["geofence_mode", "geofence_lat", "geofence_lng", "geofence_radius_m",
    "geofence_updated_by", "geofence_updated_at"].forEach((name) => {
      try {
        const f = c.schema.getFieldByName(name);
        if (f) c.schema.removeField(f.id);
      } catch (err) { /* already gone */ }
    });
  dao.saveCollection(c);
});
