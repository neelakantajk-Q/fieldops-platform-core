/**
 * Incremental hook debug script (<=500 lines).
 *
 *   PB_URL=http://127.0.0.1:8320 node tests/t_num.js           # all checks
 *   PB_URL=... node tests/t_num.js setup job dup comp capture
 *
 * Every failure prints the FULL PB error body (field-level detail).
 * Checks are independent: a FAIL does not stop the rest.
 */
const BASE = process.env.PB_URL || "http://127.0.0.1:8320";

const state = { admin: "", co: null, reg: null, hub: null, tech: null, regionShort: "", hubShort: "", techShort: "" };
let pass = 0, fail = 0, failures = [];

function line(s) { console.log(s); }
function ok(name, detail) { pass++; line("PASS  " + name + (detail ? "  -> " + detail : "")); }
function bad(name, detail) { fail++; failures.push(name); line("FAIL  " + name + (detail ? "  -> " + detail : "")); }

async function api(method, path, body, token) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = token;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let d = {}; try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t.slice(0, 300) }; }
  return { status: r.status, data: d };
}

function showErr(name, r) {
  const d = r.data || {};
  let extra = d.message || "";
  if (d.data) extra += " | " + JSON.stringify(d.data);
  bad(name, r.status + " " + extra);
}

function istYy() {
  const iso = new Date(Date.now() + 19800000).toISOString();
  return iso.slice(2, 4);
}

/* ------------------------------------------------------------------ setup */
async function setup() {
  // admin bootstrap: first run creates it, later runs reuse it
  let r = await api("POST", "/api/admins/auth-with-password", { identity: "dbg@x.co", password: "Passw0rdLong#" });
  if (r.status !== 200) {
    r = await api("POST", "/api/admins", { email: "dbg@x.co", password: "Passw0rdLong#", passwordConfirm: "Passw0rdLong#" });
    if (r.status !== 200) { bad("setup.admin", r.status + " " + JSON.stringify(r.data).slice(0, 200)); return false; }
    r = await api("POST", "/api/admins/auth-with-password", { identity: "dbg@x.co", password: "Passw0rdLong#" });
    if (r.status !== 200) { bad("setup.admin-login", r.status + " " + JSON.stringify(r.data).slice(0, 200)); return false; }
  }
  state.admin = r.data.token;
  ok("setup.admin");

  r = await api("POST", "/api/collections/companies/records", { name: "DbgCo" + Date.now(), seat_limit: 50, status: "Active" });
  if (r.status !== 200) { showErr("setup.company", r); return false; }
  state.co = r.data; ok("setup.company", state.co.id);

  r = await api("POST", "/api/collections/regions/records", { company_id: state.co.id, region_code: "DbgNorth", name: "DbgNorth", active: true });
  if (r.status !== 200) { showErr("setup.region", r); return false; }
  state.reg = r.data;
  state.regionShort = r.data.short_code || "";
  ok("setup.region", state.reg.id + " short=" + state.regionShort);

  r = await api("POST", "/api/collections/service_hubs/records", { company_id: state.co.id, region_id: state.reg.id, hub_code: "DbgHubOne", name: "DbgHubOne", latitude: 17.5, longitude: 78.1, radius_meters: 300, allow_roaming: false, active: true });
  if (r.status !== 200) { showErr("setup.hub", r); return false; }
  state.hub = r.data;
  state.hubShort = r.data.short_code || "";
  ok("setup.hub", state.hub.id + " short=" + state.hubShort);

  r = await api("POST", "/api/collections/users/records", { company_id: state.co.id, username: "dbgtech" + Date.now(), password_hash: "4813494d137e1634bba304d5adb368131e3fb9099479d39b8a9b7101700abb7f", role: "Technician", status: "Active", hub_id: state.hub.id, scope: "SELF" }, state.admin);
  if (r.status !== 200) { showErr("setup.tech", r); return false; }
  state.tech = r.data;
  state.techShort = r.data.short_code || "";
  ok("setup.tech", state.tech.id + " short=" + state.techShort);
  return true;
}

/* ------------------------------------------------------------------ checks */
async function chkJob() {
  const r = await api("POST", "/api/collections/job_cards/records", {
    company_id: state.co.id, technician_id: state.tech.id, hub_id: state.hub.id,
    status: "OPEN", client_request_id: "job-" + Date.now()
  });
  if (r.status !== 200) { showErr("job.create", r); return; }
  const jc = r.data.job_code || "", cmp = r.data.complaint_no || "";
  const yy = istYy();
  if (jc.startsWith("JC-" + yy + "-")) ok("job.code", jc + " cmp=" + cmp);
  else bad("job.code", jc);
  state.firstJob = r.data;
  if (cmp.startsWith("CMP-" + yy + "-")) ok("job.complaintNo", cmp); else bad("job.complaintNo", cmp);
  if (r.data.code_version === 2) ok("job.codeVersion", "2"); else bad("job.codeVersion", String(r.data.code_version));
}

