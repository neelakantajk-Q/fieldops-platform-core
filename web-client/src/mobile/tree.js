import { call } from '../api.js';
import { fieldopsPost } from '../lib/fieldops.js';
import { allowed } from '../nav.js';
import Notifications from '../pages/Notifications.jsx';
import LiveMap from '../pages/Map.jsx';
import Reports from '../pages/Reports.jsx';
import PartExtract from '../pages/PartExtract.jsx';
import Inventory from '../pages/Inventory.jsx';
import BulkParts from '../pages/BulkParts.jsx';
import Masters from '../pages/Masters.jsx';
import Workflows from '../pages/Workflows.jsx';
import Admin from '../pages/Admin.jsx';
import Platform from '../pages/Platform.jsx';
import Performance from '../pages/Performance.jsx';
import DealerVisits from '../pages/DealerVisits.jsx';
import Person360 from '../pages/Person360.jsx';

const JOB_STATUS = {
  inprogress: 'InProgress',
  onhold: 'OnHold',
  completed: 'Completed',
  delayed: 'Delayed',
  cancelled: 'Cancelled'
};

function jobTone(status) {
  if (status === 'Completed') return 'ok';
  if (status === 'InProgress') return 'primary';
  if (status === 'OnHold' || status === 'HoldRequested') return 'bad';
  return 'warn';
}

