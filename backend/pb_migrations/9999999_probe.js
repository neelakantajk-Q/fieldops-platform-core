/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const names = ["companies", "regions", "service_hubs", "clients", "users", "vehicles",
    "attendance", "captures", "job_cards", "job_card_holds", "capa_records",
    "telemetry", "audit_logs", "settings", "workflows", "forms_registry", "reminders", "reminder_logs"];
  names.forEach((n) => {
    try {
      const c = dao.findCollectionByNameOrId(n);
      console.log("PROBE OK:", n, "fields:", c.schema.fields().length);
      c.schema.fields().forEach((f) => console.log("  ", n, f.name, f.type, JSON.stringify(f.options)));
    } catch (err) {
      console.log("PROBE FAIL:", n, String(err));
    }
  });
  console.log("PROBE END");
}, (db) => {});
