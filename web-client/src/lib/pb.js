/**
 * PocketBase adapter for the FieldOps portal.
 *
 * All portal actions route through here to the PocketBase deployment
 * (e.g. Hugging Face Space at https://<space>.hf.space):
 *   - /api/fieldops/*     custom hook routes (auth, directory, admin)
 *   - /api/collections/*  PocketBase REST (demo-open rules)
 */
import { getApiBaseUrl } from '../config.js';
import { sha256Hex, deviceUuid, clientRequestId, todayISO } from './utils.js';

export class PbError extends Error {
  constructor(message, response) {
    super(message);
    this.name = 'PbError';
    this.response = response;
  }
}

function fail(res, fallback) {
  throw new PbError((res && (res.message || res.data && res.data.message)) || fallback, res || {});
}

export function normalizeBase(url) {
  return String(url || getApiBaseUrl() || '').trim().replace(/\/+$/, '');
}

export async function pbFetch(path, { method = 'GET', body, headers = {}, base } = {}) {
  const base_ = normalizeBase(base);
  if (!base_) throw new PbError('No PocketBase URL set. Enter it on the login screen.');
  let res;
  try {
    res = await fetch(base_ + path, {
      method,
      headers: body instanceof FormData
        ? headers
        : Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: body instanceof FormData ? body : (body !== undefined ? JSON.stringify(body) : undefined)
    });
  } catch (err) {
    throw new PbError('Network error — check the PocketBase URL and your connection.');
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* maybe empty */ }
  return { res, data, ok: res.ok, status: res.status };
}

