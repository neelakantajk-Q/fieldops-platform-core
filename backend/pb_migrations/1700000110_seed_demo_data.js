/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000110_seed_demo_data.js
 * Clean QEL demo dataset for the public Render demo.
 *
 * Design goals:
 *   - Idempotent: every row is keyed by a natural key and upserted.
 *   - Safe for restarts: Render free has an ephemeral disk, so this migration
 *     re-seeds on every boot.
 *   - Hook-safe: complaints/jobs carry code_version = 3 so the server-side
 *     numbering hooks (request hooks and the complaints model hook) skip them.
 *     We provide stable CMP/JC numbers ourselves.
 *   - Small enough for the free tier: ~20 users, 6 clients, 10 vehicles,
 *     18 complaints, 15 job cards, plus supporting rows.
 *
 * Demo logins (created by 1700000060_demo_login_users.js):
 *   admin / admin    (Administrator, ALL)
 *   mod   / 1        (Moderator, ALL)
 *   user1 / password (Technician, SELF)
 *
 * Extra technicians use password "password".
 *
 * PB 0.22 JSVM: keep every helper inside the migrate callback.
 */
migrate((db) => {
  const dao = new Dao(db);

  const COMPANY_NAME = "QEL Service Hub";
  const FY = "2026-27";
  const BASE = Date.UTC(2026, 10, 10, 4, 30, 0); // 2026-11-10 10:00 IST
  const DAY = 86400000;
  const HOUR = 3600000;
  const IST_OFFSET = 19800000;
  const PASSWORD_HASH = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
  const ADMIN_HASH = "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918";
  const MOD_HASH = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";

  const iso = (ms) => new Date(ms).toISOString();
  const istDate = (ms) => new Date(ms + IST_OFFSET).toISOString().slice(0, 10);
  const pad = (n, w) => {
    let s = String(n);
    while (s.length < w) s = "0" + s;
    return s;
  };

  const findFirst = (colName, filter, params) => {
    try {
      const rows = dao.findRecordsByFilter(colName, filter, "", 1, 0, params || {});
      return rows && rows.length ? rows[0] : null;
    } catch (err) {
      return null;
    }
  };

  const seed = (colName, filter, params, data) => {
    const col = dao.findCollectionByNameOrId(colName);
    let row = findFirst(colName, filter, params);
    if (!row) row = new Record(col);
    Object.keys(data).forEach((k) => {
      row.set(k, data[k]);
    });
    dao.saveRecord(row);
    return row;
  };

  /* ------------------------------------------------------------------ company */
  const company = findFirst("companies", "name = {:n}", { n: COMPANY_NAME });
  if (!company) throw new Error("QEL company missing; run 1700000029_seed_qel_org first.");
  const companyId = company.id;

  /* ------------------------------------------------------------ regions / hubs */
  const regionDefs = [
    ["REG_S2", "South-2", "RG2"],
    ["REG_S1", "South-1", "RG1"],
    ["REG_E", "East", "RGE"],
    ["REG_N", "North", "RGN"]
  ];
  const regionIds = {};
  regionDefs.forEach((r) => {
    const row = seed("regions", "region_code = {:c}", { c: r[0] }, {
      company_id: companyId,
      region_code: r[0],
      name: r[1],
      notes: "",
      active: true,
      short_code: r[2]
    });
    regionIds[r[0]] = row.id;
  });

  const hubDefs = [
    ["BENG", "Bangalore South Hub", "REG_S2", 12.9353, 77.5970, 250, "BENG"],
    ["HYDR", "Hyderabad Hub", "REG_S1", 17.3850, 78.4867, 250, "HYDR"],
    ["VIJY", "Vijayawada Hub", "REG_S1", 16.5062, 80.6480, 250, "VIJY"],
    ["CHEN", "Chennai Hub", "REG_S2", 13.0827, 80.2707, 250, "CHEN"],
    ["JHAR", "Jamshedpur Hub", "REG_E", 22.8046, 86.2029, 250, "JHAR"],
    ["DELH", "Delhi Hub", "REG_N", 28.6139, 77.2090, 250, "DELH"]
  ];
  const hubIds = {};
  hubDefs.forEach((h) => {
    const row = seed("service_hubs", "hub_code = {:c}", { c: h[0] }, {
      company_id: companyId,
      hub_code: h[0],
      name: h[1],
      region_id: regionIds[h[2]],
      latitude: h[3],
      longitude: h[4],
      radius_meters: h[5],
      allow_roaming: false,
      active: true,
      short_code: h[6]
    });
    hubIds[h[0]] = row.id;
  });

  /* ------------------------------------------------------------------- users */
  const userDefs = [
    {
      username: "admin", hash: ADMIN_HASH, role: "Administrator", scope: "ALL",
      code: "DEMO-ADMIN", short: "ADMN", work: "OFFICE",
      rights: "Tasks,Attendance,Vehicles,Users,Clients,Dealers,Parts,Billing,Reports,Settings",
      phone: "9876500001", reports: ""
    },
    {
      username: "mod", hash: MOD_HASH, role: "Moderator", scope: "ALL",
      code: "DEMO-MOD", short: "MOD1", work: "OFFICE",
      rights: "Tasks,Attendance,Vehicles,Clients,Dealers,Parts,Billing,Reports",
      phone: "9876500002", reports: "admin"
    },
    {
      username: "user1", hash: PASSWORD_HASH, role: "Technician", scope: "SELF",
      code: "DEMO-USER1", short: "TEC1", work: "FIELD",
      rights: "Tasks,Attendance,Vehicles", phone: "9876500003", reports: "sup2"
    },
    {
      username: "tech2", hash: PASSWORD_HASH, role: "Technician", scope: "SELF",
      code: "TECH02", short: "TEC2", work: "FIELD",
      rights: "Tasks,Attendance,Vehicles", phone: "9876500004", reports: "sup2"
    },
    {
      username: "tech3", hash: PASSWORD_HASH, role: "Technician", scope: "SELF",
      code: "TECH03", short: "TEC3", work: "FIELD",
      rights: "Tasks,Attendance,Vehicles", phone: "9876500005", reports: "sup2"
    },
    {
      username: "tech4", hash: PASSWORD_HASH, role: "Technician", scope: "SELF",
      code: "TECH04", short: "TEC4", work: "FIELD",
      rights: "Tasks,Attendance,Vehicles", phone: "9876500006", reports: "sup2"
    },
    {
      username: "tech5", hash: PASSWORD_HASH, role: "Technician", scope: "SELF",
      code: "TECH05", short: "TEC5", work: "FIELD",
      rights: "Tasks,Attendance,Vehicles", phone: "9876500007", reports: "sup2"
    },
    {
      username: "tech6", hash: PASSWORD_HASH, role: "Technician", scope: "SELF",
      code: "TECH06", short: "TEC6", work: "FIELD",
      rights: "Tasks,Attendance,Vehicles", phone: "9876500008", reports: "sup2"
    },
    {
      username: "sup2", hash: PASSWORD_HASH, role: "Supervisor", scope: "REGION",
      code: "SUP02", short: "SUP2", work: "FIELD",
      rights: "Tasks,Attendance,Vehicles,Reports", phone: "9876500009", reports: "mod"
    }
  ];
  const userIds = {};
  const shortByUser = {};
  userDefs.forEach((u) => {
    const row = seed("users", "username = {:u}", { u: u.username }, {
      company_id: companyId,
      user_code: u.code,
      username: u.username,
      password_hash: u.hash,
      role: u.role,
      status: "Active",
      hub_id: hubIds.BENG,
      region_id: regionIds.REG_S2,
      work_mode: u.work,
      shift_start: "09:00",
      shift_end: "18:00",
      module_rights: u.rights,
      phone_number: u.phone,
      reports_to: u.reports,
      scope: u.scope,
      allow_self_reset: false,
      capability: "",
      short_code: u.short,
      geofence_mode: "INHERIT_HUB",
      geofence_buffer_m: 50,
      breach_grace_minutes: 10,
      last_zone: "INSIDE",
      last_lat: 12.9353,
      last_lng: 77.5970,
      last_geo_at: iso(BASE),
      last_address: "Bangalore, Karnataka",
      last_address_at: iso(BASE)
    });
    userIds[u.username] = row.id;
    shortByUser[u.username] = u.short;
  });

  /* ----------------------------------------------------------------- clients */
  const clientDefs = [
    { code: "CLI-001", name: "Kirloskar Motors", contact: "Ramesh Kumar", phone: "9876510001", addr: "Peenya Industrial Area, Bangalore", lat: 13.0280, lng: 77.5180 },
    { code: "CLI-002", name: "Ashok Leyland Fleet", contact: "Suresh Babu", phone: "9876510002", addr: "Hosur Road, Bangalore", lat: 12.9010, lng: 77.6100 },
    { code: "CLI-003", name: "Tata Motors Service", contact: "Anita Rao", phone: "9876510003", addr: "Whitefield, Bangalore", lat: 12.9700, lng: 77.7500 },
    { code: "CLI-004", name: "Mahindra Logistics", contact: "Vikram Singh", phone: "9876510004", addr: "Electronic City, Bangalore", lat: 12.8450, lng: 77.6600 },
    { code: "CLI-005", name: "Bosch Car Service", contact: "Priya Menon", phone: "9876510005", addr: "Koramangala, Bangalore", lat: 12.9350, lng: 77.6200 },
    { code: "CLI-006", name: "TVS Auto Assist", contact: "Arun Patel", phone: "9876510006", addr: "Indiranagar, Bangalore", lat: 12.9780, lng: 77.6400 }
  ];
  const clientIds = [];
  clientDefs.forEach((c) => {
    const row = seed("clients", "name = {:n}", { n: c.name }, {
      company_id: companyId,
      client_code: c.code,
      name: c.name,
      hub_id: hubIds.BENG,
      region_id: regionIds.REG_S2,
      address: c.addr,
      latitude: c.lat,
      longitude: c.lng,
      contact_name: c.contact,
      contact_phone: c.phone,
      active: true
    });
    clientIds.push(row.id);
  });

  /* ---------------------------------------------------------------- vehicles */
  const vehicleDefs = [
    { plate: "KA01AB1234", vin: "MAT12345678901234", make: "Tata", model: "Ace Gold", status: "Active", assigned: "user1", anomaly: "" },
    { plate: "KA02CD5678", vin: "MAT12345678901235", make: "Tata", model: "Intra", status: "Active", assigned: "tech2", anomaly: "" },
    { plate: "KA03EF9012", vin: "MAT12345678901236", make: "Ashok Leyland", model: "Dost", status: "Active", assigned: "tech3", anomaly: "" },
    { plate: "KA04GH3456", vin: "MAT12345678901237", make: "Mahindra", model: "Jeeto", status: "Idle", assigned: "user1", anomaly: "" },
    { plate: "KA05IJ7890", vin: "MAT12345678901238", make: "Tata", model: "Ace Gold", status: "Active", assigned: "tech4", anomaly: "GPS_JUMP" },
    { plate: "KA06KL2345", vin: "MAT12345678901239", make: "Tata", model: "Intra", status: "Active", assigned: "tech5", anomaly: "" },
    { plate: "KA07MN6789", vin: "MAT12345678901240", make: "Ashok Leyland", model: "Dost", status: "Idle", assigned: "tech6", anomaly: "" },
    { plate: "KA08OP1234", vin: "MAT12345678901241", make: "Mahindra", model: "Jeeto", status: "Active", assigned: "tech2", anomaly: "" },
    { plate: "KA09QR5678", vin: "MAT12345678901242", make: "Tata", model: "Ace Gold", status: "OutOfZone", assigned: "tech3", anomaly: "OUT_OF_ZONE" },
    { plate: "KA10ST9012", vin: "MAT12345678901243", make: "Tata", model: "Intra", status: "Active", assigned: "user1", anomaly: "" }
  ];
  const vehicleIds = [];
  vehicleDefs.forEach((v, i) => {
    const row = seed("vehicles", "plate_no = {:p}", { p: v.plate }, {
      company_id: companyId,
      plate_no: v.plate,
      plate_raw: v.plate,
      vin: v.vin,
      make: v.make,
      model: v.model,
      assigned_user_id: userIds[v.assigned] || "",
      hub_id: hubIds.BENG,
      status: v.status,
      last_seen_lat: 12.9353 + i * 0.002,
      last_seen_lng: 77.5970 + i * 0.002,
      last_seen_at: iso(BASE + i * HOUR),
      anomaly_flags: v.anomaly,
      source: "OCR",
      ocr_confidence: 0.92,
      notes: "",
      active: true,
      fiscal_year: FY
    });
    vehicleIds.push(row.id);
  });

  /* ------------------------------------------------------------ parts / stock */
  const partDefs = [
    { code: "P-1001", component: "Brake Pad", aliases: ["Brake Pad", "Front Brake Pad"], models: ["Ace Gold", "Intra"], price: 450, critical: true, buffer: true },
    { code: "P-1002", component: "Battery", aliases: ["Battery", "12V Battery"], models: ["Ace Gold"], price: 5200, critical: true, buffer: true },
    { code: "P-1003", component: "Radiator", aliases: ["Radiator", "Cooling Coil"], models: ["Intra"], price: 3200, critical: true, buffer: false },
    { code: "P-1004", component: "Clutch Cable", aliases: ["Clutch Cable"], models: ["Ace Gold", "Intra"], price: 350, critical: false, buffer: true },
    { code: "P-1005", component: "AC Compressor", aliases: ["AC Compressor", "Compressor"], models: ["Ace Gold"], price: 8500, critical: true, buffer: false },
    { code: "P-1006", component: "Tyre Tube", aliases: ["Tyre Tube", "Tube"], models: ["Ace Gold", "Intra"], price: 250, critical: false, buffer: true },
    { code: "P-1007", component: "Engine Oil", aliases: ["Engine Oil", "Oil"], models: ["Ace Gold", "Intra"], price: 650, critical: false, buffer: true },
    { code: "P-1008", component: "Suspension Bush", aliases: ["Suspension Bush", "Bush"], models: ["Intra"], price: 750, critical: false, buffer: false },
    { code: "P-1009", component: "Headlight Assembly", aliases: ["Headlight", "Lamp"], models: ["Ace Gold"], price: 1800, critical: false, buffer: false },
    { code: "P-1010", component: "Air Filter", aliases: ["Air Filter", "Filter"], models: ["Ace Gold", "Intra"], price: 300, critical: false, buffer: true }
  ];
  const stockOnHand = {
    "P-1001": 28, "P-1002": 9, "P-1003": 7, "P-1004": 12, "P-1005": 3,
    "P-1006": 8, "P-1007": 19, "P-1008": 6, "P-1009": 4, "P-1010": 17
  };
  partDefs.forEach((p, i) => {
    seed("parts_master", "part_code = {:c}", { c: p.code }, {
      company_id: companyId,
      part_code: p.code,
      component: p.component,
      aliases: p.aliases,
      models: p.models,
      price_category: i < 3 ? "A" : (i < 7 ? "B" : "C"),
      tax_rate: 18,
      unit_price: p.price,
      hsn_code: "8708",
      is_critical: p.critical,
      is_buffer: p.buffer,
      active: true,
      lead_time_days: 7,
      moq: 1,
      pack_size: 1,
      safety_days: 3
    });
    seed("inventory_stock", "hub_id = {:h} && part_code = {:c}", { h: hubIds.BENG, c: p.code }, {
      company_id: companyId,
      hub_id: hubIds.BENG,
      part_code: p.code,
      on_hand: stockOnHand[p.code],
      on_order: i % 3,
      reserved: 0,
      reorder_point: 5,
      safety_stock: 3,
      lead_time_days: 7,
      moq: 1,
      pack_size: 1,
      last_counted_at: iso(BASE - DAY),
      revision: 1,
      active: true
    });
  });

  /* -------------------------------------------------------------- complaints */
  const complaintDescriptions = [
    "Brake noise and vibration",
    "Engine overheating",
    "Battery drain",
    "Tyre puncture",
    "AC not cooling",
    "Clutch slipping"
  ];
  const complaintMap = {};
  for (let i = 0; i < 18; i++) {
    const c = clientDefs[i % clientDefs.length];
    const v = vehicleDefs[i % vehicleDefs.length];
    const reported = BASE + i * DAY;
    let status = "JOB_CREATED";
    if (i >= 15) status = ["OPEN", "ASSIGNED", "CLOSED"][i - 15];
    const no = "CMP-26-RG2-BENG-" + pad(i + 1, 4);
    const row = seed("complaints", "complaint_no = {:n}", { n: no }, {
      complaint_no: no,
      company_id: companyId,
      region_id: regionIds.REG_S2,
      hub_id: hubIds.BENG,
      client_id: clientIds[i % clientIds.length],
      vehicle_id: vehicleIds[i % vehicleIds.length],
      plate_no: v.plate,
      customer_name: c.contact,
      customer_phone: c.phone,
      description: complaintDescriptions[i % complaintDescriptions.length],
      status: status,
      reported_at: iso(reported),
      reported_by: userIds.user1,
      ist_date: istDate(reported),
      code_version: 3,
      fiscal_year: FY,
      client_request_id: "SEED-CMP-" + pad(i + 1, 3)
    });
    complaintMap["c" + (i + 1)] = { id: row.id, no: row.get("complaint_no") };
  }

  /* --------------------------------------------------------------- job cards */
  const jobDefs = [
    { key: "j1", c: "c1", tech: "user1", v: 0, status: "CLOSED", holdMinutes: 120, partsStatus: "DONE", notes: "Replaced front brake pads; road test OK.", partsUsed: "P-1001 x2", delayCategory: "", delayReason: "" },
    { key: "j2", c: "c2", tech: "tech2", v: 1, status: "CLOSED", holdMinutes: 60, partsStatus: "DONE", notes: "Battery replaced and charging system checked.", partsUsed: "P-1002 x1", delayCategory: "", delayReason: "" },
    { key: "j3", c: "c3", tech: "tech3", v: 2, status: "CLOSED", holdMinutes: 90, partsStatus: "DONE", notes: "Radiator flushed; coolant replaced.", partsUsed: "P-1003 x1", delayCategory: "", delayReason: "" },
    { key: "j4", c: "c4", tech: "user1", v: 3, status: "CLOSED", holdMinutes: 30, partsStatus: "DONE", notes: "Clutch cable adjusted.", partsUsed: "P-1004 x1", delayCategory: "", delayReason: "" },
    { key: "j5", c: "c5", tech: "tech2", v: 4, status: "CLOSED", holdMinutes: 45, partsStatus: "DONE", notes: "AC compressor replaced.", partsUsed: "P-1005 x1", delayCategory: "", delayReason: "" },
    { key: "j6", c: "c6", tech: "tech3", v: 5, status: "CLOSED", holdMinutes: 60, partsStatus: "DONE", notes: "Tyre puncture repaired.", partsUsed: "P-1006 x1", delayCategory: "", delayReason: "" },
    { key: "j7", c: "c7", tech: "user1", v: 6, status: "IN_PROGRESS", holdMinutes: 0, partsStatus: "PENDING", notes: "Engine diagnostics in progress.", partsUsed: "", delayCategory: "", delayReason: "" },
    { key: "j8", c: "c8", tech: "tech2", v: 7, status: "IN_PROGRESS", holdMinutes: 0, partsStatus: "PENDING", notes: "Suspension inspection.", partsUsed: "", delayCategory: "", delayReason: "" },
    { key: "j9", c: "c9", tech: "tech3", v: 8, status: "IN_PROGRESS", holdMinutes: 0, partsStatus: "DONE", notes: "Oil change completed; filter pending.", partsUsed: "P-1007 x1", delayCategory: "", delayReason: "" },
    { key: "j10", c: "c10", tech: "tech4", v: 9, status: "IN_PROGRESS", holdMinutes: 0, partsStatus: "NONE", notes: "Electrical fault tracing.", partsUsed: "", delayCategory: "", delayReason: "" },
    { key: "j11", c: "c11", tech: "user1", v: 0, status: "ON_HOLD", holdMinutes: 1440, partsStatus: "PENDING", notes: "Waiting for brake pad stock.", partsUsed: "", delayCategory: "SPARES", delayReason: "Waiting for brake pad stock" },
    { key: "j12", c: "c12", tech: "tech2", v: 1, status: "ON_HOLD", holdMinutes: 960, partsStatus: "DONE", notes: "Awaiting customer approval for additional work.", partsUsed: "P-1008 x1", delayCategory: "APPROVAL", delayReason: "Awaiting customer approval" },
    { key: "j13", c: "c13", tech: "tech5", v: 2, status: "ON_HOLD", holdMinutes: 600, partsStatus: "NONE", notes: "Lift unavailable; job paused.", partsUsed: "", delayCategory: "FACILITY", delayReason: "Lift unavailable" },
    { key: "j14", c: "c14", tech: "tech4", v: 3, status: "OPEN", holdMinutes: 0, partsStatus: "NONE", notes: "New complaint; awaiting assignment.", partsUsed: "", delayCategory: "", delayReason: "" },
    { key: "j15", c: "c15", tech: "tech6", v: 4, status: "OPEN", holdMinutes: 0, partsStatus: "NONE", notes: "New complaint; awaiting diagnosis.", partsUsed: "", delayCategory: "", delayReason: "" }
  ];
  const jobMap = {};
  const jobSeq = { user1: 0, tech2: 0, tech3: 0, tech4: 0, tech5: 0, tech6: 0 };
  jobDefs.forEach((j, i) => {
    const c = complaintMap[j.c];
    const tech = j.tech;
    jobSeq[tech] = (jobSeq[tech] || 0) + 1;
    const code = "JC-26-" + shortByUser[tech] + "-" + pad(jobSeq[tech], 4);
    const bd = BASE + i * DAY;
    const start = bd + 30 * 60000;
    const completed = j.status === "CLOSED" ? bd + 28 * HOUR : 0;
    const released = completed ? completed + HOUR : 0;
    let gross = 0;
    let hold = j.holdMinutes || 0;
    let active = 0;
    let downtime = 0;
    if (j.status === "CLOSED") {
      gross = Math.round((completed - bd) / 60000);
      active = gross - hold;
      downtime = gross;
    } else if (j.status === "IN_PROGRESS" || j.status === "ON_HOLD") {
      gross = Math.max(hold + 120, 2400 - i * 120);
      active = gross - hold;
      downtime = gross;
    }
    const row = seed("job_cards", "job_code = {:c}", { c: code }, {
      company_id: companyId,
      vehicle_id: vehicleIds[j.v],
      technician_id: userIds[tech],
      hub_id: hubIds.BENG,
      client_id: clientIds[i % clientIds.length],
      status: j.status,
      breakdown_reported_at: iso(bd),
      job_started_at: j.status === "OPEN" ? "" : iso(start),
      job_completed_at: completed ? iso(completed) : "",
      vehicle_released_at: released ? iso(released) : "",
      service_notes: j.notes,
      checklist: "[]",
      parts_used: j.partsUsed,
      plate_source: "OCR",
      ocr_confidence: 0.95,
      delay_category: j.delayCategory,
      delay_reason: j.delayReason,
      interrupted_reason: "",
      resumed_from: "",
      overtime_alerted_at: "",
      client_request_id: "SEED-JOB-" + pad(i + 1, 3),
      gross_tat_minutes: gross,
      total_hold_minutes: hold,
      active_wrench_minutes: active,
      total_downtime_minutes: downtime,
      fiscal_year: FY,
      job_code: code,
      complaint_id: c.id,
      complaint_no: c.no,
      code_version: 3,
      hold_to_stop_minutes: j.status === "ON_HOLD" ? 60 : 0,
      parts_extract_status: j.partsStatus,
      parts_extract_at: j.partsStatus === "DONE" ? iso(bd + 2 * HOUR) : "",
      parts_confirmed_at: j.partsStatus === "DONE" ? iso(bd + 3 * HOUR) : "",
      parts_confirmed_by: j.partsStatus === "DONE" ? userIds.admin : ""
    });
    jobMap[j.key] = {
      id: row.id,
      code: code,
      tech: tech,
      status: j.status,
      vehicleId: vehicleIds[j.v],
      clientId: clientIds[i % clientIds.length],
      complaintId: c.id,
      complaintNo: c.no
    };
  });

  /* ---------------------------------------------------------------- holds */
  const holdDefs = [
    { job: "j1", reason: "WAITING_FOR_SPARES", duration: 120, open: false, notes: "Brake pads out of stock" },
    { job: "j2", reason: "WAITING_APPROVAL", duration: 60, open: false, notes: "Customer approval" },
    { job: "j3", reason: "FACILITY_LIMITATION", duration: 90, open: false, notes: "Lift occupied" },
    { job: "j4", reason: "WAITING_FOR_SPARES", duration: 30, open: false, notes: "Cable procurement" },
    { job: "j5", reason: "WAITING_APPROVAL", duration: 45, open: false, notes: "Warranty approval" },
    { job: "j6", reason: "FACILITY_LIMITATION", duration: 60, open: false, notes: "Bay unavailable" },
    { job: "j11", reason: "WAITING_FOR_SPARES", duration: 1440, open: true, notes: "Awaiting brake pad stock" },
    { job: "j12", reason: "WAITING_APPROVAL", duration: 960, open: true, notes: "Awaiting customer approval" },
    { job: "j13", reason: "FACILITY_LIMITATION", duration: 600, open: true, notes: "Lift unavailable" }
  ];
  const holdMap = {};
  holdDefs.forEach((h) => {
    const job = jobMap[h.job];
    const idx = Number(h.job.slice(1)) - 1;
    const heldAt = BASE + idx * DAY + 2 * HOUR;
    const resumedAt = h.open ? 0 : heldAt + (h.duration || 0) * 60000;
    const row = seed("job_card_holds", "job_card_id = {:j} && held_at = {:h}", { j: job.id, h: iso(heldAt) }, {
      job_card_id: job.id,
      reason: h.reason,
      notes: h.notes,
      held_at: iso(heldAt),
      resumed_at: resumedAt ? iso(resumedAt) : "",
      duration_minutes: h.duration || 0,
      company_id: companyId,
      ist_date: istDate(heldAt)
    });
    holdMap[h.job] = row.id;
  });

  /* ------------------------------------------------------------ job parts */
  const jobPartDefs = [
    { job: "j1", part: "P-1001", qty: 2, status: "BILLED", review: false },
    { job: "j1", part: "P-1007", qty: 1, status: "BILLED", review: false },
    { job: "j2", part: "P-1002", qty: 1, status: "BILLED", review: false },
    { job: "j2", part: "P-1008", qty: 1, status: "BILLED", review: true },
    { job: "j3", part: "P-1003", qty: 1, status: "BILLED", review: false },
    { job: "j3", part: "P-1009", qty: 1, status: "BILLED", review: false },
    { job: "j4", part: "P-1004", qty: 1, status: "BILLED", review: false },
    { job: "j5", part: "P-1005", qty: 1, status: "BILLED", review: false },
    { job: "j6", part: "P-1006", qty: 1, status: "BILLED", review: false },
    { job: "j7", part: "P-1001", qty: 1, status: "UNBILLED", review: true },
    { job: "j8", part: "P-1002", qty: 1, status: "UNBILLED", review: false },
    { job: "j9", part: "P-1007", qty: 1, status: "UNBILLED", review: false },
    { job: "j10", part: "P-1008", qty: 1, status: "UNBILLED", review: true },
    { job: "j11", part: "P-1001", qty: 2, status: "UNBILLED", review: false },
    { job: "j12", part: "P-1008", qty: 1, status: "UNBILLED", review: false },
    { job: "j13", part: "P-1009", qty: 1, status: "UNBILLED", review: false },
    { job: "j14", part: "P-1003", qty: 1, status: "UNBILLED", review: false },
    { job: "j15", part: "P-1004", qty: 1, status: "UNBILLED", review: false }
  ];
  jobPartDefs.forEach((p) => {
    const job = jobMap[p.job];
    seed("job_card_parts", "job_card_id = {:j} && part_code = {:p}", { j: job.id, p: p.part }, {
      company_id: companyId,
      hub_id: hubIds.BENG,
      job_card_id: job.id,
      part_code: p.part,
      qty: p.qty,
      status: p.status,
      locked: false,
      source: "MANUAL",
      import_row_id: "",
      resolved: !p.review,
      revision: 1,
      corrected_by: "",
      corrected_at: "",
      import_batch_id: "",
      model: "Ace Gold",
      confidence: 0.9,
      needs_review: p.review
    });
  });

  /* --------------------------------------------------------------- invoices */
  const invoiceDefs = [
    { job: "j1", status: "PAID", parts: 1200 },
    { job: "j2", status: "PAID", parts: 1800 },
    { job: "j3", status: "PAID", parts: 900 },
    { job: "j4", status: "ISSUED", parts: 1500 },
    { job: "j5", status: "PAID", parts: 2100 },
    { job: "j6", status: "ISSUED", parts: 600 }
  ];
  const invoiceMap = {};
  invoiceDefs.forEach((inv, i) => {
    const job = jobMap[inv.job];
    const labour = 500;
    const consumables = 200;
    const partsTax = Math.round(inv.parts * 0.18);
    const labourTax = Math.round(labour * 0.18);
    const consTax = Math.round(consumables * 0.18);
    const subtotal = inv.parts + labour + consumables;
    const taxTotal = partsTax + labourTax + consTax;
    const total = subtotal + taxTotal;
    const issued = BASE + (i + 5) * DAY;
    const due = issued + 15 * DAY;
    const paid = inv.status === "PAID" ? issued + 2 * DAY : 0;
    const no = "INV-26-" + pad(i + 1, 4);
    const client = clientDefs[i % clientDefs.length];
    const row = seed("invoices", "invoice_no = {:n}", { n: no }, {
      company_id: companyId,
      hub_id: hubIds.BENG,
      job_card_id: job.id,
      client_id: job.clientId,
      vehicle_id: job.vehicleId,
      invoice_no: no,
      status: inv.status,
      customer_name: client.name,
      customer_gstin: "29ABCDE1234F1Z5",
      customer_address: client.addr,
      plate: vehicleDefs[i % vehicleDefs.length].plate,
      currency: "INR",
      labour_amount: labour,
      labour_tax_rate: 18,
      consumables_amount: consumables,
      consumables_tax_rate: 18,
      parts_subtotal: inv.parts,
      parts_tax: partsTax,
      labour_subtotal: labour,
      labour_tax: labourTax,
      consumables_subtotal: consumables,
      consumables_tax: consTax,
      subtotal: subtotal,
      tax_total: taxTotal,
      round_off: 0,
      total: total,
      line_count: 3,
      revision: 1,
      due_date: iso(due),
      issued_at: iso(issued),
      paid_at: paid ? iso(paid) : "",
      cancelled_at: "",
      payment_ref: inv.status === "PAID" ? "UPI-REF-" + (i + 1) : "",
      notes: "Demo invoice",
      source: "MANUAL",
      created_by: userIds.admin
    });
    invoiceMap[inv.job] = row.id;

    seed("invoice_lines", "invoice_id = {:i} && sort_order = {:s}", { i: row.id, s: 1 }, {
      company_id: companyId,
      invoice_id: row.id,
      job_card_id: job.id,
      job_card_part_id: "",
      kind: "PART",
      part_code: "P-1001",
      description: "Brake Pad",
      hsn_code: "8708",
      qty: 2,
      unit_price: Math.round(inv.parts / 2),
      tax_rate: 18,
      line_subtotal: inv.parts,
      line_tax: partsTax,
      line_total: inv.parts + partsTax,
      sort_order: 1
    });
    seed("invoice_lines", "invoice_id = {:i} && sort_order = {:s}", { i: row.id, s: 2 }, {
      company_id: companyId,
      invoice_id: row.id,
      job_card_id: job.id,
      job_card_part_id: "",
      kind: "LABOUR",
      part_code: "",
      description: "Labour charges",
      hsn_code: "9987",
      qty: 1,
      unit_price: labour,
      tax_rate: 18,
      line_subtotal: labour,
      line_tax: labourTax,
      line_total: labour + labourTax,
      sort_order: 2
    });
    seed("invoice_lines", "invoice_id = {:i} && sort_order = {:s}", { i: row.id, s: 3 }, {
      company_id: companyId,
      invoice_id: row.id,
      job_card_id: job.id,
      job_card_part_id: "",
      kind: "CONSUMABLES",
      part_code: "",
      description: "Consumables",
      hsn_code: "9987",
      qty: 1,
      unit_price: consumables,
      tax_rate: 18,
      line_subtotal: consumables,
      line_tax: consTax,
      line_total: consumables + consTax,
      sort_order: 3
    });
  });

  /* ---------------------------------------------------------- repair orders */
  const repairDefs = [
    { job: "j1", stage: "RELEASED", priority: "NORMAL", fault: "Brake noise", diagnosis: "Worn front brake pads", work: "Replaced front brake pads and road tested", est: 1500, act: 1450 },
    { job: "j2", stage: "RELEASED", priority: "HIGH", fault: "Battery drain", diagnosis: "Defective battery", work: "Replaced battery; charging system checked", est: 8000, act: 7800 },
    { job: "j3", stage: "IN_REPAIR", priority: "NORMAL", fault: "Overheating", diagnosis: "Radiator blockage", work: "Radiator flush in progress", est: 2500, act: 0 },
    { job: "j4", stage: "QA", priority: "LOW", fault: "Clutch slip", diagnosis: "Cable adjustment needed", work: "Clutch cable adjusted; QA pending", est: 800, act: 750 }
  ];
  repairDefs.forEach((r, i) => {
    const job = jobMap[r.job];
    const no = "RO-26-" + pad(i + 1, 4);
    seed("repair_orders", "repair_no = {:n}", { n: no }, {
      company_id: companyId,
      hub_id: hubIds.BENG,
      vehicle_id: job.vehicleId,
      job_card_id: job.id,
      technician_id: userIds[job.tech],
      repair_no: no,
      stage: r.stage,
      priority: r.priority,
      reported_fault: r.fault,
      diagnosis: r.diagnosis,
      work_done: r.work,
      vendor: "QEL Workshop",
      estimated_cost: r.est,
      actual_cost: r.act,
      promised_at: iso(BASE + i * DAY + 6 * HOUR),
      started_at: iso(BASE + i * DAY + 7 * HOUR),
      completed_at: r.stage === "RELEASED" ? iso(BASE + i * DAY + 20 * HOUR) : "",
      released_at: r.stage === "RELEASED" ? iso(BASE + i * DAY + 21 * HOUR) : "",
      notes: "Demo repair order",
      client_request_id: "SEED-RO-" + pad(i + 1, 3),
      fiscal_year: FY
    });
  });

  /* -------------------------------------------------------- custody events */
  const custodyDefs = [
    { v: 0, type: "ISSUE", from: "admin", to: "user1", status: "CLOSED" },
    { v: 1, type: "HANDOVER", from: "user1", to: "tech2", status: "ACKNOWLEDGED" },
    { v: 2, type: "RETURN", from: "tech2", to: "admin", status: "CLOSED" },
    { v: 3, type: "GATE_PASS", from: "admin", to: "tech3", status: "OPEN" },
    { v: 4, type: "RELEASE", from: "tech3", to: "admin", status: "CLOSED" }
  ];
  custodyDefs.forEach((c, i) => {
    const jobKey = "j" + (i + 1);
    seed("asset_custody_events", "client_request_id = {:c}", { c: "SEED-CUST-" + pad(i + 1, 3) }, {
      company_id: companyId,
      hub_id: hubIds.BENG,
      vehicle_id: vehicleIds[c.v],
      job_card_id: jobMap[jobKey] ? jobMap[jobKey].id : "",
      repair_order_id: "",
      custody_type: c.type,
      from_user_id: userIds[c.from],
      to_user_id: userIds[c.to],
      from_hub_id: hubIds.BENG,
      to_hub_id: hubIds.BENG,
      odometer: 45000 + i * 100,
      fuel_level: 60 - i * 5,
      condition_notes: "Minor scratch on rear bumper",
      photo: "",
      signature: "",
      occurred_at: iso(BASE + i * DAY + 8 * HOUR),
      status: c.status,
      client_request_id: "SEED-CUST-" + pad(i + 1, 3),
      notes: "Demo custody event",
      fiscal_year: FY
    });
  });

  /* ------------------------------------------------------ dealers / visits */
  const dealerDefs = [
    { code: "DLR-001", name: "Sri Balaji Motors", type: "AUTHORIZED", contact: "Balaji 9876511111" },
    { code: "DLR-002", name: "Ganesh Auto Works", type: "AUTHORIZED", contact: "Ganesh 9876522222" },
    { code: "DLR-003", name: "Metro Fleet Services", type: "FLEET", contact: "Ravi 9876533333" },
    { code: "DLR-004", name: "Highway Motors", type: "AUTHORIZED", contact: "Suresh 9876544444" }
  ];
  const dealerIds = [];
  dealerDefs.forEach((d) => {
    const row = seed("dealers", "dealer_code = {:c}", { c: d.code }, {
      company_id: companyId,
      dealer_code: d.code,
      name: d.name,
      type: d.type,
      contact: d.contact,
      active: true
    });
    dealerIds.push(row.id);
  });

  const locDefs = [
    { dealer: 0, addr: "No. 12, Hosur Road, Bangalore", lat: 12.9010, lng: 77.6100 },
    { dealer: 0, addr: "No. 8, Tumkur Road, Bangalore", lat: 13.0300, lng: 77.5100 },
    { dealer: 1, addr: "No. 45, Old Madras Road, Bangalore", lat: 13.0100, lng: 77.6600 },
    { dealer: 2, addr: "No. 3, Whitefield, Bangalore", lat: 12.9700, lng: 77.7500 },
    { dealer: 3, addr: "No. 22, Electronic City, Bangalore", lat: 12.8450, lng: 77.6600 }
  ];
  const locIds = [];
  locDefs.forEach((l, i) => {
    const qr = "QR-DLR-" + pad(i + 1, 3);
    const row = seed("dealer_locations", "qr_token = {:q}", { q: qr }, {
      dealer_id: dealerIds[l.dealer],
      address: l.addr,
      hub_id: hubIds.BENG,
      active: true,
      latitude: l.lat,
      longitude: l.lng,
      radius_m: 200,
      qr_token: qr
    });
    locIds.push(row.id);
  });

  const visitDefs = [
    { dealer: 0, loc: 0, manager: "mod", type: "ROUTINE", status: "COMPLETED", mode: "APP_QR", outcome: "Stock verified", next: "Next visit in 2 weeks" },
    { dealer: 1, loc: 2, manager: "admin", type: "COMPLAINT", status: "IN_PROGRESS", mode: "WEB_CODE", outcome: "", next: "" },
    { dealer: 2, loc: 3, manager: "mod", type: "AUDIT", status: "PLANNED", mode: "APP_QR", outcome: "", next: "" },
    { dealer: 3, loc: 4, manager: "admin", type: "COLLECTION", status: "COMPLETED", mode: "MANUAL", outcome: "Payment collected", next: "Receipt sent" },
    { dealer: 0, loc: 1, manager: "mod", type: "ROUTINE", status: "PLANNED", mode: "STATIC_QR", outcome: "", next: "" }
  ];
  const visitIds = [];
  visitDefs.forEach((v, i) => {
    const planned = BASE + (i + 2) * DAY + 3 * HOUR;
    const checkIn = v.status === "PLANNED" ? 0 : planned + HOUR;
    const checkOut = v.status === "COMPLETED" ? planned + 3 * HOUR : 0;
    const no = "DV-26-" + pad(i + 1, 4);
    const row = seed("dealer_visits", "visit_no = {:n}", { n: no }, {
      company_id: companyId,
      hub_id: hubIds.BENG,
      dealer_id: dealerIds[v.dealer],
      dealer_location_id: locIds[v.loc],
      manager_id: userIds[v.manager],
      visit_type: v.type,
      status: v.status,
      verification_mode: v.mode,
      planned_at: iso(planned),
      check_in_at: checkIn ? iso(checkIn) : "",
      check_out_at: checkOut ? iso(checkOut) : "",
      check_in_photo: "",
      check_out_photo: "",
      latitude: locDefs[v.loc].lat,
      longitude: locDefs[v.loc].lng,
      address: locDefs[v.loc].addr,
      distance_from_dealer_m: 25,
      notes: "Demo dealer visit",
      outcome: v.outcome,
      next_action: v.next,
      ist_date: istDate(planned),
      duration_minutes: v.status === "COMPLETED" ? 120 : 0,
      client_request_id: "SEED-DV-" + pad(i + 1, 3),
      fiscal_year: FY,
      visit_no: no,
      outside_geofence: false,
      pending_approval: false,
      code: "123456",
      qr_token: "QR-DV-" + pad(i + 1, 3)
    });
    visitIds.push(row.id);
  });

  const codeDefs = [
    { dealer: 0, loc: 0, status: "ACTIVE", visit: -1 },
    { dealer: 1, loc: 1, status: "USED", visit: 0 },
    { dealer: 2, loc: 2, status: "EXPIRED", visit: -1 }
  ];
  codeDefs.forEach((c, i) => {
    const code = "DVC-" + pad(i + 1, 4);
    seed("dealer_visit_codes", "code = {:c}", { c: code }, {
      company_id: companyId,
      dealer_id: dealerIds[c.dealer],
      dealer_location_id: locIds[c.loc],
      code: code,
      qr_payload: "QEL|DVC|" + pad(i + 1, 4),
      issued_for: userIds.admin,
      expires_at: iso(BASE + (i + 3) * DAY),
      used_at: c.status === "USED" ? iso(BASE + 2 * DAY) : "",
      used_by_manager: c.status === "USED" ? userIds.mod : "",
      visit_id: c.visit >= 0 ? visitIds[c.visit] : "",
      status: c.status,
      ist_date: istDate(BASE),
      client_request_id: "SEED-DVC-" + pad(i + 1, 3)
    });
  });

  /* ----------------------------------------------------------------- CAPA */
  const capaDefs = [
    { job: "j11", severity: "HIGH", category: "MATERIAL", status: "INVESTIGATING" },
    { job: "j12", severity: "MEDIUM", category: "PROCESS", status: "ACTION_PLANNED" },
    { job: "j13", severity: "LOW", category: "MACHINE", status: "VERIFIED" }
  ];
  capaDefs.forEach((c, i) => {
    const job = jobMap[c.job];
    const no = "CAPA-26-" + pad(i + 1, 4);
    seed("capa_records", "capa_no = {:n}", { n: no }, {
      job_card_id: job.id,
      root_cause: "Spare availability delay",
      corrective_action: "Expedite spare procurement",
      preventive_action: "Maintain buffer stock",
      verified_by: c.status === "VERIFIED" ? userIds.admin : "",
      status: c.status,
      company_id: companyId,
      hub_id: hubIds.BENG,
      vehicle_id: job.vehicleId,
      technician_id: userIds[job.tech],
      hold_id: holdMap[c.job] || "",
      capa_no: no,
      severity: c.severity,
      root_cause_category: c.category,
      containment_action: "Job kept on hold; customer informed",
      due_date: iso(BASE + (10 + i) * DAY),
      verified_at: c.status === "VERIFIED" ? iso(BASE + 5 * DAY) : "",
      effectiveness_notes: "",
      opened_at: iso(BASE + (i + 2) * DAY),
      closed_at: c.status === "VERIFIED" ? iso(BASE + 6 * DAY) : "",
      notes: "Demo CAPA"
    });
  });

  /* ------------------------------------------------------------ attendance */
  const techUsers = ["user1", "tech2", "tech3", "tech4", "tech5"];
  let attSeq = 0;
  const attProofIds = [];
  techUsers.forEach((u, ui) => {
    for (let d = 0; d < 3; d++) {
      const day = BASE + (9 + d) * DAY;
      const inAt = day;
      const outAt = day + 9 * HOUR;
      ["CheckIn", "CheckOut"].forEach((action) => {
        attSeq++;
        const ts = action === "CheckIn" ? inAt : outAt;
        const auto = action === "CheckOut" && ui === 0 && d === 2;
        const row = seed("attendance", "client_request_id = {:c}", { c: "SEED-ATT-" + pad(attSeq, 4) }, {
          company_id: companyId,
          user_id: userIds[u],
          hub_id: hubIds.BENG,
          action: action,
          timestamp: iso(ts),
          latitude: 12.9353,
          longitude: 77.5970,
          within_geofence: true,
          offline_sync: false,
          hub_name: "Bangalore South Hub",
          photo_proof: "",
          device_uuid: "DEV-" + pad(ui + 1, 2),
          session_id: "SES-" + pad(attSeq, 4),
          gps_accuracy_meters: 8,
          is_mock_provider: false,
          client_request_id: "SEED-ATT-" + pad(attSeq, 4),
          notes: "",
          distance_from_hub_meters: 40,
          status: "Verified",
          fiscal_year: FY,
          ist_date: istDate(ts),
          checkout_photo: "",
          auto_checkout: auto,
          checkout_reason: auto ? "AUTO_EOD" : "MANUAL",
          checkout_source: "APP",
          photo_pending: false,
          shift_minutes: action === "CheckOut" ? 480 : 0,
          job_minutes: action === "CheckOut" ? 300 : 0,
          cards_closed: action === "CheckOut" ? 2 : 0,
          cards_held: action === "CheckOut" ? 1 : 0,
          hold_minutes: action === "CheckOut" ? 45 : 0,
          last_address: "Bangalore, Karnataka"
        });
        if (action === "CheckIn" && attProofIds.length < 2) attProofIds.push(row.id);
      });
    }
  });

  /* ------------------------------------------------------------- telemetry */
  let telSeq = 0;
  techUsers.forEach((u, ui) => {
    for (let t = 0; t < 4; t++) {
      telSeq++;
      const ts = BASE + (8 + t) * DAY + (ui * 2 + t) * HOUR;
      seed("telemetry", "client_request_id = {:c}", { c: "SEED-TEL-" + pad(telSeq, 4) }, {
        company_id: companyId,
        user_id: userIds[u],
        device_uuid: "DEV-" + pad(ui + 1, 2),
        timestamp: iso(ts),
        latitude: 12.9353 + ui * 0.001,
        longitude: 77.5970 + ui * 0.001,
        accuracy_meters: 8,
        distance_meters: 30 + ui * 40,
        zone: ui % 2 === 0 ? "INSIDE" : "OUTSIDE",
        battery_pct: 90 - t * 5,
        is_mock_provider: false,
        source: "APP",
        client_request_id: "SEED-TEL-" + pad(telSeq, 4),
        fiscal_year: FY
      });
    }
  });

  /* ------------------------------------------------------ roaming requests */
  const roamDefs = [
    { user: "tech2", type: "PUNCH_IN", status: "APPROVED", notes: "Client site visit" },
    { user: "tech3", type: "PUNCH_OUT", status: "PENDING", notes: "Late return" },
    { user: "tech4", type: "TRANSIT", status: "APPROVED", notes: "Road test" }
  ];
  roamDefs.forEach((r, i) => {
    const ts = BASE + (i + 1) * DAY + 2 * HOUR;
    seed("roaming_requests", "client_request_id = {:c}", { c: "SEED-ROAM-" + pad(i + 1, 3) }, {
      company_id: companyId,
      user_id: userIds[r.user],
      hub_id: hubIds.BENG,
      request_type: r.type,
      ist_date: istDate(ts),
      status: r.status,
      latitude: 12.95,
      longitude: 77.61,
      distance_from_hub_meters: 1200 + i * 200,
      accuracy_meters: 12,
      notes: r.notes,
      requested_at: iso(ts),
      approved_by: r.status === "APPROVED" ? userIds.admin : "",
      approved_at: r.status === "APPROVED" ? iso(ts + HOUR) : "",
      approver_name: r.status === "APPROVED" ? "admin" : "",
      client_request_id: "SEED-ROAM-" + pad(i + 1, 3)
    });
  });

  /* ------------------------------------------------------------ part issues */
  const issueDefs = [
    { job: "j1", part: "P-1001", qty: 2 },
    { job: "j2", part: "P-1002", qty: 1 },
    { job: "j3", part: "P-1003", qty: 1 },
    { job: "j4", part: "P-1004", qty: 1 },
    { job: "j5", part: "P-1005", qty: 1 }
  ];
  issueDefs.forEach((x, i) => {
    const job = jobMap[x.job];
    seed("part_issues", "job_card_id = {:j} && part_code = {:p}", { j: job.id, p: x.part }, {
      company_id: companyId,
      hub_id: hubIds.BENG,
      job_card_id: job.id,
      part_code: x.part,
      qty: x.qty,
      status: "BILLED",
      issued_at: iso(BASE + i * DAY + 3 * HOUR),
      actor_id: userIds.admin
    });
  });

  /* --------------------------------------------------------- usage / ledger */
  const usageDefs = [
    { date: 12, part: "P-1001", qty: 2, jobs: 1, vehicles: 1 },
    { date: 12, part: "P-1007", qty: 1, jobs: 1, vehicles: 1 },
    { date: 13, part: "P-1002", qty: 1, jobs: 1, vehicles: 1 },
    { date: 14, part: "P-1003", qty: 1, jobs: 1, vehicles: 1 },
    { date: 15, part: "P-1004", qty: 1, jobs: 1, vehicles: 1 },
    { date: 16, part: "P-1005", qty: 1, jobs: 1, vehicles: 1 },
    { date: 17, part: "P-1006", qty: 2, jobs: 1, vehicles: 1 },
    { date: 18, part: "P-1008", qty: 1, jobs: 1, vehicles: 1 },
    { date: 19, part: "P-1009", qty: 1, jobs: 1, vehicles: 1 },
    { date: 20, part: "P-1010", qty: 3, jobs: 2, vehicles: 2 }
  ];
  usageDefs.forEach((u) => {
    const d = BASE + u.date * DAY;
    seed("part_usage_daily", "hub_id = {:h} && ist_date = {:d} && part_code = {:p}", { h: hubIds.BENG, d: istDate(d), p: u.part }, {
      company_id: companyId,
      hub_id: hubIds.BENG,
      ist_date: istDate(d),
      part_code: u.part,
      model: "Ace Gold",
      historical: false,
      qty: u.qty,
      jobs: u.jobs,
      vehicles: u.vehicles
    });
  });

  const ledgerDefs = [
    { date: 12, part: "P-1001", type: "ISSUE", delta: -2, after: 18, job: "j1" },
    { date: 12, part: "P-1007", type: "ISSUE", delta: -1, after: 19, job: "j1" },
    { date: 13, part: "P-1002", type: "ISSUE", delta: -1, after: 9, job: "j2" },
    { date: 14, part: "P-1003", type: "ISSUE", delta: -1, after: 7, job: "j3" },
    { date: 15, part: "P-1004", type: "ISSUE", delta: -1, after: 12, job: "j4" },
    { date: 16, part: "P-1005", type: "ISSUE", delta: -1, after: 3, job: "j5" },
    { date: 17, part: "P-1006", type: "ISSUE", delta: -2, after: 8, job: "j6" },
    { date: 18, part: "P-1008", type: "ISSUE", delta: -1, after: 6, job: "j12" },
    { date: 19, part: "P-1009", type: "ISSUE", delta: -1, after: 4, job: "j13" },
    { date: 20, part: "P-1001", type: "RECEIPT", delta: 10, after: 28, job: "" }
  ];
  ledgerDefs.forEach((l, i) => {
    const d = BASE + l.date * DAY;
    seed("stock_ledger", "client_request_id = {:c}", { c: "SEED-LEDGER-" + pad(i + 1, 3) }, {
      company_id: companyId,
      hub_id: hubIds.BENG,
      part_code: l.part,
      ist_date: istDate(d),
      movement_type: l.type,
      qty_delta: l.delta,
      qty_after: l.after,
      reason: l.type === "ISSUE" ? "Job issue" : "Purchase receipt",
      note: "Demo stock movement",
      ref_collection: l.job ? "job_cards" : "",
      ref_id: l.job ? jobMap[l.job].id : "",
      actor_id: userIds.admin,
      client_request_id: "SEED-LEDGER-" + pad(i + 1, 3),
      created: iso(d + 4 * HOUR)
    });
  });

  const replDefs = [
    { part: "P-1005", current: 3, priority: "CRITICAL", status: "OPEN" },
    { part: "P-1009", current: 4, priority: "HIGH", status: "ACK" },
    { part: "P-1008", current: 6, priority: "NORMAL", status: "OPEN" },
    { part: "P-1003", current: 7, priority: "NORMAL", status: "APPROVED" }
  ];
  replDefs.forEach((r, i) => {
    const d = BASE + (i + 2) * DAY;
    seed("replenishment_requests", "hub_id = {:h} && part_code = {:p} && notes = {:n}", { h: hubIds.BENG, p: r.part, n: "[SEED] Low stock " + r.part }, {
      company_id: companyId,
      hub_id: hubIds.BENG,
      part_code: r.part,
      current_qty: r.current,
      on_order: 0,
      reorder_point: 5,
      suggested_qty: 20,
      priority: r.priority,
      status: r.status,
      assigned_to: userIds.admin,
      source: "AUTO",
      raised_at: iso(d),
      due_at: iso(d + 5 * DAY),
      resolved_at: "",
      notes: "[SEED] Low stock " + r.part,
      last_notified_at: iso(d)
    });
  });

  /* -------------------------------------------------------------- reminders */
  const remDefs = [
    { user: "admin", title: "Review low stock", note: "Approve replenishment for brake pads", at: BASE + 2 * DAY, status: "Pending" },
    { user: "user1", title: "Follow up job JC-26-TEC1-0003", note: "Customer awaiting update", at: BASE + 3 * DAY, status: "Pending" },
    { user: "mod", title: "Dealer visit audit", note: "Audit Sri Balaji Motors visit", at: BASE + 4 * DAY, status: "Done" }
  ];
  remDefs.forEach((r) => {
    seed("reminders", "user_id = {:u} && title = {:t}", { u: userIds[r.user], t: r.title }, {
      company_id: companyId,
      user_id: userIds[r.user],
      title: r.title,
      note: r.note,
      reminder_at: iso(r.at),
      status: r.status
    });
  });

  /* -------------------------------------------------------------- workflows */
  const wfDefs = [
    { code: "WF-001", title: "Job Card Closure", category: "OPERATIONS", content: "1. Verify parts used.\n2. Capture end proof photo.\n3. Confirm customer handover.\n4. Close job card.", role: "Technician" },
    { code: "WF-002", title: "Dealer Visit", category: "SALES", content: "1. Scan dealer QR.\n2. Verify stock.\n3. Record outcome.\n4. Submit visit report.", role: "Moderator" },
    { code: "WF-003", title: "Invoice Approval", category: "FINANCE", content: "1. Review parts and labour.\n2. Apply GST.\n3. Issue invoice.\n4. Record payment.", role: "Administrator" }
  ];
  wfDefs.forEach((w) => {
    seed("workflows", "doc_code = {:c}", { c: w.code }, {
      company_id: companyId,
      doc_code: w.code,
      title: w.title,
      category: w.category,
      content: w.content,
      min_role: w.role,
      commercial_details: ""
    });
  });

  /* ---------------------------------------------------------- form registry */
  const formDefs = [
    { code: "FR-001", form: "Job Card", key: "service_notes", label: "Service Notes", control: "TEXTAREA", role: "Technician" },
    { code: "FR-002", form: "Job Card", key: "checklist", label: "Checklist", control: "JSON", role: "Technician" },
    { code: "FR-003", form: "Attendance", key: "notes", label: "Attendance Notes", control: "TEXT", role: "Technician" },
    { code: "FR-004", form: "Dealer Visit", key: "outcome", label: "Visit Outcome", control: "TEXTAREA", role: "Moderator" },
    { code: "FR-005", form: "Invoice", key: "notes", label: "Invoice Notes", control: "TEXT", role: "Administrator" }
  ];
  formDefs.forEach((f) => {
    seed("forms_registry", "form_code = {:c} && field_key = {:k}", { c: f.code, k: f.key }, {
      company_id: companyId,
      form_code: f.code,
      form_name: f.form,
      field_key: f.key,
      label: f.label,
      control_type: f.control,
      validation_regex: "",
      options: "",
      min_role: f.role
    });
  });

  /* --------------------------------------------------------------- settings */
  const settings = {
    company_name: "QEL Service Hub",
    company_gstin: "29ABCDE1234F1Z5",
    company_address: "No. 42, Industrial Layout, Bangalore 560068",
    company_phone: "+91 80 4123 4567",
    company_email: "support@qelservicehub.in",
    invoice_prefix: "INV",
    invoice_due_days: "15",
    labour_rate: "500",
    consumables_rate: "200",
    tax_rate: "18",
    job_sla_hours: "24",
    hold_alert_minutes: "120",
    attendance_radius_m: "250",
    geofence_buffer_m: "50",
    breach_grace_minutes: "10",
    auto_checkout_enabled: "true",
    photo_required: "true",
    voice_enabled: "true",
    parts_extract_enabled: "true",
    billing_enabled: "true",
    dealer_visits_enabled: "true",
    whatsapp_number: "+91 90000 12345",
    smtp_host: "smtp.example.com",
    smtp_port: "587",
    smtp_user: "notifications@qelservicehub.in",
    smtp_pass: "demo-smtp-pass",
    smtp_from: "QEL Service Hub <notifications@qelservicehub.in>",
    payment_gateway: "razorpay",
    payment_key: "rzp_test_demo_key",
    payment_secret: "demo-secret",
    currency: "INR",
    timezone: "Asia/Kolkata",
    fiscal_year_start: "04-01",
    parts_low_stock_threshold: "5",
    dealer_visit_radius_m: "200",
    proof_watermark_version: "v1",
    public_base_url: "https://fieldops-demo.onrender.com"
  };
  Object.keys(settings).forEach((k) => {
    seed("settings", "key = {:k}", { k: k }, {
      company_id: companyId,
      key: k,
      value: String(settings[k])
    });
  });

  /* ----------------------------------------------------------- notifications */
  const notifDefs = [
    { user: "user1", type: "JOB_ASSIGNED", title: "New job assigned", body: "JC-26-TEC1-0001 assigned to you", ref: "job_cards", refId: jobMap.j1.id, priority: "HIGH", status: "UNREAD", date: 10 },
    { user: "user1", type: "HOLD_ALERT", title: "Job on hold", body: "JC-26-TEC1-0004 is on hold for spares", ref: "job_cards", refId: jobMap.j11.id, priority: "HIGH", status: "UNREAD", date: 18 },
    { user: "admin", type: "JOB_OVERDUE", title: "Overdue job", body: "JC-26-TEC2-0004 exceeded SLA", ref: "job_cards", refId: jobMap.j12.id, priority: "HIGH", status: "UNREAD", date: 19 },
    { user: "admin", type: "PART_LOW_STOCK", title: "Low stock alert", body: "P-1005 is below reorder point", ref: "parts_master", refId: "", priority: "NORMAL", status: "UNREAD", date: 20 },
    { user: "admin", type: "INVOICE_PAID", title: "Invoice paid", body: "INV-26-0001 marked paid", ref: "invoices", refId: invoiceMap.j1, priority: "LOW", status: "READ", date: 17 },
    { user: "mod", type: "DEALER_VISIT", title: "Dealer visit completed", body: "Sri Balaji Motors visit completed", ref: "dealer_visits", refId: visitIds[0], priority: "NORMAL", status: "READ", date: 15 },
    { user: "user1", type: "ATTENDANCE_REMINDER", title: "Check-in reminder", body: "Please check in at Bangalore South Hub", ref: "attendance", refId: "", priority: "NORMAL", status: "ACTED", date: 21 },
    { user: "admin", type: "SETTINGS_UPDATED", title: "Settings updated", body: "Invoice prefix changed to INV", ref: "settings", refId: "", priority: "LOW", status: "READ", date: 12 },
    { user: "tech2", type: "JOB_ASSIGNED", title: "New job assigned", body: "JC-26-TEC2-0001 assigned to you", ref: "job_cards", refId: jobMap.j2.id, priority: "NORMAL", status: "READ", date: 11 },
    { user: "tech3", type: "JOB_ASSIGNED", title: "New job assigned", body: "JC-26-TEC3-0001 assigned to you", ref: "job_cards", refId: jobMap.j3.id, priority: "NORMAL", status: "READ", date: 12 },
    { user: "mod", type: "JOB_ON_HOLD", title: "Job on hold", body: "JC-26-TEC3-0001 is on hold", ref: "job_cards", refId: jobMap.j13.id, priority: "NORMAL", status: "UNREAD", date: 20 },
    { user: "admin", type: "REPLENISHMENT", title: "Replenishment raised", body: "P-1005 needs replenishment", ref: "replenishment_requests", refId: "", priority: "NORMAL", status: "UNREAD", date: 21 }
  ];
  notifDefs.forEach((n) => {
    seed("notifications", "title = {:t} && body = {:b}", { t: n.title, b: n.body }, {
      company_id: companyId,
      user_id: userIds[n.user],
      type: n.type,
      title: n.title,
      body: n.body,
      ref_collection: n.ref,
      ref_id: n.refId,
      priority: n.priority,
      status: n.status,
      ist_date: "2026-11-" + pad(n.date, 2),
      created: iso(BASE + (n.date - 10) * DAY + 5 * HOUR)
    });
  });

  /* -------------------------------------------------------------- audit logs */
  const auditDefs = [
    { user: "admin", type: "LOGIN", details: "[SEED] admin logged in", flag: false, date: 10 },
    { user: "user1", type: "LOGIN", details: "[SEED] user1 logged in", flag: false, date: 10 },
    { user: "user1", type: "CHECK_IN", details: "[SEED] user1 checked in at BENG", flag: false, date: 19 },
    { user: "user1", type: "JOB_CREATED", details: "[SEED] Job JC-26-TEC1-0001 created", flag: false, date: 10 },
    { user: "user1", type: "JOB_STARTED", details: "[SEED] Job JC-26-TEC1-0001 started", flag: false, date: 10 },
    { user: "user1", type: "JOB_COMPLETED", details: "[SEED] Job JC-26-TEC1-0001 completed", flag: false, date: 11 },
    { user: "tech2", type: "JOB_CREATED", details: "[SEED] Job JC-26-TEC2-0001 created", flag: false, date: 11 },
    { user: "tech2", type: "JOB_COMPLETED", details: "[SEED] Job JC-26-TEC2-0001 completed", flag: false, date: 12 },
    { user: "tech3", type: "JOB_CREATED", details: "[SEED] Job JC-26-TEC3-0001 created", flag: false, date: 12 },
    { user: "tech3", type: "JOB_COMPLETED", details: "[SEED] Job JC-26-TEC3-0001 completed", flag: false, date: 13 },
    { user: "user1", type: "JOB_ON_HOLD", details: "[SEED] Job JC-26-TEC1-0004 put on hold", flag: true, date: 18 },
    { user: "tech2", type: "JOB_ON_HOLD", details: "[SEED] Job JC-26-TEC2-0004 put on hold", flag: true, date: 19 },
    { user: "tech5", type: "JOB_ON_HOLD", details: "[SEED] Job JC-26-TEC5-0001 put on hold", flag: true, date: 20 },
    { user: "admin", type: "PART_ISSUED", details: "[SEED] Part P-1001 issued to JC-26-TEC1-0001", flag: false, date: 10 },
    { user: "admin", type: "INVOICE_ISSUED", details: "[SEED] Invoice INV-26-0001 issued", flag: false, date: 15 },
    { user: "admin", type: "INVOICE_PAID", details: "[SEED] Invoice INV-26-0001 paid", flag: false, date: 17 },
    { user: "mod", type: "DEALER_VISIT_CHECKIN", details: "[SEED] Dealer visit DV-26-0001 checked in", flag: false, date: 12 },
    { user: "mod", type: "DEALER_VISIT_CHECKOUT", details: "[SEED] Dealer visit DV-26-0001 completed", flag: false, date: 12 },
    { user: "admin", type: "SETTINGS_UPDATED", details: "[SEED] Invoice prefix updated", flag: false, date: 12 },
    { user: "user1", type: "CHECK_OUT", details: "[SEED] user1 checked out from BENG", flag: false, date: 19 },
    { user: "tech2", type: "CHECK_IN", details: "[SEED] tech2 checked in at BENG", flag: false, date: 19 },
    { user: "tech2", type: "CHECK_OUT", details: "[SEED] tech2 checked out from BENG", flag: false, date: 19 },
    { user: "tech3", type: "CHECK_IN", details: "[SEED] tech3 checked in at BENG", flag: false, date: 19 },
    { user: "tech3", type: "CHECK_OUT", details: "[SEED] tech3 checked out from BENG", flag: false, date: 19 },
    { user: "admin", type: "REPLENISHMENT_RAISED", details: "[SEED] Replenishment raised for P-1005", flag: false, date: 21 }
  ];
  auditDefs.forEach((a) => {
    seed("audit_logs", "details = {:d}", { d: a.details }, {
      company_id: companyId,
      timestamp: iso(BASE + (a.date - 10) * DAY + 6 * HOUR),
      user_id: userIds[a.user],
      activity_type: a.type,
      details: a.details,
      disruption_flag: a.flag,
      fiscal_year: FY
    });
  });

  /* ------------------------------------------------------------ proof files */
  const proofDefs = [
    { job: "j1", kind: "JOB_START", field: "start_proof_photo", file: "job_start_JC-26-TEC1-0001.jpg", user: "user1", date: 10 },
    { job: "j1", kind: "JOB_END", field: "end_proof_photo", file: "job_end_JC-26-TEC1-0001.jpg", user: "user1", date: 11 },
    { job: "j2", kind: "JOB_START", field: "start_proof_photo", file: "job_start_JC-26-TEC2-0001.jpg", user: "tech2", date: 11 },
    { job: "j2", kind: "JOB_END", field: "end_proof_photo", file: "job_end_JC-26-TEC2-0001.jpg", user: "tech2", date: 12 },
    { job: "j3", kind: "JOB_START", field: "start_proof_photo", file: "job_start_JC-26-TEC3-0001.jpg", user: "tech3", date: 12 },
    { job: "j3", kind: "JOB_END", field: "end_proof_photo", file: "job_end_JC-26-TEC3-0001.jpg", user: "tech3", date: 13 },
    { job: "j4", kind: "JOB_START", field: "start_proof_photo", file: "job_start_JC-26-TEC1-0002.jpg", user: "user1", date: 13 },
    { job: "j4", kind: "JOB_END", field: "end_proof_photo", file: "job_end_JC-26-TEC1-0002.jpg", user: "user1", date: 14 }
  ];
  proofDefs.forEach((p, i) => {
    const job = jobMap[p.job];
    const ts = BASE + (p.date - 10) * DAY + HOUR;
    seed("proof_files", "filename = {:f}", { f: p.file }, {
      company_id: companyId,
      collection_name: "job_cards",
      record_id: job.id,
      field_name: p.field,
      kind: p.kind,
      filename: p.file,
      original_name: "IMG_" + pad(i + 1, 4) + ".jpg",
      mime_type: "image/jpeg",
      bytes: 120000 + i * 1000,
      latitude: 12.9353,
      longitude: 77.5970,
      accuracy_m: 8,
      distance_from_hub_m: 40,
      zone: "INSIDE",
      is_mock: false,
      ist_date: istDate(ts),
      captured_at: iso(ts),
      watermark_version: "v1",
      watermark_lines: "QEL Service Hub | Bangalore | " + istDate(ts),
      metadata_json: { source: "app", watermark: true },
      visibility: "INTERNAL",
      sha256: "a3f5c9e1b7d24860a3f5c9e1b7d24860a3f5c9e1b7d24860a3f5c9e1b7d24860",
      job_code: job.code,
      complaint_no: job.complaintNo,
      region_code: "RG2",
      hub_code: "BENG",
      engineer_code: shortByUser[job.tech],
      uploader_id: userIds[p.user],
      archived_at: "",
      deleted_at: ""
    });
  });
  attProofIds.forEach((id, i) => {
    const ts = BASE + (9 + i) * DAY;
    const file = "attendance_checkin_" + pad(i + 1, 2) + ".jpg";
    seed("proof_files", "filename = {:f}", { f: file }, {
      company_id: companyId,
      collection_name: "attendance",
      record_id: id,
      field_name: "photo_proof",
      kind: "CHECK_IN",
      filename: file,
      original_name: "ATT_" + pad(i + 1, 4) + ".jpg",
      mime_type: "image/jpeg",
      bytes: 90000 + i * 1000,
      latitude: 12.9353,
      longitude: 77.5970,
      accuracy_m: 8,
      distance_from_hub_m: 40,
      zone: "INSIDE",
      is_mock: false,
      ist_date: istDate(ts),
      captured_at: iso(ts),
      watermark_version: "v1",
      watermark_lines: "QEL Service Hub | Bangalore | " + istDate(ts),
      metadata_json: { source: "app", watermark: true },
      visibility: "INTERNAL",
      sha256: "b4e6d0f2c8e35971b4e6d0f2c8e35971b4e6d0f2c8e35971b4e6d0f2c8e35971",
      job_code: "",
      complaint_no: "",
      region_code: "RG2",
      hub_code: "BENG",
      engineer_code: "TEC1",
      uploader_id: userIds.user1,
      archived_at: "",
      deleted_at: ""
    });
  });

  /* --------------------------------------------------------------- captures */
  const capDefs = [
    { user: "user1", plate: "KA01AB1234", job: "j1", date: 10 },
    { user: "tech2", plate: "KA02CD5678", job: "j2", date: 11 },
    { user: "tech3", plate: "KA03EF9012", job: "j3", date: 12 },
    { user: "user1", plate: "KA04GH3456", job: "j7", date: 17 },
    { user: "tech2", plate: "KA05IJ7890", job: "j8", date: 18 }
  ];
  capDefs.forEach((c, i) => {
    const job = jobMap[c.job];
    seed("captures", "capture_code = {:c}", { c: "CAP-26-" + pad(i + 1, 4) }, {
      company_id: companyId,
      capture_code: "CAP-26-" + pad(i + 1, 4),
      user_id: userIds[c.user],
      device_uuid: "DEV-01",
      plate_no: c.plate,
      plate_raw: c.plate,
      confidence: 0.91,
      source: "OCR",
      captured_at: iso(BASE + (c.date - 10) * DAY + HOUR),
      job_card_id: job ? job.id : "",
      photo: "",
      anomaly_flags: "",
      client_request_id: "SEED-CAP-" + pad(i + 1, 3),
      fiscal_year: FY
    });
  });

  /* ------------------------------------------------------ sequence counters */
  ["TEC1", "TEC2", "TEC3", "TEC4", "TEC5", "TEC6"].forEach((short) => {
    seed("sequence_counters", "key = {:k}", { k: "job:2026:" + short }, {
      key: "job:2026:" + short,
      value: 100,
      scope: "job_cards:" + short,
      ist_date: "2026-11-22"
    });
  });

}, (db) => {
  // Demo seed data: no downgrade.
});
