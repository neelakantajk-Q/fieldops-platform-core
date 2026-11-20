/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000030_legacy_import_masters.js
 * Creates the master-data collections needed by legacy CSV imports and the
 * parts/inventory flows.
 *
 * Collections:
 *   parts_master, part_aliases, vehicle_registry, vin_model_rules,
 *   model_aliases, defect_codes, suppliers, dealers, dealer_locations,
 *   dealer_users
 */
migrate((db) => {
  const dao = new Dao(db);

  const ensureCollection = (id, name, schema) => {
    const col = new Collection({ id, name, type: "base", system: false });
    for (let i = 0; i < schema.length; i++) {
      col.schema.addField(new SchemaField(Object.assign({}, schema[i], { unique: false })));
    }
    col.listRule = "";
    col.viewRule = "";
    col.createRule = "";
    col.updateRule = "";
    col.deleteRule = "";
    try { dao.saveCollection(col); } catch (err) { /* collection may already exist */ }
    return col;
  };

  const T = (name, required, extra) => Object.assign({ name, type: "text", required: !!required, unique: false, options: { min: null, max: null, pattern: "" } }, extra || {});
  const N = (name, required, extra) => Object.assign({ name, type: "number", required: !!required, unique: false, options: { min: null, max: null, noDecimal: false } }, extra || {});
  const B = (name) => ({ name, type: "bool", required: false, unique: false, options: {} });
  const J = (name) => ({ name, type: "json", required: false, unique: false, options: { maxSize: 2000000 } });
  const R = (name, collectionId, required) => ({ name, type: "relation", required: !!required, unique: false, options: { collectionId, cascadeDelete: false, minSelect: 0, maxSelect: 1 } });

  const partsMaster = ensureCollection("parts_masters000", "parts_master", [
    R("company_id", "companies000000", true),
    T("part_code", true, { unique: true }),
    T("component"),
    J("aliases"),
    J("models"),
    T("price_category"),
    N("tax_rate"),
    N("unit_price"),
    T("hsn_code"),
    B("is_critical"),
    B("is_buffer"),
    B("active"),
  ]);
  const partAliases = ensureCollection("part_aliases00", "part_aliases", [
    R("company_id", "companies000000", true),
    T("alias", true),
    T("part_code", true),
  ]);
  const vehicleRegistry = ensureCollection("vehicle_registry0", "vehicle_registry", [
    R("company_id", "companies000000", true),
    T("vin", true, { unique: true }),
    T("plate_no"),
    T("model"),
    R("hub_id", "service_hubs000"),
    B("active"),
  ]);
  const vinModelRules = ensureCollection("vin_model_rules0", "vin_model_rules", [
    R("company_id", "companies000000", true),
    T("pattern", true),
    N("position"),
    T("model", true),
  ]);
  const modelAliases = ensureCollection("model_aliases0", "model_aliases", [
    R("company_id", "companies000000", true),
    T("alias", true),
    T("model", true),
  ]);
  const defectCodes = ensureCollection("defect_codes00", "defect_codes", [
    R("company_id", "companies000000", true),
    T("code", true),
    T("name", true),
    T("category"),
  ]);
  const suppliers = ensureCollection("suppliers000", "suppliers", [
    R("company_id", "companies000000", true),
    T("code", true),
    T("name", true),
    T("contact"),
  ]);
  const dealers = ensureCollection("dealers00000", "dealers", [
    R("company_id", "companies000000", true),
    T("dealer_code", true),
    T("name", true),
    T("type"),
    T("contact"),
    B("active"),
  ]);
  const dealerLocations = ensureCollection("dealer_locs00", "dealer_locations", [
    R("dealer_id", "dealers00000", true),
    T("address"),
    R("hub_id", "service_hubs000"),
    B("active"),
  ]);
  const dealerUsers = ensureCollection("dealer_users0", "dealer_users", [
    R("dealer_id", "dealers00000", true),
    R("user_id", "users0000000000", true),
  ]);

  return;
}, (db) => {
  // Seed masters: no downgrade.
});
