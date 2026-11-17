#!/usr/bin/env node
/**
 * FieldOps — LIVE integration test against a running PocketBase (v0.22.x).
 * Verifies actual server-side hook behaviour, not just local math:
 *   1.  Health endpoint
 *   2.  Geofence: in-bounds accepted (Verified), out-of-bounds 400,
 *       mock GPS 400, accuracy > 25m 400
 *   3.  Seat limit: 50 active users OK, 51st rejected 400
 *   4.  TAT on close: gross/hold/wrench/downtime computed by hook
 *
 * Usage: node tests/test_integration.js   (PB_URL defaults to 127.0.0.1:8090)
 */
const BASE = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || "itadmin@fieldops.local";
const ADMIN_PASS = process.env.PB_ADMIN_PASSWORD || "";

let passed = 0, failed = 0;
function pass(name) { passed++; console.log(`PASS: ${name}`); }
function fail(name, err) { failed++; console.log(`FAIL: ${name} -> ${err.message || err}`); }

async function api(path, { method = "GET", body, token, expect } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = token;
  const res = await fetch(BASE + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

async function check(name, fn) {
  try { await fn(); pass(name); } catch (err) { fail(name, err); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function main() {
  /* ---------- 1. health ---------- */
  await check("1. Health endpoint returns 200", async () => {
    const r = await api("/api/health");
    assert(r.status === 200, `got ${r.status}`);
  });

  /* ---------- auth (0.22 admins) ---------- */
  const auth = await api("/api/admins/auth-with-password", {
    method: "POST", body: { identity: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  if (!auth.ok) throw new Error("Admin auth failed: " + JSON.stringify(auth.data));
  const token = auth.data.token;
  console.log("Admin authenticated.");

  /* ---------- seed ---------- */
  const company = (await api("/api/collections/companies/records", {
    method: "POST", body: { name: "IntegrationCo", seat_limit: 50, status: "Active" },
  })).data;

  const hub = (await api("/api/collections/service_hubs/records", {
    method: "POST",
    body: {
      company_id: company.id, hub_code: "HUB-TEST", name: "Test Hub",
      latitude: 17.5181, longitude: 78.1685, radius_meters: 300,
      allow_roaming: false, active: true,
    },
  })).data;

  const tech = (await api("/api/collections/users/records", {
    method: "POST", token,
    body: {
      company_id: company.id, username: "tech01",
      password_hash: "4813494d137e1634bba304d5adb368131e3fb9099479d39b8a9b7101700abb7f",
      role: "Technician", status: "Active", hub_id: hub.id, scope: "SELF",
      module_rights: "Tasks,Attendance",
    },
  })).data;

  const attBase = {
    company_id: company.id, user_id: tech.id, hub_id: hub.id,
    hub_name: hub.name, device_uuid: "int-test-device", session_id: "sess-1",
  };

  /* ---------- 2. geofence ---------- */
  await check("2a. Geofence IN-bounds punch accepted (Verified)", async () => {
    const r = await api("/api/collections/attendance/records", {
      method: "POST",
      body: {
        ...attBase, action: "CheckIn", timestamp: new Date().toISOString(),
        latitude: 17.5186, longitude: 78.1685, gps_accuracy_meters: 8,
        within_geofence: true, is_mock_provider: false,
        client_request_id: "geo-in-" + Date.now(),
      },
    });
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.status === "Verified", `status=${r.data.status}`);
    assert(Number(r.data.distance_from_hub_meters) < 300, `distance=${r.data.distance_from_hub_meters}`);
    const istExpected = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
    assert(r.data.ist_date === istExpected, `ist_date=${r.data.ist_date} expected ${istExpected}`);
  });

  await check("2b. Geofence OUT-of-bounds punch rejected 400", async () => {
    const r = await api("/api/collections/attendance/records", {
      method: "POST",
      body: {
        ...attBase, action: "CheckIn", timestamp: new Date().toISOString(),
        latitude: 17.5681, longitude: 78.1685, gps_accuracy_meters: 8, // ~5.5 km away
        is_mock_provider: false, client_request_id: "geo-out-" + Date.now(),
      },
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(/geofence/i.test(r.data.message || ""), `message=${r.data.message}`);
  });

  await check("2c. Mock location provider rejected 400", async () => {
    const r = await api("/api/collections/attendance/records", {
      method: "POST",
      body: {
        ...attBase, action: "CheckIn", timestamp: new Date().toISOString(),
        latitude: 17.5181, longitude: 78.1685, gps_accuracy_meters: 8,
        is_mock_provider: true, client_request_id: "geo-mock-" + Date.now(),
      },
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(/mock/i.test(r.data.message || ""), `message=${r.data.message}`);
  });

  await check("2d. GPS accuracy > 25m rejected 400", async () => {
    const r = await api("/api/collections/attendance/records", {
      method: "POST",
      body: {
        ...attBase, action: "CheckIn", timestamp: new Date().toISOString(),
        latitude: 17.5181, longitude: 78.1685, gps_accuracy_meters: 50,
        is_mock_provider: false, client_request_id: "geo-acc-" + Date.now(),
      },
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(/accuracy/i.test(r.data.message || ""), `message=${r.data.message}`);
  });

  /* ---------- 3. seat limit ---------- */
  await check("3a. Users up to seat limit (50) accepted", async () => {
    for (let i = 2; i <= 50; i++) {
      const r = await api("/api/collections/users/records", {
        method: "POST", token,
        body: {
          company_id: company.id, username: "u" + String(i).padStart(2, "0"),
          password_hash: "4813494d137e1634bba304d5adb368131e3fb9099479d39b8a9b7101700abb7f",
          role: "Technician", status: "Active", hub_id: hub.id,
        },
      });
      assert(r.status === 200, `user #${i} got ${r.status}: ${JSON.stringify(r.data)}`);
    }
  });

  await check("3b. 51st active user rejected 400 (seat limit)", async () => {
    const r = await api("/api/collections/users/records", {
      method: "POST", token,
      body: {
        company_id: company.id, username: "u51",
        password_hash: "4813494d137e1634bba304d5adb368131e3fb9099479d39b8a9b7101700abb7f",
        role: "Technician", status: "Active", hub_id: hub.id,
      },
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(/seat limit/i.test(r.data.message || ""), `message=${r.data.message}`);
  });

  /* ---------- 4. TAT on close ---------- */
  await check("4. TAT computed on CLOSE (holds subtracted)", async () => {
    const T0 = Date.now();
    const at = (m) => new Date(T0 + m * 60000).toISOString();

    const job = (await api("/api/collections/job_cards/records", {
      method: "POST",
      body: {
        company_id: company.id, job_code: "JC-INT-0001",
        vehicle_id: "", technician_id: tech.id, hub_id: hub.id, status: "IN_PROGRESS",
        breakdown_reported_at: at(0), job_started_at: at(10),
      },
    })).data;

    await api("/api/collections/job_card_holds/records", {
      method: "POST",
      body: { job_card_id: job.id, reason: "WAITING_FOR_SPARES", notes: "brake pads", held_at: at(60), resumed_at: at(120), duration_minutes: 60 },
    });
    await api("/api/collections/job_card_holds/records", {
      method: "POST",
      body: { job_card_id: job.id, reason: "WAITING_APPROVAL", notes: "supervisor signoff", held_at: at(150), resumed_at: at(180), duration_minutes: 30 },
    });

    const close = await api(`/api/collections/job_cards/records/${job.id}`, {
      method: "PATCH",
      body: {
        status: "CLOSED",
        job_completed_at: at(480),      // 480 min gross (started at +10)
        vehicle_released_at: at(540),   // 540 min downtime (from T0)
      },
    });
    assert(close.status === 200, `close got ${close.status}: ${JSON.stringify(close.data)}`);
    assert(close.data.gross_tat_minutes === 470, `gross=${close.data.gross_tat_minutes}`);
    assert(close.data.total_hold_minutes === 90, `hold=${close.data.total_hold_minutes}`);
    assert(close.data.active_wrench_minutes === 380, `wrench=${close.data.active_wrench_minutes}`);
    assert(close.data.total_downtime_minutes === 540, `downtime=${close.data.total_downtime_minutes}`);
  });

  /* ---------- summary ---------- */
  console.log(`\n${passed}/${passed + failed} checks passed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error("FATAL:", err.message || err); process.exit(1); });
