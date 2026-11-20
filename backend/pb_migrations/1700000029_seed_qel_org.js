/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000029_seed_qel_org.js
 * Seeds the QEL Service Hub company, regions, hubs and seed users for Phase A
 * legacy imports. Idempotent: existing rows keyed by unique code/name/username
 * are reused; never destructive.
 */
migrate((db) => {
  const dao = new Dao(db);

  const findFirst = (col, filter, params) => {
    try {
      const rows = dao.findRecordsByFilter(col, filter, "", 1, 0, params || {});
      return rows && rows.length ? rows[0] : null;
    } catch (err) { return null; }
  };

  /* ---------------- company ---------------- */
  let company;
  {
    const col = dao.findCollectionByNameOrId("companies");
    let row = findFirst(col, "name = {:n}", { n: "QEL Service Hub" });
    if (!row) {
      row = new Record(col);
      row.set("name", "QEL Service Hub");
      row.set("status", "Active");
      row.set("seat_limit", 50);
      dao.saveRecord(row);
    }
    company = row.get("id");
  }

  /* ---------------- regions ---------------- */
  const upsertRegion = (code, name) => {
    const col = dao.findCollectionByNameOrId("regions");
    let row = findFirst(col, "region_code = {:c}", { c: code });
    if (!row) {
      row = new Record(col);
      row.set("company_id", company);
      row.set("region_code", code);
      row.set("active", true);
    }
    row.set("name", name);
    row.set("notes", "");
    dao.saveRecord(row);
    return row.get("id");
  };

  const regSouth2 = upsertRegion("REG_S2", "South-2");
  const regSouth1 = upsertRegion("REG_S1", "South-1");
  const regEast = upsertRegion("REG_E", "East");
  const regNorth = upsertRegion("REG_N", "North");

  /* ---------------- hubs ---------------- */
  const upsertHub = (code, name, regionId, lat, lng, radius) => {
    const col = dao.findCollectionByNameOrId("service_hubs");
    let row = findFirst(col, "hub_code = {:c}", { c: code });
    if (!row) {
      row = new Record(col);
      row.set("company_id", company);
      row.set("active", true);
      row.set("allow_roaming", false);
    }
    row.set("hub_code", code);
    row.set("name", name);
    row.set("region_id", regionId);
    row.set("latitude", lat);
    row.set("longitude", lng);
    row.set("radius_meters", radius);
    dao.saveRecord(row);
    return row.get("id");
  };

  const hubBeng = upsertHub("BENG", "Bangalore South Hub", regSouth2, 12.9353, 77.5970, 250);
  const hubHyd = upsertHub("HYDR", "Hyderabad Hub", regSouth1, 17.3850, 78.4867, 250);
  const hubVijy = upsertHub("VIJY", "Vijayawada Hub", regSouth1, 16.5062, 80.6480, 250);
  const hubChen = upsertHub("CHEN", "Chennai Hub", regSouth2, 13.0827, 80.2707, 250);
  const hubJhar = upsertHub("JHAR", "Jamshedpur Hub", regEast, 22.8046, 86.2029, 250);
  const hubDelh = upsertHub("DELH", "Delhi Hub", regNorth, 28.6139, 77.2090, 250);

  /* ---------------- users ---------------- */
  const upsertUser = (userCode, username, role, hubId, regionId) => {
    const col = dao.findCollectionByNameOrId("users");
    let row = findFirst(col, "username = {:u}", { u: username });
    if (!row) {
      row = new Record(col);
      row.set("company_id", company);
      row.set("status", "Active");
      row.set("password_hash", "0");
      row.set("module_rights", "");
      row.set("allow_self_reset", false);
    }
    row.set("user_code", userCode);
    row.set("username", username);
    row.set("role", role);
    row.set("hub_id", hubId);
    row.set("region_id", regionId);
    row.set("scope", role === "Administrator" ? "ALL" : (role === "Supervisor" ? "HUB" : "SELF"));
    dao.saveRecord(row);
    return row.get("id");
  };

  upsertUser("QELADM01", "qel.admin", "Administrator", hubBeng, regSouth2);
  upsertUser("QELSUP01", "qel.sup", "Supervisor", hubBeng, regSouth2);
  upsertUser("QELTEC01", "qel.tech", "Technician", hubBeng, regSouth2);

}, (db) => {
  // Seed data: no downgrade.
});