function esc(v) {
  return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function list(name, query = {}) {
  const params = new URLSearchParams();
  if (query.filter) params.set('filter', query.filter);
  if (query.expand) params.set('expand', query.expand);
  if (query.sort) params.set('sort', query.sort);
  params.set('page', String(query.page || 1));
  params.set('perPage', String(query.perPage || 200));
  const { data, ok, status } = await pbFetch(`/api/collections/${name}/records?${params.toString()}`);
  if (!ok) return { items: [] };
  return data || { items: [] };
}

async function findBy(collection, field, value) {
  const res = await list(collection, { filter: `${field} = "${esc(value)}"`, perPage: 1 });
  return (res.items || [])[0] || null;
}

async function create(name, body) {
  const { data, ok, status } = await pbFetch(`/api/collections/${name}/records`, { method: 'POST', body });
  if (!ok) fail({ message: `Create ${name} failed (HTTP ${status}). ${data && data.message || ''}` });
  return data;
}

async function patch(name, id, body) {
  const { data, ok, status } = await pbFetch(`/api/collections/${name}/records/${id}`, { method: 'PATCH', body });
  if (!ok) fail({ message: `Update ${name} failed (HTTP ${status}). ${data && data.message || ''}` });
  return data;
}

function fileUrl(collection, recordId, filename) {
  if (!recordId || !filename) return '';
  return `${normalizeBase()}/api/files/${collection}/${recordId}/${encodeURIComponent(filename)}`;
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl || '').split(',');
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* ---------------------------------------------------- legacy status maps */

const TO_PB = {
  InProgress: 'IN_PROGRESS', Completed: 'CLOSED', Delayed: 'IN_PROGRESS',
  Interrupted: 'IN_PROGRESS', Cancelled: 'CANCELLED',
  HoldRequested: 'ON_HOLD', OnHold: 'ON_HOLD'
};
const TO_LEGACY = {
  OPEN: 'Delayed', IN_PROGRESS: 'InProgress', ON_HOLD: 'OnHold',
  CLOSED: 'Completed', CANCELLED: 'Cancelled'
};

function mapCat(cat) {
  const c = String(cat || '');
  if (/spare|parts/i.test(c)) return 'WAITING_FOR_SPARES';
  if (/approv/i.test(c)) return 'WAITING_APPROVAL';
  return 'FACILITY_LIMITATION';
}

/* --------------------------------------------------------- runtime caches */

let dirCache = null;
let dirFetchedAt = 0;

async function directory(force) {
  const fresh = Date.now() - dirFetchedAt < 30000;
  if (!force && dirCache && fresh) return dirCache;
  const { data } = await pbFetch('/api/fieldops/directory', {
    method: 'POST',
    body: { sessionToken: currentToken() }
  });
  if (!data || !data.success) return dirCache || { users: [], hubs: [], regions: [], clients: [] };
  dirCache = data;
  dirFetchedAt = Date.now();
  return data;
}

const session = { token: '' };
export function currentToken() {
  if (session.token) return session.token;
  try {
    const saved = JSON.parse(localStorage.getItem('fieldops_session') || 'null');
    if (saved && saved.token) session.token = saved.token;
  } catch (_) {}
  return session.token || '';
}
export function setToken(t) { session.token = t || ''; }

async function findUserByName(username) {
  const d = await directory();
  return (d.users || []).find((u) => u.username === username) || null;
}

async function findHubByName(name) {
  const d = await directory();
  return (d.hubs || []).find((h) => h.name === name || h.hub_code === name) || null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function jobProof(collection, recordId, field) {
  const filename = String(field || '');
  return filename ? fileUrl(collection, recordId, filename) : '';
}

function docketRow(d) {
  return {
    id: d.id || '',
    docketNo: d.docket_no || '',
    docketType: d.docket_type || '',
    docketDate: d.docket_date || '',
    partCode: d.part_code || '',
    partName: d.part_name || '',
    partSerial: d.part_serial || '',
    partSpec: d.part_spec || '',
    qty: num(d.qty),
    supplier: d.supplier || '',
    fromHub: d.from_hub || '',
    toHub: d.to_hub || '',
    trackingNo: d.tracking_no || '',
    status: d.status || '',
    receivedAt: d.received_at || '',
    issuedAt: d.issued_at || '',
    returnedAt: d.returned_at || '',
    notes: d.notes || ''
  };
}

function joinStatus(task) {
  const vehicle = (task.expand && task.expand.vehicle_id) || {};
  const recordId = task.id || '';
  return {
    recordId,
    jobId: task.job_code,
    complaintNo: task.complaint_no || '',
    jobType: task.job_type || 'FIELD_SERVICE',
    vehicleNo: vehicle.plate_no || '',
    vin: task.vin || vehicle.vin || '',
    vehicleModel: task.vehicle_model || vehicle.model || '',
    client: (task.expand && task.expand.client_id && task.expand.client_id.name) || '',
    assignedUserId: (task.expand && task.expand.technician_id && task.expand.technician_id.username) || '',
    status: TO_LEGACY[task.status] || task.status,
    rawStatus: task.status || '',
    startTime: task.job_started_at || '',
    endTime: task.job_completed_at || '',
    repairReceivedAt: task.repair_received_at || '',
    repairCompletedAt: task.repair_completed_at || '',
    turnaroundMinutes: Number(task.gross_tat_minutes) || 0,
    repairTatMinutes: num(task.repair_tat_minutes),
    downtimeMinutes: Number(task.total_downtime_minutes) || 0,
    holdMinutes: Number(task.total_hold_minutes) || 0,
    wrenchMinutes: Number(task.active_wrench_minutes) || 0,
    startOdometer: num(task.start_odometer),
    endOdometer: num(task.end_odometer),
    odometerUnit: task.odometer_unit || 'km',
    startProof: jobProof('job_cards', recordId, task.start_proof_photo),
    endProof: jobProof('job_cards', recordId, task.end_proof_photo),
    holdCategory: task.delay_category || '',
    holdReason: task.delay_reason || '',
    holdApprovedBy: task.delay_reason || '',
    plateSource: task.plate_source || '',
    partCode: task.part_code || '',
    partName: task.part_name || '',
    partSerial: task.part_serial || '',
    partSupplier: task.part_supplier || '',
    warrantyStatus: task.warranty_status || '',
    customerVoice: task.customer_voice || '',
    updatedBy: '', updatedByName: '', updatedAt: task.updated, version: task.updated ? 2 : 1,
    holdToStopMinutes: Number(task.hold_to_stop_minutes) || 0,
    partsExtractStatus: task.parts_extract_status || 'NONE',
    dockets: [],
    docketNo: '',
    holdStartedAt: task.status === 'ON_HOLD' ? (task.updated || '') : ''
  };
}

function toVehicle(v, hubs) {
  const hub = (hubs || []).find((h) => h.id === v.hub_id);
  return {
    plateNo: v.plate_no, display: v.plate_no || v.vin || v.id,
    hub: hub ? hub.name : (v.hub_id || ''),
    status: v.status === 'Active' ? 'Active' : v.status,
    make: v.make, model: v.model, notes: v.notes,
    assignedUserId: v.assigned_user_id || '',
    anomalyFlags: String(v.anomaly_flags || '').split(',').filter(Boolean)
  };
}

/* -------------------------------------------------------------- the API */

export async function pbLogin(username, password, base, force) {
  const passwordHash = (await sha256Hex(password)).toLowerCase();
  const { data, ok, status } = await pbFetch('/api/fieldops/login', {
    method: 'POST',
    body: { username: String(username).trim(), passwordHash, deviceUUID: deviceUuid(), forceTakeover: Boolean(force) },
    base
  });
  if (status === 409 && data && data.sessionConflict) {
    const err = new PbError(data.message || 'Session conflict.', data);
    err.response = data;
    throw err;
  }
  if (!ok || !data || !data.success) fail(data, 'Login failed.');

  const u = data.user || {};
  let hubName = '';
  try {
    const d = await pbFetch('/api/fieldops/directory', {
      method: 'POST', body: { sessionToken: data.sessionToken }, base
    });
    if (d.data && d.data.success) {
      const h = (d.data.hubs || []).find((x) => x.id === u.hubId);
      hubName = h ? h.name : '';
    }
  } catch (_) { /* optional join */ }

  const rights = String(u.moduleRights || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  return {
    ok: true,
    sessionToken: data.sessionToken,
    userId: u.id,
    username: u.username,
    fullName: u.userCode && u.username ? u.username : (u.username || ''),
    businessCategory: '',
    role: u.role,
    scope: u.scope || 'SELF',
    hub: hubName || u.hubId || '',
    moduleRights: rights,
    expiresAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    checkedIn: false
  };
}

export async function pbLogout() {
  try {
    await pbFetch('/api/fieldops/logout', { method: 'POST', body: { sessionToken: currentToken() } });
  } catch (_) { /* ignore */ }
  return { ok: true, loggedOut: true };
}

/* Maps portal actions to PocketBase calls. */
export async function pbCall(action, payload = {}) {
  switch (action) {
    case 'login': {
      const res = await pbLogin(payload.username, payload.password, getApiBaseUrl());
      setToken(res.sessionToken);
      return res;
    }
    case 'logout':
      return pbLogout();

    /* ---- jobs ---- */
    case 'getTasks': {
      const f = [];
      if (payload.status && TO_PB[payload.status]) f.push(`status = "${TO_PB[payload.status]}"`);
      const q = String(payload.query || payload.search || '').trim();
      if (q) f.push(`(job_code ~ "${esc(q)}" || service_notes ~ "${esc(q)}" || plate_source ~ "${esc(q)}")`);
      const res = await list('job_cards', { filter: f.join(' && '), expand: 'vehicle_id,technician_id,client_id', sort: '-created' });
      let dockets = [];
      try {
        const dk = await list('part_dockets', { filter: 'job_card_id != ""', sort: 'docket_date', perPage: 500 });
        dockets = dk.items || [];
      } catch (_) { dockets = []; }
      const byJob = {};
      for (const d of dockets) {
        (byJob[d.job_card_id] = byJob[d.job_card_id] || []).push(docketRow(d));
      }
      return {
        ok: true,
        tasks: (res.items || []).map((t) => {
          const row = joinStatus(t);
          row.dockets = byJob[t.id] || [];
          const th = row.dockets.find((d) => d.docketType === 'TH') || row.dockets[0];
          row.docketNo = th ? th.docketNo : '';
          return row;
        })
      };
    }
    case 'saveTask': {
      const vehicle = payload.vehicleNo ? await findBy('vehicles', 'plate_no', payload.vehicleNo) : null;
      const tech = payload.assignedUserId ? await findUserByName(payload.assignedUserId) : null;
      const client = payload.client ? await findBy('clients', 'name', payload.client) : null;
      const d = await directory();
      const hub = payload.hub ? await findHubByName(payload.hub) : (d.hubs || [])[0];
      const rec = await create('job_cards', {
        job_code: payload.jobId || `JC-${(todayISO() || '').replace(/-/g, '')}-${(hub && hub.hub_code) || 'HUB'}-${Math.floor(Math.random() * 9000 + 1000)}`,
        vehicle_id: vehicle ? vehicle.id : '',
        technician_id: tech ? tech.id : '',
        client_id: client ? client.id : '',
        hub_id: hub ? hub.id : '',
        status: TO_PB[payload.status] || 'IN_PROGRESS',
        job_started_at: payload.status === 'InProgress' ? new Date().toISOString() : '',
        breakdown_reported_at: new Date().toISOString(),
        delay_category: payload.delayCategory || '',
        delay_reason: payload.delayReason || payload.holdReason || '',
        service_notes: payload.serviceNotes || '',
        checklist: payload.checklist || '',
        parts_used: payload.partsUsed || '',
        plate_source: payload.plateSource || 'MANUAL'
      });
      if (payload.rootCause || payload.resolutionNotes) {
        try {
          await create('capa_records', {
            job_card_id: rec.id, root_cause: payload.rootCause || '',
            corrective_action: payload.resolutionNotes || '', status: 'OPEN'
          });
        } catch (_) { /* capa optional */ }
      }
      return { ok: true, job: joinStatus(Object.assign(rec, { expand: {} })) };
    }
    case 'updateTaskStatus': {
      const job = await findBy('job_cards', 'job_code', payload.jobId);
      if (!job) fail({ message: `Job ${payload.jobId} not found.` });
      const body = { status: TO_PB[payload.status] || 'IN_PROGRESS' };
      if (payload.status === 'Completed') {
        body.job_completed_at = new Date().toISOString();
        body.vehicle_released_at = new Date().toISOString();
      }
      if (payload.status === 'InProgress' && !job.job_started_at) body.job_started_at = new Date().toISOString();
      if (payload.delayCategory !== undefined) body.delay_category = payload.delayCategory;
      if (payload.delayReason !== undefined) body.delay_reason = payload.delayReason;
      if (payload.serviceNotes !== undefined) body.service_notes = payload.serviceNotes;
      const rec = await patch('job_cards', job.id, body);
      return { ok: true, job: joinStatus(Object.assign(rec, { expand: {} })) };
    }
    case 'jobHoldRequest': {
      const job = await findBy('job_cards', 'job_code', payload.jobId);
      if (!job) fail({ message: `Job ${payload.jobId} not found.` });
      const reason = mapCat(payload.holdCategory);
      await create('job_card_holds', {
        job_card_id: job.id, reason, notes: `${payload.holdReason || ''} | ${payload.holdSource || 'Portal'}`,
        held_at: new Date().toISOString()
      });
      await patch('job_cards', job.id, { status: 'ON_HOLD', delay_category: payload.holdCategory || '', delay_reason: payload.holdReason || '' });
      return { ok: true };
    }
    case 'jobHoldDecision': {
      const job = await findBy('job_cards', 'job_code', payload.jobId);
      if (!job) fail({ message: `Job ${payload.jobId} not found.` });
      if (String(payload.decision).toLowerCase().indexOf('approv') >= 0) {
        await patch('job_cards', job.id, { status: 'IN_PROGRESS', delay_category: '', delay_reason: payload.note || '' });
        const holds = await list('job_card_holds', { filter: `job_card_id = "${job.id}"`, sort: '-created' });
        if ((holds.items || []).length && !holds.items[0].resumed_at) {
          await patch('job_card_holds', holds.items[0].id, { resumed_at: new Date().toISOString() });
        }
      } else {
        await patch('job_cards', job.id, { delay_reason: payload.note || 'Hold rejected' });
      }
      return { ok: true };
    }
    case 'getHoldRequests': {
      const holds = await list('job_card_holds', { expand: 'job_card_id', sort: '-created' });
      const rows = [];
      for (const h of (holds.items || [])) {
        const job = (h.expand && h.expand.job_card_id) || {};
        rows.push({
          jobId: job.job_code || h.job_card_id,
          vehicleNo: (job.expand && job.expand.vehicle_id && job.expand.vehicle_id.plate_no) || '',
          holdCategory: h.reason,
          holdReason: String(h.notes || '').split('|')[0].trim(),
          requestedBy: 'technician', requestedByName: 'technician',
          requestedAt: h.held_at, status: h.resumed_at ? 'Resumed' : 'Pending',
          version: 1
        });
      }
      return {
        ok: true,
        pending: rows.filter((r) => r.status === 'Pending'),
        onHold: rows.filter((r) => r.status === 'Resumed'),
        history: rows, log: rows
      };
    }

    /* ---- attendance ---- */
    case 'getAttendance': {
      const date = payload.date || todayISO();
      // IST day grouping: the server hook stamps ist_date (YYYY-MM-DD in IST,
      // UTC+05:30) at capture time. Legacy rows without ist_date fall back to
      // the raw UTC window for that calendar date.
      let filter = `(ist_date = "${esc(date)}" || (ist_date = "" && timestamp >= "${esc(date)} 00:00:00.000Z" && timestamp <= "${esc(date)} 23:59:59.000Z"))`;
      if (payload.userId) {
        const u = await findUserByName(payload.userId);
        if (u) filter += ` && user_id = "${u.id}"`;
      }
      const res = await list('attendance', { filter, expand: 'user_id', sort: 'timestamp' });
      const byUser = {};
      for (const r of (res.items || [])) {
        const uid = (r.expand && r.expand.user_id && r.expand.user_id.username) || r.user_id;
        const row = byUser[uid] || (byUser[uid] = {
          date: r.ist_date || (r.timestamp || '').slice(0, 10), userId: uid,
          hubName: r.hub_name || '', checkIn: '', checkOut: '', minutes: 0,
          status: r.status || 'Verified', mock: String(r.status).indexOf('Mock') >= 0,
          checkInPhoto: '', checkOutPhoto: '', auto: false, checkoutReason: '',
          shiftMinutes: 0, jobMinutes: 0, cardsClosed: 0, cardsHeld: 0, holdMinutes: 0,
          pendingProof: false, pendingProofId: ''
        });
        const ts = r.timestamp ? new Date(String(r.timestamp).replace(' ', 'T')).toISOString() : '';
        if (r.action === 'CheckIn' && !row.checkIn) {
          row.checkIn = ts;
          row.checkInPhoto = fileUrl('attendance', r.id, r.photo_proof);
        }
        if (r.action === 'CheckOut') {
          row.checkOut = ts;
          row.checkOutPhoto = fileUrl('attendance', r.id, r.checkout_photo || r.photo_proof);
          row.auto = r.auto_checkout === true;
          row.checkoutReason = r.checkout_reason || '';
          row.shiftMinutes = Number(r.shift_minutes) || 0;
          row.jobMinutes = Number(r.job_minutes) || 0;
          row.cardsClosed = Number(r.cards_closed) || 0;
          row.cardsHeld = Number(r.cards_held) || 0;
          row.holdMinutes = Number(r.hold_minutes) || 0;
        }
        if (r.photo_pending === true) {
          row.pendingProof = true;
          row.pendingProofId = r.id;
        }
        if (r.action !== 'CheckIn' && r.action !== 'CheckOut' && row.status.indexOf('Rejected') < 0) {
          row.status = r.status;
        }
      }
      Object.values(byUser).forEach((row) => {
        if (row.checkIn) {
          const end = row.checkOut ? new Date(row.checkOut).getTime() : Date.now();
          row.minutes = Math.max(0, Math.round((end - new Date(row.checkIn).getTime()) / 60000));
          if (!row.checkOut) row.status = 'Active';
        }
      });
      return { ok: true, daily: Object.values(byUser) };
    }
    case 'attendanceCheckIn': {
      const d = await directory();
      let user = null;
      try {
        const saved = JSON.parse(localStorage.getItem('fieldops_session') || 'null');
        const uid = saved && saved.userId;
        user = (d.users || []).find((u) => u.id === uid) || (d.users || []).find((u) => u.username === (saved && saved.username));
      } catch (_) {}
      if (!user) user = (d.users || [])[0];
      const hub = payload.hubName ? await findHubByName(payload.hubName) : (d.hubs || [])[0];
      const fd = new FormData();
      fd.append('company_id', (user && user.company_id) || companyId(d));
      fd.append('user_id', user.id);
      fd.append('hub_id', hub ? hub.id : '');
      fd.append('action', 'CheckIn');
      fd.append('timestamp', new Date().toISOString());
      fd.append('hub_name', payload.hubName || (hub && hub.name) || '');
      fd.append('latitude', String(payload.lat || 0));
      fd.append('longitude', String(payload.lng || 0));
      fd.append('gps_accuracy_meters', String(payload.accuracy || 0));
      fd.append('within_geofence', payload.withinGeoFence ? 'true' : 'false');
      fd.append('is_mock_provider', payload.mock ? 'true' : 'false');
      fd.append('client_request_id', payload.clientRequestId || clientRequestId());
      if (payload.photoBase64) fd.append('photo_proof', dataUrlToBlob(payload.photoBase64), 'checkin.jpg');
      const rec = await create('attendance', fd);
      return { ok: true, id: rec.id };
    }
    case 'attendanceCheckOut': {
      const d = await directory();
      let user = null;
      try {
        const saved = JSON.parse(localStorage.getItem('fieldops_session') || 'null');
        user = (d.users || []).find((u) => u.id === (saved && saved.userId));
      } catch (_) {}
      if (!user) user = (d.users || [])[0];
      const hub = (d.hubs || [])[0];
      const fd = new FormData();
      fd.append('company_id', (user.company_id) || companyId(d));
      fd.append('user_id', user.id);
      fd.append('hub_id', hub ? hub.id : '');
      fd.append('action', 'CheckOut');
      fd.append('timestamp', new Date().toISOString());
      fd.append('latitude', String(payload.lat || 0));
      fd.append('longitude', String(payload.lng || 0));
      fd.append('gps_accuracy_meters', String(payload.accuracy || 0));
      fd.append('within_geofence', payload.withinGeoFence === false ? 'false' : 'true');
      fd.append('checkout_reason', payload.reason || 'MANUAL');
      fd.append('checkout_source', payload.source || 'WEB');
      fd.append('client_request_id', payload.clientRequestId || clientRequestId());
      if (payload.photoBase64) fd.append('checkout_photo', dataUrlToBlob(payload.photoBase64), 'checkout.jpg');
      const rec = await create('attendance', fd);
      return { ok: true, id: rec.id };
    }

    /* ---- attendance checkout proof ---- */
    case 'completeCheckoutPhoto': {
      if (!payload.attendanceId || !payload.photoBase64) fail({ message: 'attendanceId and photo are required.' });
      const fd = new FormData();
      fd.append('checkout_photo', dataUrlToBlob(payload.photoBase64), 'checkout.jpg');
      fd.append('photo_pending', 'false');
      fd.append('photo_completed_at', new Date().toISOString());
      return { ok: true, record: await patch('attendance', payload.attendanceId, fd) };
    }

    /* ---- dashboard / 360 ---- */
    case 'homeSummary': {
      const { data, ok } = await pbFetch('/api/fieldops/home-summary', {
        method: 'POST', body: { sessionToken: currentToken() }
      });
      if (!ok || !data || !data.success) fail(data || {}, 'Home summary failed.');
      return data;
    }
    case 'person360': {
      const { data, ok } = await pbFetch('/api/fieldops/person-360', {
        method: 'POST', body: { sessionToken: currentToken(), userId: payload.userId }
      });
      if (!ok || !data || !data.success) fail(data || {}, 'Person 360 failed.');
      return data;
    }

    /* ---- dealer visits ---- */
    case 'dealerVisitsList': {
      const { data, ok } = await pbFetch('/api/fieldops/dealer-visits/list', {
        method: 'POST',
        body: { sessionToken: currentToken(), dealerId: payload.dealerId, from: payload.from, to: payload.to }
      });
      if (!ok || !data || !data.success) fail(data || {}, 'Dealer visits list failed.');
      return data;
    }
    case 'issueDealerCode': {
      const { data, ok } = await pbFetch('/api/fieldops/dealer-visits/issue-code', {
        method: 'POST', body: { sessionToken: currentToken(), dealerId: payload.dealerId }
      });
      if (!ok || !data || !data.success) fail(data || {}, 'Could not issue dealer code.');
      return data;
    }
    case 'dealerVerify': {
      const { data, ok } = await pbFetch('/api/fieldops/dealer-verify', {
        method: 'POST', body: { dealerId: payload.dealerId, token: payload.token }
      });
      if (!ok || !data || !data.success) fail(data || {}, 'Dealer verification failed.');
      return data;
    }
    case 'dealersList': {
      const res = await list('dealers', { filter: payload.query ? `name ~ "${esc(payload.query)}"` : '', sort: 'name' });
      return { ok: true, dealers: res.items || [] };
    }
    case 'dealerLocationsList': {
      const res = await list('dealer_locations', { filter: payload.dealerId ? `dealer_id = "${esc(payload.dealerId)}"` : '' });
      return { ok: true, locations: res.items || [] };
    }
    case 'dealerVisitCreate': {
      const saved = JSON.parse(localStorage.getItem('fieldops_session') || 'null') || {};
      const fields = {
        manager_id: saved.userId || payload.managerId || '',
        dealer_id: payload.dealerId,
        dealer_location_id: payload.dealerLocationId || '',
        visit_type: payload.visitType || 'ROUTINE',
        verification_mode: payload.verificationMode || 'MANUAL',
        code: payload.code || '',
        visit_code_id: payload.visitCodeId || '',
        qr_token: payload.qrToken || '',
        latitude: String(Number(payload.lat) || 0),
        longitude: String(Number(payload.lng) || 0),
        notes: payload.notes || ''
      };
      let rec;
      if (payload.photoBase64) {
        const fd = new FormData();
        Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
        fd.append('check_in_photo', dataUrlToBlob(payload.photoBase64), 'visit.jpg');
        rec = await create('dealer_visits', fd);
      } else {
        rec = await create('dealer_visits', fields);
      }
      return { ok: true, visit: rec };
    }
    case 'dealerVisitComplete': {
      const body = { status: 'COMPLETED', outcome: payload.outcome || '', notes: payload.notes || '' };
      const fd = new FormData();
      Object.entries(body).forEach(([k, v]) => fd.append(k, v));
      if (payload.photoBase64) fd.append('check_out_photo', dataUrlToBlob(payload.photoBase64), 'visit-out.jpg');
      return { ok: true, visit: await patch('dealer_visits', payload.id, fd) };
    }

    /* ---- parts review queue ---- */
    case 'partsReviewQueue': {
      const res = await list('job_card_parts', {
        filter: 'needs_review = true',
        expand: 'job_card_id',
        sort: '-created',
        perPage: 200
      });
      return {
        ok: true,
        rows: (res.items || []).map((p) => ({
          id: p.id,
          jobCardId: p.job_card_id,
          jobCode: (p.expand && p.expand.job_card_id && p.expand.job_card_id.job_code) || p.job_card_id,
          partCode: p.part_code, qty: Number(p.qty) || 1,
          status: p.status, source: p.source,
          confidence: Number(p.confidence) || 0, resolved: p.resolved === true
        }))
      };
    }
    case 'confirmPartLine': {
      return {
        ok: true,
        record: await patch('job_card_parts', payload.id, {
          part_code: payload.partCode,
          qty: Math.max(1, Number(payload.qty) || 1),
          resolved: true,
          needs_review: false,
          confidence: 1
        })
      };
    }

    /* ---- fleet ---- */
    case 'vehicleList': {
      const q = String(payload.query || '').trim();
      const res = await list('vehicles', { filter: q ? `plate_no ~ "${esc(q)}"` : '', sort: '-created' });
      const d = await directory();
      return { ok: true, vehicles: (res.items || []).map((v) => toVehicle(v, d.hubs)) };
    }
    case 'vehicleUpsert': {
      const d = await directory();
      const hub = payload.hub ? await findHubByName(payload.hub) : (d.hubs || [])[0];
      const rec = await create('vehicles', {
        company_id: (d.users || [])[0] ? ((d.company || {}).id) || '' : '',
        plate_no: payload.plateNo, plate_raw: payload.plateNo,
        make: payload.make || '', model: payload.model || '',
        hub_id: hub ? hub.id : '', status: payload.status || 'Active', notes: payload.notes || ''
      });
      return { ok: true, vehicle: rec };
    }
    case 'vehicleUpdate': {
      const v = await findBy('vehicles', 'plate_no', payload.plateNo);
      if (!v) fail({ message: 'Vehicle not found.' });
      const d = await directory();
      const hub = payload.hub ? await findHubByName(payload.hub) : null;
      await patch('vehicles', v.id, {
        make: payload.make || v.make, model: payload.model || v.model,
        hub_id: hub ? hub.id : v.hub_id, status: payload.status || v.status,
        notes: payload.notes !== undefined ? payload.notes : v.notes
      });
      return { ok: true };
    }
    case 'vehicleArchive': {
      const v = await findBy('vehicles', 'plate_no', payload.plateNo);
      if (v) await patch('vehicles', v.id, { status: 'Archived' });
      return { ok: true };
    }

    /* ---- org / masters / admin ---- */
    case 'getOrgTree': {
      const d = await directory(true);
      const byHub = {};
      const name = (u) => u.username || u.userCode || u.id;
      for (const u of (d.users || [])) {
        if ((u.role || '') === 'Technician') {
          (byHub[u.hubId] = byHub[u.hubId] || []).push(u);
        }
      }
      const admins = (d.users || []).filter((u) => u.role === 'Administrator' || u.role === 'Platform');
      const mods = (d.users || []).filter((u) => u.role === 'Moderator');
      const sups = (d.users || []).filter((u) => u.role === 'Supervisor');
      const node = (u) => ({
        userId: u.id, username: u.username, fullName: u.username,
        role: u.role, hub: ((d.hubs || []).find((h) => h.id === u.hubId) || {}).name || '',
        region: ((d.regions || []).find((r) => r.id === u.regionId) || {}).name || '',
        regionZone: ((d.regions || []).find((r) => r.id === u.regionId) || {}).zone || '',
        hubId: u.hubId || '', regionId: u.regionId || '',
        reportsTo: u.reportsTo || '', status: u.status || '', scope: u.scope || '',
        userCode: u.userCode || '',
        phone: u.phone, lastLocation: null, children: []
      });
      const tree = [];
      const adminNodes = (admins.length ? admins : [{ id: 'org', username: 'Organization', role: 'Administrator' }]).map(node);
      for (const mod of mods) {
        const modNode = node(mod);
        for (const sup of sups.filter((s) => s.regionId === mod.regionId)) {
          const supNode = node(sup);
          (byHub[sup.hubId] || []).forEach((t) => supNode.children.push(node(t)));
          modNode.children.push(supNode);
        }
        (adminNodes[0] || {}).children.push(modNode);
        tree.push(adminNodes[0]);
      }
      if (!mods.length) {
        for (const sup of sups) {
          const supNode = node(sup);
          (byHub[sup.hubId] || []).forEach((t) => supNode.children.push(node(t)));
          adminNodes[0].children.push(supNode);
        }
        tree.push(adminNodes[0]);
      }
      if (!tree.length) {
        for (const t of (byHub[Object.keys(byHub)[0]] || (d.users || []))) tree.push(node(t));
      }
      const regionsOut = (d.regions || []).map((r) => ({
        id: r.id, name: r.name, code: r.region_code || '', zone: r.zone || '', active: r.active
      }));
      const hubsOut = (d.hubs || []).map((h) => ({
        id: h.id, name: h.name, code: h.hub_code || '', regionId: h.regionId || '', active: h.active
      }));
      const people = (d.users || []).map((u) => {
        const n = node(u);
        delete n.children;
        return n;
      });
      return { ok: true, tree, regions: regionsOut, hubs: hubsOut, people };
    }
    case 'getUsers': {
      const d = await directory();
      return { ok: true, canEditGeofence: Boolean(d.canEditGeofence), actor: d.actor || null, users: (d.users || []).map((u) => ({
        id: u.id, userId: u.id, userCode: u.userCode, username: u.username,
        fullName: u.username, role: u.role, hub: ((d.hubs || []).find((h) => h.id === u.hubId) || {}).name || '',
        hubId: u.hubId || '',
        region: ((d.regions || []).find((r) => r.id === u.regionId) || {}).name || '',
        regionId: u.regionId || '',
        regionZone: ((d.regions || []).find((r) => r.id === u.regionId) || {}).zone || '',
        phone: u.phone, status: u.status, scope: u.scope,
        geofenceMode: u.geofenceMode || 'INHERIT_HUB',
        geofenceLat: u.geofenceLat, geofenceLng: u.geofenceLng,
        geofenceRadiusM: u.geofenceRadiusM,
        geofenceUpdatedBy: u.geofenceUpdatedBy, geofenceUpdatedAt: u.geofenceUpdatedAt
      }))};
    }
    case 'mastersList': {
      const d = await directory();
      return {
        ok: true, canEdit: true,
        regions: (d.regions || []).map((r) => ({ name: r.name, id: r.id })),
        hubs: (d.hubs || []).map((h) => {
          const region = (d.regions || []).find((r) => r.id === h.regionId);
          return { hubId: h.hub_code || h.id, name: h.name, region: region ? region.name : '', lat: h.latitude, lng: h.longitude, radiusMeters: h.radiusMeters, id: h.id };
        }),
        clients: (d.clients || []).map((c, i) => ({
          clientId: c.id, name: c.name, address: c.address, id: c.id
        }))
      };
    }
    case 'masterCreate': case 'masterUpdate': {
      const d = await directory();
      const type = payload.type || 'REGION';
      if (type === 'REGION') return { ok: true, ...(await create('regions', { company_id: companyId(d), name: payload.name, region_code: 'REG-' + Math.random().toString(36).slice(2, 6).toUpperCase(), active: true })) };
      if (type === 'HUB') {
        const region = (d.regions || []).find((r) => r.name === payload.region);
        return { ok: true, ...(await create('service_hubs', { company_id: companyId(d), name: payload.name, region_id: region ? region.id : '', hub_code: 'HUB-' + Math.random().toString(36).slice(2, 6).toUpperCase(), latitude: Number(payload.lat) || 0, longitude: Number(payload.lng) || 0, radius_meters: Number(payload.radiusMeters) || 250, active: true })) };
      }
      const hub = (d.hubs || []).find((h) => h.hub_code === payload.hubId || h.name === payload.hubId);
      return { ok: true, ...(await create('clients', { company_id: companyId(d), name: payload.name, hub_id: hub ? hub.id : '', address: payload.address || '', latitude: Number(payload.lat) || 0, longitude: Number(payload.lng) || 0, active: true })) };
    }

    /* ---- dashboard aggregates ---- */
    case 'getAnalytics': {
      const res = await list('job_cards', {});
      const items = res.items || [];
      const counts = (fn) => { const m = {}; items.forEach((t) => { const k = fn(t); if (k) m[k] = (m[k] || 0) + 1; }); return m; };
      const d = await directory();
      const hubName = (id) => ((d.hubs || []).find((h) => h.id === id) || {}).name || id || '—';
      const techName = (id) => ((d.users || []).find((u) => u.id === id) || {}).username || id || '—';
      const hubTats = {};
      items.forEach((t) => {
        const hubId = String(t.hub_id || '');
        const row = hubTats[hubId] || (hubTats[hubId] = { jobs: 0, tatTotalMinutes: 0 });
        if (String(t.status || '') === 'CLOSED') { row.jobs += 1; row.tatTotalMinutes += Number(t.gross_tat_minutes) || Number(t.tat_minutes) || 0; }
      });
      const engineerTats = {};
      items.forEach((t) => {
        const techId = String((t.expand && t.expand.technician_id && t.expand.technician_id.username) || t.technician_id || '');
        const row = engineerTats[techId] || (engineerTats[techId] = { jobs: 0, tatTotalMinutes: 0 });
        if (String(t.status || '') === 'CLOSED') { row.jobs += 1; row.tatTotalMinutes += Number(t.gross_tat_minutes) || Number(t.tat_minutes) || 0; }
      });
      return {
        ok: true,
        analytics: {
          totalTasks: items.length,
          completedTasks: items.filter((t) => t.status === 'CLOSED').length,
          openTasks: items.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'OPEN').length,
          pendingHolds: items.filter((t) => t.status === 'ON_HOLD').length,
          mockLocationFlags: 0,
          holdReasons: counts((t) => t.delay_reason || t.delay_category),
          tatByHub: Object.entries(hubTats).map((kv) => ({ hub: hubName(kv[0]), jobs: kv[1].jobs, tatTotalMinutes: Math.round(kv[1].tatTotalMinutes), tatAvgMinutes: kv[1].jobs ? Math.round(kv[1].tatTotalMinutes / kv[1].jobs) : 0 })),
          tatByEngineer: Object.entries(engineerTats).map((kv) => ({ user: techName(kv[0]), jobs: kv[1].jobs, tatTotalMinutes: Math.round(kv[1].tatTotalMinutes), tatAvgMinutes: kv[1].jobs ? Math.round(kv[1].tatTotalMinutes / kv[1].jobs) : 0 })),
          hubWorkload: counts((t) => hubName(t.hub_id)),
          engineerProductivity: counts((t) => techName(t.technician_id))
        }
      };
    }
    case 'getVehicleUptime': {
      const res = await list('job_cards', { expand: 'vehicle_id,technician_id', filter: 'vehicle_id != ""', sort: '-created' });
      const rows = [];
      let totalDown = 0;
      let totalMinutes = 0;
      const byVeh = {};
      for (const t of (res.items || [])) {
        const v = (t.expand && t.expand.vehicle_id) || {};
        const key = v.plate_no || t.vehicle_id;
        const down = Number(t.total_downtime_minutes) || 0;
        const row = byVeh[key] || (byVeh[key] = {
          plateNo: key, vehicleId: t.vehicle_id, model: v.model || '',
          downtimeMinutes: 0, jobCount: 0, jobs: []
        });
        row.downtimeMinutes += down;
        row.jobCount += 1;
        totalDown += down;
        totalMinutes += down;
        row.jobs.push({
          recordId: t.id,
          jobId: t.job_code,
          jobType: t.job_type || 'FIELD_SERVICE',
          status: t.status,
          technician: (t.expand && t.expand.technician_id && t.expand.technician_id.username) || '',
          startTime: t.job_started_at || '',
          endTime: t.job_completed_at || '',
          elapsedMinutes: Number(t.gross_tat_minutes) || 0,
          downtimeMinutes: down,
          holdMinutes: Number(t.total_hold_minutes) || 0,
          startOdometer: num(t.start_odometer),
          odometerUnit: t.odometer_unit || 'km',
          startProof: jobProof('job_cards', t.id, t.start_proof_photo),
          endProof: jobProof('job_cards', t.id, t.end_proof_photo)
        });
      }
      Object.keys(byVeh).forEach((k) => rows.push(byVeh[k]));
      rows.forEach((r) => { r.jobs.sort((a, b) => String(b.startTime).localeCompare(String(a.startTime))); });
      return {
        ok: true,
        report: {
          summary: {
            downtimePct: rows.length ? Math.round(100 * totalDown / Math.max(1, rows.length * 480)) : 0,
            vehicleCount: rows.length,
            totalDowntimeMinutes: totalDown
          },
          rangeMinutes: 480, rows
        }
      };
    }
    case 'getAuditLogs': {
      const res = await list('audit_logs', { expand: 'user_id', sort: '-created' });
      return {
        ok: true,
        logs: (res.items || []).map((r) => ({
          at: r.timestamp || r.created, actor: (r.expand && r.expand.user_id && r.expand.user_id.username) || '',
          action: r.activity_type || '', detail: r.details || '', entityId: ''
        }))
      };
    }
    case 'getNotifications': {
      const res = await list('notifications', {
        filter: payload.unreadOnly === true ? "status = 'UNREAD'" : '',
        sort: '-created',
        perPage: Number(payload.limit) || 100
      });
      const items = res.items || [];
      const notifications = items.map((r) => ({
        id: r.id, notificationId: r.id, type: r.type || '',
        title: r.title || r.type || 'Notification',
        message: r.body || r.details || '', at: r.created || r.timestamp || '', read: String(r.status || '') !== 'UNREAD'
      }));
      return { ok: true, unread: notifications.filter((n) => !n.read).length, notifications };
    }
    case 'markNotificationRead': {
      const id = String(payload.notificationId || '');
      const ids = Array.isArray(payload.notificationIds) ? payload.notificationIds : [];
      if (id || ids.length) {
        const { data, ok } = await pbFetch('/api/fieldops/notification-read', {
          method: 'POST',
          body: { sessionToken: currentToken(), notificationId: id, ids }
        });
        if (!ok) fail(data || {}, 'Could not mark the notification as read.');
      }
      return { ok: true };
    }
    case 'notificationAction': {
      const id = String(payload.notificationId || '');
      const action = String(payload.action || '').toUpperCase();
      const remarks = String(payload.remarks || '');
      if ((action === 'APPROVE' || action === 'REJECT') && id) {
        const req = await findBy('roaming_requests', 'id', id);
        if (req) {
          const decision = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
          const { data, ok } = await pbFetch('/api/fieldops/roaming-approve', {
            method: 'POST',
            body: { sessionToken: currentToken(), requestId: req.id, decision, remarks }
          });
          if (!ok || !data || !data.success) fail(data || {}, 'Approval decision failed.');
          return { ok: true, decision, remarks };
        }
      }
      return { ok: true };
    }
    case 'getWorkflows': {
      const res = await list('workflows', {});
      return {
        ok: true,
        workflows: (res.items || []).map((w) => ({
          id: w.id, name: w.title || w.doc_code, status: 'Active',
          description: w.content || w.category || '', steps: []
        }))
      };
    }
    case 'getMisReport': {
      const res = await list('job_cards', { expand: 'hub_id' });
      const byHub = {};
      (res.items || []).forEach((t) => {
        const h = (t.expand && t.expand.hub_id && t.expand.hub_id.name) || 'Unassigned';
        const row = byHub[h] || (byHub[h] = { hubName: h, jobs: 0, completed: 0, holds: 0, avgTat: 0, _tat: 0 });
        row.jobs += 1;
        if (t.status === 'CLOSED') { row.completed += 1; row._tat += Number(t.gross_tat_minutes) || 0; }
        if (t.status === 'ON_HOLD') row.holds += 1;
      });
      const rows = Object.values(byHub).map((r) => ({ hubName: r.hubName, jobs: r.jobs, completed: r.completed, holds: r.holds, avgTatMinutes: r.completed ? Math.round(r._tat / r.completed) : 0 }));
      return { ok: true, rows, totals: { jobs: rows.reduce((a, r) => a + r.jobs, 0), completed: rows.reduce((a, r) => a + r.completed, 0), holds: rows.reduce((a, r) => a + r.holds, 0), downtimeMinutes: 0 } };
    }
    case 'getAdminSettings': {
      const { data } = await pbFetch('/api/fieldops/admin-settings', { method: 'POST', body: { sessionToken: currentToken() } });
      if (!data || !data.success) fail(data || {}, 'Admin settings require an administrator session.');
      return { ok: true, settings: data.settings || {} };
    }
    case 'adminUpdateSettings': {
      const { data } = await pbFetch('/api/fieldops/admin-settings', {
        method: 'POST',
        body: { sessionToken: currentToken(), update: payload.update || {} }
      });
      if (!data || !data.success) fail(data || {}, 'Settings update failed.');
      return { ok: true, settings: data.settings || {} };
    }
    case 'getPlatformSettings': {
      const s = await pbCall('getAdminSettings');
      return {
        ok: true,
        platform: {
          seatAllocation: Number(s.settings.max_users) || 50,
          seatsUsed: 0, tenants: 1, apiEndpoint: s.settings.api_endpoint || '',
          portalUrl: '', splashUrl: ''
        }
      };
    }
    case 'adminCreateUser': {
      const d = await directory();
      const hub = (d.hubs || []).find((h) => h.name === payload.hub || h.hub_code === payload.hub);
      const region = (d.regions || []).find((r) => r.name === payload.region || r.region_code === payload.region);
      if (payload.hub && !hub) throw new Error(`Unknown hub "${payload.hub}".`);
      if (payload.region && !region) throw new Error(`Unknown region "${payload.region}".`);
      const { data } = await pbFetch('/api/fieldops/admin-user', {
        method: 'POST',
        body: {
          action: 'create', sessionToken: currentToken(),
          passwordHash: (await sha256Hex(payload.password || 'changeme')).toLowerCase(),
          user: {
            username: payload.username, role: payload.role, phone: payload.phone,
            moduleRights: payload.moduleRights,
            hubId: hub ? hub.id : '', regionId: region ? region.id : '',
            scope: payload.scope
          }
        }
      });
      if (!data || !data.success) fail(data || {}, data && data.message || 'User creation failed.');
      return { ok: true, user: data.user };
    }
    case 'adminUpdateUser': {
      const d = await directory();
      const hub = (d.hubs || []).find((h) => h.name === payload.hub || h.hub_code === payload.hub);
      const region = (d.regions || []).find((r) => r.name === payload.region || r.region_code === payload.region);
      if (payload.hub && !hub) throw new Error(`Unknown hub "${payload.hub}".`);
      if (payload.region && !region) throw new Error(`Unknown region "${payload.region}".`);
      const user = { role: payload.role, phone: payload.phone, status: payload.status };
      if (payload.hub !== undefined) user.hubId = hub ? hub.id : '';
      if (payload.region !== undefined) user.regionId = region ? region.id : '';
      if (payload.reportsTo !== undefined) user.reportsTo = payload.reportsTo;
      const { data } = await pbFetch('/api/fieldops/admin-user', {
        method: 'POST',
        body: { action: 'update', sessionToken: currentToken(), userId: payload.userId, user }
      });
      if (!data || !data.success) fail(data || {}, 'User update failed.');
      return { ok: true };
    }
    case 'setRegionZone': {
      const updates = (Array.isArray(payload.updates) && payload.updates.length)
        ? payload.updates
        : (payload.regionId ? [{ regionId: payload.regionId, zone: payload.zone }] : []);
      const { data } = await pbFetch('/api/fieldops/region-zone', {
        method: 'POST',
        body: { sessionToken: currentToken(), updates }
      });
      if (!data || !data.success) fail(data || {}, 'Zone update failed.');
      dirCache = null; dirFetchedAt = 0;
      return { ok: true, updated: data.updated };
    }
    case 'broadcastAlert': {
      const { data } = await pbFetch('/api/fieldops/alert-broadcast', {
        method: 'POST',
        body: {
          sessionToken: currentToken(),
          title: payload.title,
          body: payload.message || payload.bodyMessage || payload.body,
          priority: payload.priority,
          scope: payload.scope,
          affectsTeam: Boolean(payload.affectsTeam),
          reassignments: payload.reassignments || []
        }
      });
      if (!data || !data.success) fail(data || {}, 'Alert broadcast failed.');
      dirCache = null; dirFetchedAt = 0;
      return { ok: true, notified: data.notified, applied: data.applied };
    }
    case 'adminSetGeofence': {
      const { data } = await pbFetch('/api/fieldops/geofence-set', {
        method: 'POST',
        body: {
          sessionToken: currentToken(),
          userId: payload.userId,
          mode: payload.mode || 'INHERIT_HUB',
          lat: payload.lat,
          lng: payload.lng,
          radius: payload.radiusM || payload.radius
        }
      });
      if (!data || !data.success) fail(data || {}, data && data.message || 'Geofence update failed.');
      return { ok: true, geofence: data.geofence };
    }
    case 'adminSetPassword': {
      const { data } = await pbFetch('/api/fieldops/admin-user', {
        method: 'POST',
        body: { action: 'password', sessionToken: currentToken(), userId: payload.userId, passwordHash: (await sha256Hex(payload.newPassword || '')).toLowerCase() }
      });
      if (!data || !data.success) fail(data || {}, 'Password update failed.');
      return { ok: true };
    }
    case 'getTelemetry': {
      const f = [];
      if (payload.userId) {
        const u = await findUserByName(payload.userId);
        if (u) f.push(`user_id = "${u.id}"`);
      }
      if (payload.date) {
        f.push(`timestamp >= "${esc(payload.date)} 00:00:00.000Z" && timestamp <= "${esc(payload.date)} 23:59:59.999Z"`);
      }
      if (payload.since) f.push(`timestamp >= "${esc(payload.since)}"`);
      const res = await list('telemetry', {
        filter: f.join(' && '), sort: '-timestamp',
        perPage: Math.min(Number(payload.limit) || 500, 500)
      });
      const d = await directory();
      const nameOf = (id) => ((d.users || []).find((u) => u.id === id) || {}).username || id || '—';
      const points = (res.items || []).map((r) => ({
        id: r.id, userId: r.user_id, username: nameOf(r.user_id),
        lat: Number(r.latitude), lng: Number(r.longitude),
        at: r.timestamp || r.created, zone: r.zone || '',
        accuracy: Number(r.accuracy_meters) || 0,
        mock: r.is_mock_provider === true,
        battery: Number(r.battery_pct) || 0,
        source: r.source || ''
      })).filter((p) => isFinite(p.lat) && isFinite(p.lng) && !(p.lat === 0 && p.lng === 0));
      return { ok: true, points, telemetry: points };
    }
    case 'getLiveLocations': {
      const res = await list('telemetry', { sort: '-timestamp', perPage: 500 });
      const d = await directory();
      const seen = {};
      const locations = [];
      for (const r of (res.items || [])) {
        if (!r.user_id || seen[r.user_id]) continue;
        const lat = Number(r.latitude), lng = Number(r.longitude);
        if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) continue;
        const u = (d.users || []).find((x) => x.id === r.user_id) || {};
        seen[r.user_id] = true;
        locations.push({
          userId: r.user_id, username: u.username || r.user_id,
          role: u.role || '', hub: u.hub_name || u.hub_id || '',
          lat, lng, at: r.timestamp || r.created, zone: r.zone || '',
          accuracy: Number(r.accuracy_meters) || 0,
          mock: r.is_mock_provider === true,
          battery: Number(r.battery_pct) || 0
        });
      }
      return { ok: true, locations, hubs: d.hubs || [] };
    }
    case 'getHoldDecision': case 'getUnapprovedJobs': case 'getTransitRequests': case 'getSplashMetadata':
      return { ok: true, unapproved: [], transitRequests: [], notifications: [] };
    case 'getJobProofBundle': {
      const key = String(payload.jobId || payload.recordId || payload.id || '').trim();
      if (!key) return { ok: true, bundle: null };
      let res = await list('job_cards', {
        filter: `job_code = "${esc(key)}"`,
        expand: 'vehicle_id,technician_id,client_id', perPage: 1
      });
      if (!(res.items || []).length) {
        res = await list('job_cards', {
          filter: `id = "${esc(key)}"`,
          expand: 'vehicle_id,technician_id,client_id', perPage: 1
        });
      }
      const job = (res.items || [])[0];
      if (!job) return { ok: true, bundle: null };

      let inspections = [];
      try {
        const r = await list('repair_inspections', { filter: `job_card_id = "${job.id}"`, sort: '-inspected_at', perPage: 20 });
        inspections = r.items || [];
      } catch (_) { inspections = []; }
      let dockets = [];
      try {
        const r = await list('part_dockets', { filter: `job_card_id = "${job.id}"`, sort: 'docket_date', perPage: 100 });
        dockets = r.items || [];
      } catch (_) { dockets = []; }

      const files = (rec, field) => {
        const raw = rec[field];
        const list_ = Array.isArray(raw) ? raw : String(raw || '').split(',').filter(Boolean);
        return list_.map((f) => fileUrl('repair_inspections', rec.id, f)).filter(Boolean);
      };
      return {
        ok: true,
        bundle: {
          job: joinStatus(job),
          inspections: inspections.map((i) => ({
            id: i.id, inspectionNo: i.inspection_no || '', inspectedAt: i.inspected_at || '',
            observations: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => i['observation_' + n] || '').filter(Boolean),
            ocv: i.ocv || '', defect: i.defect || '', rootCause: i.root_cause || '',
            actionTaken: i.action_taken || '', partsReplaced: i.parts_replaced || '',
            leakTest: i.leak_test || '', functionalTest: i.functional_test || '',
            firmwareUpdate: i.firmware_update || '', fqcStatus: i.fqc_status || '',
            cdcStatus: i.cdc_status || '', finalApproval: i.final_approval || '',
            mtStatus: i.mt_status || '', notes: i.notes || '', status: i.status || '',
            defectImages: files(i, 'defect_images'),
            actionImages: files(i, 'action_images'),
            finalPartImages: files(i, 'final_part_images')
          })),
          dockets: dockets.map(docketRow)
        }
      };
    }
    case 'saveDynamicField': case 'runFinancialClosing': case 'exportMisPackage':
    case 'broadcastSync': case 'broadcastNotification':
    case 'getCaptureFeed': case 'getJobAudit': case 'getAttendanceProofBundle':
      return { ok: true };
    default:
      fail({ message: `Unknown action "${action}" for PocketBase backend.` });
  }
}

function companyId(d) {
  const first = ((d.hubs || [])[0] || {}) || {};
  return first.company_id || (((d.users || [])[0] || {}).company_id || '');
}
