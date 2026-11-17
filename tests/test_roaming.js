/**
 * FieldOps - roaming (transit day-pass) integration test.
 *
 * Flow: tech requests transit outside radius -> PENDING (idempotent);
 * tech cannot approve (403); supervisor approves -> day pass active;
 * out-of-radius punch then succeeds (Verified_Roaming).
 *
 * Usage: node tests/test_roaming.js   (PB_URL defaults to 127.0.0.1:8090)
 */
const BASE = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || "itadmin@fieldops.local";
const ADMIN_PASS = process.env.PB_ADMIN_PASSWORD || "";
const crypto = require("crypto");

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`PASS: ${msg}`); passed++; }
  else { console.log(`FAIL: ${msg}`); failed++; }
}

async function api(path, { method = "POST", token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function fieldopsLogin(username, password) {
  const r = await api("/api/fieldops/login", {
    body: { username, passwordHash: sha256(password), deviceUUID: "roam-test-device" }
  });
  assert(r.status === 200 && r.data.sessionToken, `fieldops login ${username}`);
  return r.data.sessionToken;
}

(async () => {
  console.log(`Roaming flow test against ${BASE}\n`);
  const suffix = Date.now().toString(36).slice(-5);

  /* admin (PocketBase superuser) for setup */
  const adminAuth = await api("/api/admins/auth-with-password", {
    body: { identity: ADMIN_EMAIL, password: ADMIN_PASS }
  });
  assert(adminAuth.status === 200, "superuser auth for setup");
  const adminToken = adminAuth.data.token;
  const h = { Authorization: adminToken, "Content-Type": "application/json" };

  /* isolated company (seat limit on shared demo companies could block users) */
  const compRes = await fetch(`${BASE}/api/collections/companies/records`, {
    method: "POST", headers: h,
    body: JSON.stringify({ name: `RoamTest ${suffix}`, seat_limit: 10, status: "Active" })
  });
  const company = await compRes.json();
  const hubs = (await (await fetch(`${BASE}/api/collections/service_hubs/records`, { headers: { Authorization: adminToken } })).json()).items;
  const hub = hubs[0];

  /* technician + supervisor via /api/collections/users (admin write) */
  async function makeUser(username, role) {
    const body = JSON.stringify({
      company_id: company.id, username, user_code: username.toUpperCase(),
      password_hash: sha256("TestPass1"), role, status: "Active",
      hub_id: hub.id, scope: role === "Supervisor" ? "HUB" : "SELF"
    });
    const res = await fetch(`${BASE}/api/collections/users/records`, { method: "POST", headers: h, body });
    return res.json();
  }
  const tech = await makeUser(`roamtech_${suffix}`, "Technician");
  const sup = await makeUser(`roamsup_${suffix}`, "Supervisor");
  assert(!!tech.id, "test technician created");
  assert(!!sup.id, "test supervisor created");

  /* far-out coordinates (roughly 20km away from hub) */
  const farLat = Number(hub.latitude) + 0.18;
  const farLng = Number(hub.longitude);

  /* 1. tech requests transit -> PENDING */
  const techTok = await fieldopsLogin(tech.username, "TestPass1");
  const req1 = await api("/api/fieldops/roaming-request", {
    token: techTok,
    body: { sessionToken: techTok, requestType: "PUNCH_IN", lat: farLat, lng: farLng, accuracy: 8, notes: "client at site" }
  });
  assert(req1.status === 200 && req1.data.status === "PENDING", `transit request PENDING (dist ${req1.data.distanceFromHubMeters}m)`);

  /* 2. idempotent: second request returns same pending */
  const req2 = await api("/api/fieldops/roaming-request", {
    token: techTok,
    body: { sessionToken: techTok, requestType: "PUNCH_IN", lat: farLat, lng: farLng, accuracy: 8 }
  });
  assert(req2.status === 200 && req2.data.pending === true && req2.data.requestId === req1.data.requestId, "duplicate request stays PENDING (idempotent)");

  /* 3. out-of-radius punch rejected before approval */
  const pre = await api("/api/collections/attendance/records", {
    token: adminToken,
    body: {
      company_id: company.id, user_id: tech.id, hub_id: hub.id, action: "CheckIn",
      timestamp: new Date().toISOString(), latitude: farLat, longitude: farLng,
      gps_accuracy_meters: 8, is_mock_provider: false
    }
  });
  assert(pre.status === 400 && /geofence/i.test(pre.data.message || ""), "punch outside radius rejected BEFORE approval");

  /* 4. tech cannot approve (role gate) */
  const deny = await api("/api/fieldops/roaming-approve", {
    token: techTok,
    body: { sessionToken: techTok, requestId: req1.data.requestId, decision: "APPROVED" }
  });
  assert(deny.status === 403, "technician approval attempt rejected 403");

  /* 5. supervisor approves -> day pass */
  const supTok = await fieldopsLogin(sup.username, "TestPass1");
  const appr = await api("/api/fieldops/roaming-approve", {
    token: supTok,
    body: { sessionToken: supTok, requestId: req1.data.requestId, decision: "APPROVED" }
  });
  assert(appr.status === 200 && appr.data.dayPassActive === true, "supervisor APPROVED (day pass active)");

  /* 6. status shows approved */
  const st = await api("/api/fieldops/roaming-status", { token: techTok, body: { sessionToken: techTok } });
  assert(st.status === 200 && st.data.approved === true, "roaming-status reports APPROVED for today");

  /* 7. same out-of-radius punch now succeeds as Verified_Roaming */
  const post = await api("/api/collections/attendance/records", {
    token: adminToken,
    body: {
      company_id: company.id, user_id: tech.id, hub_id: hub.id, action: "CheckIn",
      timestamp: new Date().toISOString(), latitude: farLat, longitude: farLng,
      gps_accuracy_meters: 8, is_mock_provider: false
    }
  });
  assert(post.status === 200 && post.data.status === "Verified_Roaming", `punch outside radius VERIFIED after day pass (${post.data.status})`);

  /* 8. unapproved user is still rejected (control) */
  const other = await makeUser(`roamother_${suffix}`, "Technician");
  const pre2 = await api("/api/collections/attendance/records", {
    token: adminToken,
    body: {
      company_id: company.id, user_id: other.id, hub_id: hub.id, action: "CheckIn",
      timestamp: new Date().toISOString(), latitude: farLat, longitude: farLng,
      gps_accuracy_meters: 8, is_mock_provider: false
    }
  });
  assert(pre2.status === 400, "user WITHOUT day pass still rejected 400");

  console.log(`\n${passed}/${passed + failed} roaming checks passed.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
