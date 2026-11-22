/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000060_demo_login_users.js
 * Demo login users for the mobile/web clients (legacy SHA-256 password_hash,
 * compared directly by /api/fieldops/login). Idempotent.
 *
 * Credentials:
 *   admin / admin    (Administrator, ALL)
 *   mod   / 1        (Moderator, ALL)
 *   user1 / password (Technician, SELF)
 *
 * PB 0.22 JSVM: keep every helper inside the migrate callback.
 */
migrate((db) => {
  const dao = new Dao(db);

  const findFirst = (colName, filter, params) => {
    try {
      const rows = dao.findRecordsByFilter(colName, filter, "", 1, 0, params || {});
      return rows && rows.length ? rows[0] : null;
    } catch (err) { return null; }
  };

  const company = findFirst("companies", "name = {:n}", { n: "QEL Service Hub" });
  const hub = findFirst("service_hubs", "hub_code = {:c}", { c: "BENG" });
  const companyId = company ? company.get("id") : "";
  const hubId = hub ? hub.get("id") : "";
  const regionId = hub ? hub.get("region_id") : "";

  const upsert = (username, hash, role, scope) => {
    const col = dao.findCollectionByNameOrId("users");
    let row = findFirst("users", "username = {:u}", { u: username });
    if (!row) {
      row = new Record(col);
      row.set("company_id", companyId);
      row.set("status", "Active");
      row.set("module_rights", "Tasks,Attendance,Vehicles");
      row.set("allow_self_reset", false);
    }
    row.set("user_code", "DEMO-" + String(username).toUpperCase());
    row.set("username", username);
    row.set("password_hash", hash);
    row.set("role", role);
    row.set("scope", scope);
    row.set("hub_id", hubId);
    row.set("region_id", regionId);
    dao.saveRecord(row);
  };

  upsert("admin", "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918", "Administrator", "ALL");
  upsert("mod", "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b", "Moderator", "ALL");
  upsert("user1", "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8", "Technician", "SELF");

}, (db) => {
  // Seed data: no downgrade.
});
