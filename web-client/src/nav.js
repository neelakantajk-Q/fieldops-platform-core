import Overview from './pages/Overview.jsx';
import Attendance from './pages/Attendance.jsx';
import Jobs from './pages/Jobs.jsx';
import Pending from './pages/Pending.jsx';
import BulkParts from './pages/BulkParts.jsx';
import Team from './pages/Team.jsx';
import Notifications from './pages/Notifications.jsx';
import LiveMap from './pages/Map.jsx';
import Performance from './pages/Performance.jsx';
import Uptime from './pages/Uptime.jsx';
import Vehicles from './pages/Vehicles.jsx';
import Reports from './pages/Reports.jsx';
import Inventory from './pages/Inventory.jsx';
import Masters from './pages/Masters.jsx';
import Workflows from './pages/Workflows.jsx';
import Admin from './pages/Admin.jsx';
import Platform from './pages/Platform.jsx';
import Capa from './pages/Capa.jsx';
import Repairs from './pages/Repairs.jsx';
import Custody from './pages/Custody.jsx';
import PartExtract from './pages/PartExtract.jsx';
import Billing from './pages/Billing.jsx';

export const ROLE_RANK = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };

export const NAV = [
  { section: 'Workspace', items: [
    { id: 'overview', label: 'Overview', min: 1, view: Overview },
    { id: 'attendance', label: 'Attendance', min: 1, view: Attendance },
    { id: 'jobs', label: 'Job Cards', min: 1, view: Jobs },
    { id: 'bulkparts', label: 'Bulk Parts', min: 2, view: BulkParts },
    { id: 'pending', label: 'Pending Jobs', min: 1, view: Pending }
  ]},
  { section: 'Field', items: [
    { id: 'team', label: 'Team', min: 1, view: Team },
    { id: 'performance', label: 'Performance', min: 2, view: Performance },
    { id: 'map', label: 'Live Map', min: 1, view: LiveMap },
    { id: 'notifications', label: 'Notifications', min: 1, view: Notifications }
  ]},
  { section: 'Reporting', items: [
    { id: 'uptime', label: 'Vehicle Uptime', min: 2, view: Uptime },
    { id: 'capa', label: 'CAPA', min: 2, view: Capa },
    { id: 'billing', label: 'Billing', min: 2, view: Billing },
    { id: 'reports', label: 'Reports & MIS', min: 2, view: Reports }
  ]},
  { section: 'Fleet', items: [
    { id: 'vehicles', label: 'Vehicles & OCR', min: 2, view: Vehicles },
    { id: 'repairs', label: 'Repairs', min: 1, view: Repairs },
    { id: 'custody', label: 'Asset Custody', min: 1, view: Custody },
    { id: 'inventory', label: 'Inventory', min: 2, view: Inventory },
    { id: 'partextract', label: 'Part Extraction', min: 1, view: PartExtract },
    { id: 'masters', label: 'Master Data', min: 2, view: Masters }
  ]},
  { section: 'Administration', items: [
    { id: 'workflows', label: 'Workflows', min: 2, view: Workflows },
    { id: 'admin', label: 'Admin Panel', min: 4, view: Admin },
    { id: 'platform', label: 'Platform Console', min: 4, view: Platform }
  ]}
];

export const MODULE_ALIASES = {
  tasks: ['jobs', 'pending', 'capa', 'repairs', 'custody', 'partextract'],
  jobs: ['jobs', 'pending', 'capa', 'repairs', 'custody', 'partextract', 'bulkparts'],
  attendance: ['attendance'],
  team: ['team', 'performance'],
  vehicles: ['vehicles', 'uptime', 'repairs', 'custody', 'partextract'],
  uptime: ['uptime', 'vehicles', 'capa'],
  reports: ['reports', 'capa', 'billing'],
  notifications: ['notifications'],
  masters: ['masters'],
  workflows: ['workflows'],
  capa: ['capa'],
  billing: ['billing', 'reports'],
  repairs: ['repairs'],
  custody: ['custody'],
  parts: ['partextract', 'inventory', 'bulkparts'],
  inventory: ['inventory', 'partextract', 'bulkparts'],
  partextract: ['partextract', 'inventory'],
  admin: ['admin'],
  platform: ['platform'],
  performance: ['performance']
};

export const MODULE_NAMES = ['tasks', 'attendance', 'vehicles', 'team', 'reports', 'notifications', 'masters', 'workflows', 'capa', 'billing', 'repairs', 'custody', 'parts', 'inventory', 'partextract', 'admin', 'platform', 'performance'];

export function normalizeModule(value) {
  const raw = String(value || '').toLowerCase().replace(/^module[-_]?/, '').replace(/[-_]?view$/, '').trim();
  const hit = MODULE_NAMES.find((m) => raw === m || raw.includes(m));
  return hit || raw;
}

export function grantedModules(moduleRights) {
  const mr = moduleRights;
  if (Array.isArray(mr)) return mr.map(normalizeModule).filter(Boolean);
  if (typeof mr === 'string') return mr.split(',').map(normalizeModule).filter(Boolean);
  if (mr && typeof mr === 'object') {
    return Object.entries(mr).filter(([, v]) => v === true || v === 'true').map(([k]) => normalizeModule(k));
  }
  return [];
}

export function allowed(item, session) {
  const rank = ROLE_RANK[session.role] || 1;
  if (rank < item.min) return false;
  if (rank >= 4) return true;
  if (item.id === 'overview' || item.id === 'notifications' || item.id === 'home') return true;
  const granted = grantedModules(session.moduleRights);
  if (!granted.length) return true;
  const expanded = new Set();
  granted.forEach((g) => (MODULE_ALIASES[g] || [g]).forEach((id) => expanded.add(id)));
  return expanded.has(item.id);
}

export function sectionsFor(session) {
  return NAV
    .map((s) => ({ ...s, items: s.items.filter((it) => allowed(it, session)) }))
    .filter((s) => s.items.length);
}

export function navItemById(id) {
  for (const section of NAV) {
    const hit = section.items.find((it) => it.id === id);
    if (hit) return hit;
  }
  return null;
}

export function navLabel(id) {
  const hit = navItemById(id);
  return hit ? hit.label : String(id || '');
}