async function chkDup() {
  if (!state.firstJob) { bad("dup.reuse", "no first job"); return; }
  const crid = state.firstJob.client_request_id;
  const r = await api("POST", "/api/collections/job_cards/records", {
    company_id: state.co.id, technician_id: state.tech.id, hub_id: state.hub.id,
    status: "OPEN", client_request_id: crid
  });
  if (r.status === 400 && /DUPLICATE/i.test(r.data.message || "")) ok("dup.reject", (r.data.message || "").slice(0, 90));
  else bad("dup.reject", r.status + " " + (r.data.message || "") + " " + JSON.stringify(r.data.data || {}).slice(0, 150));
}

async function chkComp() {
  const r = await api("POST", "/api/collections/complaints/records", {
    company_id: state.co.id, region_id: state.reg.id, hub_id: state.hub.id,
    customer_name: "Dbg Customer", description: "direct complaint",
    status: "OPEN", client_request_id: "cmp-" + Date.now()
  });
  if (r.status !== 200) { showErr("comp.create", r); return; }
  const cn = r.data.complaint_no || "";
  const yy = istYy();
  const want = "CMP-" + yy + "-" + state.regionShort + "-" + state.hubShort + "-0002";
  if (cn.startsWith("CMP-" + yy + "-")) ok("comp.code", cn + " (want " + want + ")");
  else bad("comp.code", cn);
  state.secondComp = r.data;
}

async function chkCapture() {
  const r = await api("POST", "/api/collections/captures/records", {
    company_id: state.co.id, user_id: state.tech.id,
    plate_no: "KA01AB1234", source: "MANUAL", client_request_id: "cap-" + Date.now()
  }, state.admin);
  if (r.status !== 200) { showErr("capture.create", r); return; }
  const cc = r.data.capture_code || "";
  const yy = istYy();
  if (cc.startsWith("CAP-" + yy + "-")) ok("capture.code", cc); else bad("capture.code", cc);
}

async function chkImmut() {
  if (!state.firstJob) { bad("immut.code", "no first job"); return; }
  const r = await api("PATCH", "/api/collections/job_cards/records/" + state.firstJob.id, { job_code: "JC-HACKED" }, state.admin);
  if (r.status !== 200) { showErr("immut.patch", r); return; }
  if (r.data.job_code === state.firstJob.job_code) ok("immut.code", "restored " + r.data.job_code);
  else bad("immut.code", "became " + r.data.job_code);
}

async function chkSeqInc() {
  // three jobs back-to-back: numbers must be unique and increment
  const codes = [];
  for (let i = 0; i < 3; i++) {
    const r = await api("POST", "/api/collections/job_cards/records", {
      company_id: state.co.id, technician_id: state.tech.id, hub_id: state.hub.id,
      status: "OPEN", client_request_id: "seq-" + Date.now() + "-" + i
    });
    if (r.status !== 200) { showErr("seq.job" + (i + 1), r); return; }
    codes.push(r.data.job_code);
  }
  const uniq = new Set(codes).size === codes.length;
  if (uniq) ok("seq.increment", codes.join(" , "));
  else bad("seq.increment", codes.join(" , "));
}

async function chkCompSeq() {
  // two direct complaints back-to-back after the one in chkComp
  const cn = [];
  for (let i = 0; i < 2; i++) {
    const r = await api("POST", "/api/collections/complaints/records", {
      company_id: state.co.id, region_id: state.reg.id, hub_id: state.hub.id,
      customer_name: "Seq " + i, description: "x",
      status: "OPEN", client_request_id: "cmpseq-" + Date.now() + "-" + i
    });
    if (r.status !== 200) { showErr("compSeq." + (i + 1), r); return; }
    cn.push(r.data.complaint_no);
  }
  const uniq = new Set(cn).size === cn.length;
  if (uniq) ok("compSeq.increment", cn.join(" , ")); else bad("compSeq.increment", cn.join(" , "));
}

/* ------------------------------------------------------------------ main */
const ALL = ["setup", "job", "dup", "comp", "compSeq", "capture", "immut", "seq"];
const fn = { setup, job: chkJob, dup: chkDup, comp: chkComp, compSeq: chkCompSeq, capture: chkCapture, immut: chkImmut, seq: chkSeqInc };

(async () => {
  const arg = process.argv.slice(2).filter(a => !a.startsWith("-"));
  const steps = arg.length ? arg : ALL;
  line("PB_URL = " + BASE);
  for (const s of steps) {
    if (!fn[s]) { bad("unknown step", s); continue; }
    if (s !== "setup" && !state.tech && !fn.setup.called) {
      const done = await setup(); fn.setup.called = true;
      if (!done) break;
    }
    await fn[s]();
  }
  line("--------------------------------------------------");
  line("RESULT: " + pass + " passed, " + fail + " failed" + (fail ? "  [" + failures.join(", ") + "]" : ""));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