function elapsed(task) {
  if (!task) return '';
  if (task.turnaroundMinutes && task.endTime) {
    const m = Number(task.turnaroundMinutes) || 0;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  if (task.startTime) {
    const m = Math.round((Date.now() - new Date(task.startTime).getTime()) / 60000);
    if (!isFinite(m) || m < 0) return '';
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  return '';
}

function shortDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short' });
}

function timeOf(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(value).slice(11, 16) || '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const asRows = (data, key) => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data[key])) return data[key];
  if (Array.isArray(data.items)) return data.items;
  return [];
};

async function odooList(path) {
  const res = await fieldopsPost(path, {});
  return asRows(res, 'items');
}

export const MODULES = [
  {
    id: 'jobs', label: 'Job Cards', short: 'JC', icon: 'briefcase', tone: 'lime', min: 1,
    children: [
      { id: 'all', label: 'All' },
      { id: 'inprogress', label: 'In progress' },
      { id: 'onhold', label: 'On hold' },
      { id: 'completed', label: 'Completed' },
      { id: 'cancelled', label: 'Cancelled' }
    ],
    load: async ({ child }) => {
      const data = await call('getTasks', { status: JOB_STATUS[child] || '', query: '', page: 1, pageSize: 200 });
      const tasks = asRows(data, 'tasks');
      if (child && child !== 'all') {
        const want = JOB_STATUS[child];
        return tasks.filter((t) => t.status === want || (child === 'onhold' && (t.status === 'OnHold' || t.status === 'HoldRequested')));
      }
      return tasks;
    },
    card: (t) => ({
      id: t.jobId,
      title: t.jobId,
      subtitle: [t.vehicleNo, t.client].filter(Boolean).join(' · ') || 'Unassigned job',
      badge: { label: t.status || '—', tone: jobTone(t.status) },
      meta: [elapsed(t), t.assignedUserId].filter(Boolean),
      facts: [
        { label: 'Vehicle', value: t.vehicleNo || '—' },
        { label: 'Client', value: t.client || '—' },
        { label: 'Technician', value: t.assignedUserId || '—' },
        { label: 'Complaint', value: t.complaintNo || '—' },
        { label: 'Plate source', value: t.plateSource || '—' },
        { label: 'Elapsed', value: elapsed(t) || '—' }
      ]
    })
  },
  {
    id: 'attendance', label: 'Attendance', short: 'AT', icon: 'calendar', tone: 'teal', min: 1,
    children: [
      { id: 'today', label: 'Today' },
      { id: 'active', label: 'Active' },
      { id: 'closed', label: 'Checked out' },
      { id: 'all', label: 'All' }
    ],
    load: async ({ child }) => {
      const data = await call('getAttendance', {});
      const rows = asRows(data, 'daily');
      if (child === 'active') return rows.filter((r) => r.checkIn && !r.checkOut);
      if (child === 'closed') return rows.filter((r) => r.checkOut);
      return rows;
    },
    card: (r) => ({
      id: r.userId,
      title: r.userId || 'Unknown',
      subtitle: [r.hubName, shortDate(r.date)].filter(Boolean).join(' · ') || 'Attendance',
      badge: { label: r.status || '—', tone: r.status === 'Active' ? 'primary' : (String(r.status).indexOf('Reject') >= 0 ? 'bad' : 'ok') },
      meta: [timeOf(r.checkIn), timeOf(r.checkOut)].filter((v) => v !== '—'),
      facts: [
        { label: 'Date', value: r.date || '—' },
        { label: 'Hub', value: r.hubName || '—' },
        { label: 'Check in', value: timeOf(r.checkIn) },
        { label: 'Check out', value: timeOf(r.checkOut) },
        { label: 'Duration', value: r.minutes ? `${Math.floor(r.minutes / 60)}h ${r.minutes % 60}m` : '—' }
      ]
    })
  },
  {
    id: 'vehicles', label: 'Vehicles', short: 'VH', icon: 'truck', tone: 'blue', min: 2,
    children: [
      { id: 'all', label: 'All' },
      { id: 'active', label: 'Active' },
      { id: 'flagged', label: 'Flagged' }
    ],
    load: async ({ child }) => {
      const data = await call('vehicleList', { query: '' });
      const rows = asRows(data, 'vehicles');
      if (child === 'active') return rows.filter((r) => r.status === 'Active');
      if (child === 'flagged') return rows.filter((r) => (r.anomalyFlags || []).length);
      return rows;
    },
    card: (v) => ({
      id: v.plateNo || v.display,
      title: v.display || v.plateNo,
      subtitle: [v.make, v.model].filter(Boolean).join(' ') || 'Vehicle',
      badge: { label: v.status || '—', tone: v.status === 'Active' ? 'ok' : 'neutral' },
      meta: [v.hub].filter(Boolean),
      facts: [
        { label: 'Hub', value: v.hub || '—' },
        { label: 'Make', value: v.make || '—' },
        { label: 'Model', value: v.model || '—' },
        { label: 'Flags', value: (v.anomalyFlags || []).join(', ') || 'None' },
        { label: 'Notes', value: v.notes || '—' }
      ]
    })
  },
  {
    id: 'team', label: 'Team', short: 'TM', icon: 'users', tone: 'violet', min: 1,
    children: [
      { id: 'all', label: 'Everyone' },
      { id: 'Technician', label: 'Technicians' },
      { id: 'Supervisor', label: 'Supervisors' },
      { id: 'Administrator', label: 'Admins' }
    ],
    load: async ({ child }) => {
      const data = await call('getUsers', {});
      const rows = asRows(data, 'users');
      if (child && child !== 'all') return rows.filter((u) => u.role === child || (child === 'Administrator' && (u.role === 'Administrator' || u.role === 'Platform')));
      return rows;
    },
    card: (u) => ({
      id: u.id,
      title: u.username,
      subtitle: [u.role, u.hub].filter(Boolean).join(' · '),
      badge: { label: u.status || 'Active', tone: /active/i.test(String(u.status)) ? 'ok' : 'neutral' },
      meta: [u.phone].filter(Boolean),
      facts: [
        { label: 'Role', value: u.role || '—' },
        { label: 'Scope', value: u.scope || '—' },
        { label: 'Hub', value: u.hub || '—' },
        { label: 'Region', value: u.region || '—' },
        { label: 'Phone', value: u.phone || '—' },
        { label: 'User code', value: u.userCode || '—' }
      ]
    })
  },
  {
    id: 'pending', label: 'Pending Jobs', short: 'PD', icon: 'clock', tone: 'amber', min: 1,
    children: [
      { id: 'pending', label: 'Requests' },
      { id: 'onHold', label: 'On hold' },
      { id: 'history', label: 'History' }
    ],
    load: async ({ child }) => {
      const data = await call('getHoldRequests', {});
      return asRows(data, child) || [];
    },
    card: (r) => ({
      id: r.jobId,
      title: r.jobId,
      subtitle: r.holdReason || r.holdCategory || 'Hold request',
      badge: { label: r.status || '—', tone: r.status === 'Pending' ? 'warn' : 'neutral' },
      meta: [r.vehicleNo, shortDate(r.requestedAt)].filter(Boolean),
      facts: [
        { label: 'Vehicle', value: r.vehicleNo || '—' },
        { label: 'Category', value: r.holdCategory || '—' },
        { label: 'Reason', value: r.holdReason || '—' },
        { label: 'Requested by', value: r.requestedByName || r.requestedBy || '—' },
        { label: 'Requested', value: shortDate(r.requestedAt) }
      ]
    })
  },
  {
    id: 'uptime', label: 'Vehicle Uptime', short: 'UP', icon: 'chart', tone: 'green', min: 2,
    children: [
      { id: 'all', label: 'All vehicles' }
    ],
    load: async () => {
      const data = await call('getVehicleUptime', { page: 1, pageSize: 300 });
      const rows = asRows(data, 'rows');
      return rows.length ? rows : asRows(data && data.report, 'rows');
    },
    card: (r) => ({
      id: r.plateNo,
      title: r.plateNo,
      subtitle: [r.hubName, r.hub].filter(Boolean)[0] || 'Fleet',
      badge: { label: r.uptimePct != null ? `${r.uptimePct}%` : '—', tone: Number(r.uptimePct) >= 90 ? 'ok' : 'warn' },
      meta: [r.jobs ? `${r.jobs} jobs` : ''].filter(Boolean),
      facts: [
        { label: 'Downtime', value: r.downtimeMinutes != null ? `${r.downtimeMinutes} min` : '—' },
        { label: 'Uptime', value: r.uptimePct != null ? `${r.uptimePct}%` : '—' },
        { label: 'Jobs', value: r.jobCount ?? r.jobs ?? '—' }
      ]
    })
  },
  {
    id: 'capa', label: 'CAPA', short: 'CA', icon: 'shield', tone: 'rose', min: 2, soon: true,
    children: [
      { id: 'all', label: 'All' },
      { id: 'open', label: 'Open' },
      { id: 'verified', label: 'Verified' },
      { id: 'closed', label: 'Closed' }
    ],
    load: async () => odooList('/api/fieldops/capa/list'),
    card: (r) => ({
      id: r.capaNo || r.id,
      title: r.capaNo || r.id,
      subtitle: [r.jobCode, r.plate].filter(Boolean).join(' · ') || 'CAPA',
      badge: { label: r.status || '—', tone: /HIGH|CRITICAL/.test(String(r.severity)) ? 'bad' : 'warn' },
      meta: [r.severity, r.dueDate ? shortDate(r.dueDate) : ''].filter(Boolean),
      facts: [
        { label: 'Job', value: r.jobCode || '—' },
        { label: 'Vehicle', value: r.plate || '—' },
        { label: 'Technician', value: r.technician || '—' },
        { label: 'Severity', value: r.severity || '—' },
        { label: 'Category', value: r.rootCauseCategory || '—' },
        { label: 'Due', value: r.dueDate ? shortDate(r.dueDate) : '—' }
      ]
    })
  },
  {
    id: 'repairs', label: 'Repairs', short: 'RP', icon: 'wrench', tone: 'orange', min: 1, soon: true,
    children: [
      { id: 'all', label: 'All' },
      { id: 'active', label: 'Active' },
      { id: 'released', label: 'Released' },
      { id: 'cancelled', label: 'Cancelled' }
    ],
    load: async () => odooList('/api/fieldops/repair/list'),
    card: (r) => ({
      id: r.repairNo || r.id,
      title: r.repairNo || r.id,
      subtitle: [r.plate, r.jobCode].filter(Boolean).join(' · ') || 'Repair order',
      badge: { label: r.stage || '—', tone: 'primary' },
      meta: [r.priority, r.vendor].filter(Boolean),
      facts: [
        { label: 'Vehicle', value: r.plate || '—' },
        { label: 'Job', value: r.jobCode || '—' },
        { label: 'Stage', value: r.stage || '—' },
        { label: 'Priority', value: r.priority || '—' },
        { label: 'Reported fault', value: r.reportedFault || '—' },
        { label: 'Vendor', value: r.vendor || '—' }
      ]
    })
  },
  {
    id: 'custody', label: 'Asset Custody', short: 'AC', icon: 'route', tone: 'cyan', min: 1, soon: true,
    children: [
      { id: 'all', label: 'All' },
      { id: 'active', label: 'Active' },
      { id: 'closed', label: 'Closed' }
    ],
    load: async () => odooList('/api/fieldops/custody/list'),
    card: (r) => ({
      id: r.id,
      title: r.plate || 'Vehicle custody',
      subtitle: [r.fromUser || r.fromHub, r.toUser || r.toHub].filter(Boolean).join(' to ') || 'Handover',
      badge: { label: r.status || '—', tone: r.status === 'DISPUTED' ? 'bad' : 'neutral' },
      meta: [r.custodyType, shortDate(r.occurredAt)].filter(Boolean),
      facts: [
        { label: 'Type', value: r.custodyType || '—' },
        { label: 'From', value: r.fromUser || r.fromHub || '—' },
        { label: 'To', value: r.toUser || r.toHub || '—' },
        { label: 'Job', value: r.jobCode || '—' },
        { label: 'Odometer', value: r.odometer || '—' },
        { label: 'When', value: shortDate(r.occurredAt) }
      ]
    })
  },
  {
    id: 'billing', label: 'Billing', short: 'BL', icon: 'receipt', tone: 'emerald', min: 2, soon: true,
    children: [
      { id: 'all', label: 'All' },
      { id: 'DRAFT', label: 'Drafts' },
      { id: 'ISSUED', label: 'Issued' },
      { id: 'PAID', label: 'Paid' },
      { id: 'CANCELLED', label: 'Cancelled' }
    ],
    load: async () => odooList('/api/fieldops/billing/list'),
    card: (r) => ({
      id: r.invoiceNo || r.id,
      title: r.invoiceNo || r.id,
      subtitle: [r.customerName, r.plate].filter(Boolean).join(' · ') || 'Invoice',
      badge: { label: r.status || '—', tone: r.status === 'PAID' ? 'ok' : (r.status === 'CANCELLED' ? 'bad' : (r.status === 'ISSUED' ? 'primary' : 'warn')) },
      meta: [r.total != null ? `INR ${Number(r.total).toLocaleString()}` : '', r.jobCode].filter(Boolean),
      facts: [
        { label: 'Customer', value: r.customerName || '—' },
        { label: 'Vehicle', value: r.plate || '—' },
        { label: 'Job', value: r.jobCode || '—' },
        { label: 'Subtotal', value: r.subtotal != null ? `INR ${Number(r.subtotal).toLocaleString()}` : '—' },
        { label: 'Tax', value: r.taxTotal != null ? `INR ${Number(r.taxTotal).toLocaleString()}` : '—' },
        { label: 'Total', value: r.total != null ? `INR ${Number(r.total).toLocaleString()}` : '—' }
      ]
    })
  },
  {
    id: 'inventory', label: 'Inventory', short: 'IV', icon: 'box', tone: 'slate', min: 2, soon: true, screen: Inventory
  },
  {
    id: 'partextract', label: 'Part Extraction', short: 'PE', icon: 'scan', tone: 'blue', min: 1, soon: true, screen: PartExtract
  },
  {
    id: 'bulkparts', label: 'Bulk Parts', short: 'BP', icon: 'box', tone: 'slate', min: 2, soon: true, screen: BulkParts
  },
  { id: 'map', label: 'Live Map', short: 'MP', icon: 'map', tone: 'teal', min: 1, screen: LiveMap },
  { id: 'notifications', label: 'Alerts', short: 'AL', icon: 'bell', tone: 'amber', min: 1, screen: Notifications },
  { id: 'reports', label: 'Reports & MIS', short: 'MI', icon: 'chart', tone: 'lime', min: 2, screen: Reports },
  { id: 'performance', label: 'Hub Performance', short: 'PF', icon: 'chart', tone: 'violet', min: 2, screen: Performance },
  { id: 'dealervisits', label: 'Dealer Visits', short: 'DV', icon: 'route', tone: 'teal', min: 2, screen: DealerVisits },
  { id: 'person360', label: 'Person 360', short: 'P3', icon: 'users', tone: 'violet', min: 2, screen: Person360 },
  { id: 'masters', label: 'Master Data', short: 'MD', icon: 'grid', tone: 'slate', min: 2, screen: Masters },
  { id: 'workflows', label: 'Workflows', short: 'WF', icon: 'route', tone: 'slate', min: 2, screen: Workflows },
  { id: 'admin', label: 'Admin Panel', short: 'AD', icon: 'settings', tone: 'rose', min: 4, screen: Admin },
  { id: 'platform', label: 'Platform Console', short: 'PL', icon: 'shield', tone: 'slate', min: 4, screen: Platform }
];

export function modulesFor(session) {
  return MODULES.filter((m) => allowed({ id: m.id, min: m.min }, session));
}

export function moduleById(id) {
  return MODULES.find((m) => m.id === id) || null;
}

export function filterRows(module, child, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!child || child === 'all' || !module) return list;
  if (module.id === 'capa') {
    const OPEN = ['OPEN', 'INVESTIGATING', 'ACTION_PLANNED', 'ACTION_PLANNED', 'IN_PROGRESS'];
    if (child === 'open') return list.filter((r) => OPEN.indexOf(r.status) >= 0);
    if (child === 'verified') return list.filter((r) => r.status === 'VERIFIED');
    if (child === 'closed') return list.filter((r) => r.status === 'CLOSED' || r.status === 'RESOLVED');
  }
  if (module.id === 'repairs') {
    if (child === 'active') return list.filter((r) => ['INTAKE', 'DIAGNOSIS', 'IN_REPAIR', 'AWAITING_PARTS'].indexOf(r.stage) >= 0);
    if (child === 'released') return list.filter((r) => r.stage === 'RELEASED');
    if (child === 'cancelled') return list.filter((r) => r.stage === 'CANCELLED');
  }
  if (module.id === 'custody') {
    if (child === 'active') return list.filter((r) => r.status !== 'CLOSED');
    if (child === 'closed') return list.filter((r) => r.status === 'CLOSED');
  }
  if (module.id === 'billing') return list.filter((r) => String(r.status) === child);
  return list;
}
