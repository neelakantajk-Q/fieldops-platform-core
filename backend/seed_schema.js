#!/usr/bin/env node
/**
 * seed_schema.js — PocketBase SDK/REST seeder for local development.
 *
 * The canonical schema + default seed data are created automatically by
 * pb_migrations/*.js when PocketBase first boots. This script is an optional
 * companion for re-seeding a running instance over the REST API.
 *
 * Usage:
 *   PB_URL=http://127.0.0.1:8090 \
 *   PB_ADMIN_EMAIL=admin@example.com \
 *   PB_ADMIN_PASSWORD=secret \
 *   node seed_schema.js
 */
const BASE = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const EMAIL = process.env.PB_ADMIN_EMAIL || "";
const PASSWORD = process.env.PB_ADMIN_PASSWORD || "";

async function api(path, options = {}, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = token;
  const res = await fetch(BASE + path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${data.message || text}`);
  return data;
}

async function main() {
  console.log(`Seeding PocketBase at ${BASE}`);
  if (!EMAIL || !PASSWORD) {
    throw new Error("Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD (a PocketBase superuser).");
  }

  // PB <= 0.22: /api/admins/auth-with-password — PB >= 0.23: /api/collections/_superusers/...
  let auth;
  try {
    auth = await api("/api/admins/auth-with-password", {
      method: "POST",
      body: JSON.stringify({ identity: EMAIL, password: PASSWORD })
    });
  } catch (e) {
    auth = await api("/api/collections/_superusers/auth-with-password", {
      method: "POST",
      body: JSON.stringify({ identity: EMAIL, password: PASSWORD })
    });
  }
  const token = auth.token;
  console.log("Authenticated as superuser.");

  // Company
  let companies = await api('/api/collections/companies/records?filter=(name="OpenCode Enterprise")', {}, token);
  let company = companies.items[0];
  if (!company) {
    company = await api("/api/collections/companies/records", {
      method: "POST",
      body: JSON.stringify({ name: "OpenCode Enterprise", seat_limit: 50, status: "Active" })
    }, token);
    console.log("Created company.");
  }

  // Hub
  let hubs = await api('/api/collections/service_hubs/records?filter=(name="HQ Central Hub")', {}, token);
  let hub = hubs.items[0];
  if (!hub) {
    hub = await api("/api/collections/service_hubs/records", {
      method: "POST",
      body: JSON.stringify({
        company_id: company.id, hub_code: "HUB-0001", name: "HQ Central Hub",
        latitude: 17.5181, longitude: 78.1685, radius_meters: 800,
        allow_roaming: false, active: true
      })
    }, token);
    console.log("Created hub.");
  }

  // Users (legacy SHA-256 hashes)
  const users = [
    ["admin", "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918", "Administrator", "ALL"],
    ["mod", "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b", "Moderator", "ALL"],
    ["user1", "4813494d137e1634bba304d5adb368131e3fb9099479d39b8a9b7101700abb7f", "Technician", "SELF"]
  ];
  for (const [username, hash, role, scope] of users) {
    const found = await api(`/api/collections/users/records?filter=(username="${username}")`, {}, token);
    if (found.items.length) { console.log(`User ${username} exists.`); continue; }
    await api("/api/collections/users/records", {
      method: "POST",
      body: JSON.stringify({
        company_id: company.id, username, password_hash: hash, role,
        status: "Active", hub_id: hub.id, scope, module_rights: "Tasks,Attendance,Vehicles"
      })
    }, token);
    console.log(`Seeded user ${username}.`);
  }

  console.log("Seed complete.");
}

main().catch((err) => { console.error(err.message); process.exit(1); });
