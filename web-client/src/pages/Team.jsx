import { useEffect, useMemo, useState } from 'react';
import { call } from '../api.js';
import { Badge, Btn, Card, Empty, Field, Modal, PageHeader, Spinner, useAsync, useToast } from '../components.jsx';

const ROLE_TONE = { Administrator: 'primary', Moderator: 'info', Supervisor: 'warn', Technician: 'neutral', Platform: 'bad' };
const LEAD_ROLES = ['Moderator', 'Administrator', 'Platform'];
const ADMIN_ROLES = ['Administrator', 'Platform'];

function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
}

function displayName(person) {
  return person.fullName || person.username || person.userId || 'Member';
}

function placeText(person) {
  const loc = person.lastLocation || {};
  const lat = Number(loc.lat), lng = Number(loc.lng);
  const has = isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0);
  return loc.address || (has ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'No location reported');
}

/** Builds the in-hub hierarchy: region leads → hub supervisors → technicians. */
function buildHubTree(members) {
  const leads = members.filter((p) => LEAD_ROLES.indexOf(p.role) >= 0);
  const sups = members.filter((p) => p.role === 'Supervisor');
  const techs = members.filter((p) => p.role === 'Technician');
  const others = members.filter((p) => ['Moderator', 'Administrator', 'Platform', 'Supervisor', 'Technician'].indexOf(p.role) < 0);
  const roots = [];
  const mk = (p, children = []) => ({ ...p, children });
  const keys = (p) => [p.userId, p.username, p.userCode].filter(Boolean).map(String);
  const matches = (person, ref) => {
    const v = String(ref || '');
    return Boolean(v) && keys(person).indexOf(v) >= 0;
  };
  const prefix = (s) => String(s || '').split(/[._\-\s]/)[0];
  const nodeById = {};

  // Region/company leads (admin → moderator via reports_to).
  let leadRoot = null;
  leads.forEach((l) => {
    const n = mk(l);
    nodeById[l.userId] = n;
    const parent = leads.find((x) => x !== l && matches(x, l.reportsTo));
    if (parent && nodeById[parent.userId]) nodeById[parent.userId].children.push(n);
    else if (leadRoot) leadRoot.children.push(n);
    else leadRoot = n;
  });

  // Supervisors hang off their lead (or the hub's lead if unassigned).
  const supNodes = [];
  sups.forEach((s) => {
    const n = mk(s);
    nodeById[s.userId] = n;
    supNodes.push(n);
    const parent = leads.find((l) => matches(l, s.reportsTo)) || leadRoot;
    if (parent && nodeById[parent.userId]) nodeById[parent.userId].children.push(n);
    else roots.push(n);
  });

  // Technicians hang off their supervisor (reports_to → username/id/code, or prefix).
  techs.forEach((t) => {
    const n = mk(t);
    const sup = sups.find((s) => matches(s, t.reportsTo))
      || sups.find((s) => prefix(s.username) === prefix(t.username))
      || (supNodes.length === 1 ? sups[0] : null);
    if (sup && nodeById[sup.userId]) nodeById[sup.userId].children.push(n);
    else if (leadRoot) leadRoot.children.push(n);
    else if (supNodes.length) supNodes[0].children.push(n);
    else roots.push(n);
  });

  others.forEach((o) => roots.push(mk(o)));
  if (leadRoot) return [leadRoot, ...roots];
  if (supNodes.length) return [...supNodes, ...roots];
  return roots;
}

function Fold({ open, onToggle, title, subtitle, right, level = 1, children }) {
  return (
    <div className="org-fold" data-level={level}>
      <button type="button" className="org-fold-head" onClick={onToggle} aria-expanded={open}>
        <span className={'org-chevron' + (open ? ' open' : '')} aria-hidden="true">▶</span>
        <span className="org-fold-title">
          <strong>{title}</strong>
          {subtitle ? <span className="muted small">{subtitle}</span> : null}
        </span>
        <span className="org-fold-right">{right}</span>
      </button>
      {open ? <div className="org-fold-body">{children}</div> : null}
    </div>
  );
}

function PersonCard({ person, depth }) {
  const name = displayName(person);
  const isInCharge = person.role === 'Supervisor' || person.role === 'Moderator' || person.role === 'Administrator';
  return (
    <div className="person-card" style={{ marginLeft: Math.min(depth, 4) * 22 }}>
      <div className="row between">
        <div className="row" style={{ gap: 10 }}>
          {person.profilePhotoUrl
            ? <img className="avatar" style={{ width: 34, height: 34, borderRadius: 10 }} src={person.profilePhotoUrl} alt="" />
            : <div className="brand-mark" style={{ width: 34, height: 34, fontSize: 12, borderRadius: 10 }}>{initialsOf(name)}</div>}
          <div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <strong>{name}</strong>
              <Badge tone={ROLE_TONE[person.role] || 'neutral'}>{person.role || 'Member'}</Badge>
              {isInCharge ? <Badge tone="ok">Hub in-charge</Badge> : null}
              {person.role === 'Moderator' ? <Badge tone="info">Region</Badge> : null}
              {person.status && !/^active$/i.test(String(person.status))
                ? <Badge tone="warn">{person.status}</Badge> : null}
            </div>
            <div className="muted small">
              {[person.userId, person.hub, person.region, person.userCode,
                person.phone && !String(person.phone).includes('*') ? person.phone : '']
                .filter(Boolean).join(' · ') || '—'} · {placeText(person)}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {person.phone && !String(person.phone).includes('*')
            ? <a className="btn ghost sm" href={`tel:${person.phone}`}>Call</a> : null}
          {(person.lastLocation && String(placeText(person)).indexOf('No location') < 0)
            ? <a className="btn ghost sm" target="_blank" rel="noreferrer"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeText(person))}`}>Locate</a> : null}
        </div>
      </div>
      {(person.children || []).length
        ? <div className="person-children">{(person.children || []).map((c) => (
            <PersonCard key={c.userId || c.username} person={c} depth={depth + 1} />
          ))}</div>
        : null}
    </div>
  );
}

function BarList({ data, tone = '#2563eb', empty = 'No data.' }) {
  const rows = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <Empty>{empty}</Empty>;
  const max = rows[0][1] || 1;
  return (
    <ul className="legend" style={{ width: '100%' }}>
      {rows.map(([name, value]) => (
        <li key={name} style={{ alignItems: 'center' }}>
          <span className="legend-name" style={{ flex: 1, minWidth: 90 }}>{name}</span>
          <span style={{ flex: 2, height: 8, borderRadius: 99, background: '#eef2f7', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.max(4, Math.round(100 * value / max))}%`, background: tone }} />
          </span>
          <b style={{ minWidth: 28, textAlign: 'right' }}>{value}</b>
        </li>
      ))}
    </ul>
  );
}

function ZoneModal({ open, regions, onClose, onSaved }) {
  const toast = useToast();
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next = {};
    (regions || []).forEach((r) => { next[r.id] = r.zone || ''; });
    setDraft(next);
  }, [open, regions]);

  const known = useMemo(
    () => Array.from(new Set((regions || []).map((r) => String(r.zone || '').trim()).filter(Boolean))),
    [regions]
  );

  async function save() {
    setBusy(true);
    try {
      const updates = (regions || []).map((r) => ({ regionId: r.id, zone: String(draft[r.id] || '').trim() }));
      const res = await call('setRegionZone', { updates });
      toast.push(`Zones saved for ${res.updated != null ? res.updated : updates.length} region(s).`, 'ok');
      onSaved && onSaved();
    } catch (err) {
      toast.push(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Map zones" onClose={onClose} wide
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save zones'}</Btn></>}>
      <p className="muted small">
        Group regions into zones (e.g. South, North, East). The Team tree then shows
        Zone → Region → Hub → people. Leave blank to keep a region ungrouped.
      </p>
      {!(regions || []).length ? <Empty>No regions to map.</Empty> : (
        <div className="form-grid">
          {(regions || []).map((r) => (
            <Field key={r.id} label={r.name} hint={r.code || ''}>
              <input
                list="zone-names"
                placeholder="Zone name"
                value={draft[r.id] == null ? '' : draft[r.id]}
                onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
      )}
      <datalist id="zone-names">
        {known.map((z) => <option key={z} value={z} />)}
      </datalist>
    </Modal>
  );
}

function BroadcastModal({ open, zones, regions, hubs, people, onClose }) {
  const toast = useToast();
  const [level, setLevel] = useState('ZONE');
  const [zone, setZone] = useState('');
  const [regionId, setRegionId] = useState('');
  const [hubId, setHubId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('HIGH');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLevel(zones.length ? 'ZONE' : (regions.length ? 'REGION' : 'HUB'));
    setZone((zones[0] && zones[0].zone) || '');
    setRegionId((regions[0] && regions[0].id) || '');
    setHubId((hubs[0] && hubs[0].id) || '');
    setTitle('');
    setMessage('');
    setPriority('HIGH');
  }, [open, zones, regions, hubs]);

  const recipientCount = useMemo(() => {
    if (level === 'ZONE') {
      const regionIds = new Set((regions || [])
        .filter((r) => (String(r.zone || '').trim() || 'Unassigned zone') === zone)
        .map((r) => r.id));
      const hubIds = new Set((hubs || []).filter((h) => regionIds.has(h.regionId)).map((h) => h.id));
      return (people || []).filter((p) => regionIds.has(p.regionId) || hubIds.has(p.hubId)).length;
    }
    if (level === 'REGION') {
      const hubIds = new Set((hubs || []).filter((h) => h.regionId === regionId).map((h) => h.id));
      return (people || []).filter((p) => p.regionId === regionId || hubIds.has(p.hubId)).length;
    }
    return (people || []).filter((p) => p.hubId === hubId).length;
  }, [level, zone, regionId, hubId, regions, hubs, people]);

  async function send() {
    if (!title.trim() && !message.trim()) {
      toast.push('Enter a title or a message first.', 'bad');
      return;
    }
    const scope = level === 'ZONE'
      ? { level, zone }
      : level === 'REGION' ? { level, regionId } : { level, hubId };
    setBusy(true);
    try {
      const res = await call('broadcastAlert', {
        title: title.trim(), message: message.trim(), priority,
        scope, affectsTeam: false, reassignments: []
      });
      toast.push(`Alert sent to ${res.notified || 0} ${res.notified === 1 ? 'person' : 'people'}.`, 'ok');
      onClose && onClose();
    } catch (err) {
      toast.push(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Broadcast alert" onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={send} disabled={busy}>{busy ? 'Sending…' : `Send to ${recipientCount}`}</Btn></>}>
      <div className="form-grid">
        <Field label="Send to" hint={`${recipientCount} recipient${recipientCount === 1 ? '' : 's'} in scope`}>
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="ZONE" disabled={!zones.length}>Zone</option>
            <option value="REGION" disabled={!regions.length}>Region</option>
            <option value="HUB" disabled={!hubs.length}>Hub</option>
          </select>
        </Field>
        {level === 'ZONE' ? (
          <Field label="Zone">
            <select value={zone} onChange={(e) => setZone(e.target.value)}>
              {zones.map((z) => <option key={z.zone} value={z.zone}>{z.zone}</option>)}
            </select>
          </Field>
        ) : null}
        {level === 'REGION' ? (
          <Field label="Region">
            <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
        ) : null}
        {level === 'HUB' ? (
          <Field label="Hub">
            <select value={hubId} onChange={(e) => setHubId(e.target.value)}>
              {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
          </select>
        </Field>
        <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Hub closes at 4 PM today" /></Field>
        <Field label="Message"><textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export default function Team({ session }) {
  const canAdmin = ADMIN_ROLES.indexOf(session.role) >= 0;
  const tree = useAsync(() => call('getOrgTree', {}), []);
  const perf = useAsync(() => call('getAnalytics', {}), []);
  const data = (tree.data || {});
  const nodes = data.tree || [];
  const regions = data.regions || [];
  const hubs = data.hubs || [];
  const people = data.people || [];
  const analytics = (perf.data && perf.data.analytics) || {};

  const [openZones, setOpenZones] = useState(() => new Set());
  const [openRegions, setOpenRegions] = useState(() => new Set());
  const [openHubs, setOpenHubs] = useState(() => new Set());
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState('');
  const [zoneModal, setZoneModal] = useState(false);
  const [alertModal, setAlertModal] = useState(false);

  const groups = useMemo(() => {
    const hubCards = hubs.map((h) => {
      const members = people.filter((p) => p.hubId === h.id);
      const sups = members.filter((p) => p.role === 'Supervisor');
      const lead = sups[0] || members.find((p) => LEAD_ROLES.indexOf(p.role) >= 0) || null;
      return { ...h, members, lead, tree: buildHubTree(members) };
    });

    const knownRegionIds = new Set(regions.map((r) => r.id));
    const byRegion = regions.map((r) => {
      const regionHubs = hubCards.filter((h) => h.regionId === r.id);
      const direct = people.filter((p) => !p.hubId && p.regionId === r.id);
      return {
        ...r,
        hubs: regionHubs,
        people: direct,
        count: regionHubs.reduce((a, h) => a + h.members.length, 0) + direct.length
      };
    });

    const orphanHubs = hubCards.filter((h) => !knownRegionIds.has(h.regionId));
    const assignedIds = new Set();
    regions.forEach((r) => assignedIds.add(r.id));
    hubCards.forEach((h) => assignedIds.add(h.regionId));
    const unassigned = people.filter((p) => !p.hubId && !assignedIds.has(p.regionId));
    return { byRegion, orphanHubs, unassigned };
  }, [regions, hubs, people]);

  const zones = useMemo(() => {
    const byZone = new Map();
    groups.byRegion.forEach((r) => {
      const key = String(r.zone || '').trim() || 'Unassigned zone';
      if (!byZone.has(key)) byZone.set(key, []);
      byZone.get(key).push(r);
    });
    return Array.from(byZone.entries())
      .map(([zone, regionList]) => ({
        zone,
        regions: regionList,
        hubCount: regionList.reduce((a, r) => a + r.hubs.length, 0),
        peopleCount: regionList.reduce((a, r) => a + r.count, 0)
      }))
      .sort((a, b) => a.zone.localeCompare(b.zone));
  }, [groups.byRegion]);

  const showZones = zones.length > 1 || (zones.length === 1 && zones[0].zone !== 'Unassigned zone');
  const realZones = useMemo(() => zones.filter((z) => z.zone !== 'Unassigned zone'), [zones]);

  useEffect(() => {
    if (opened || !people.length) return;
    const me = people.find((p) => p.userId === session.userId || p.username === session.username) || {};
    const regionId = me.regionId || (groups.byRegion[0] && groups.byRegion[0].id) || '';
    const hubId = me.hubId || '';
    const myRegion = groups.byRegion.find((r) => r.id === regionId);
    const zoneName = myRegion ? (String(myRegion.zone || '').trim() || 'Unassigned zone') : (zones[0] && zones[0].zone);
    setOpenZones(new Set(zoneName ? [zoneName] : []));
    setOpenRegions(new Set(regionId ? [regionId] : []));
    setOpenHubs(new Set(hubId ? [hubId] : []));
    setOpened(true);
  }, [opened, people, groups, zones, session]);

  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return people.filter((p) => [p.username, p.userId, p.role, p.userCode, p.hub, p.region, p.regionZone]
      .some((v) => String(v || '').toLowerCase().indexOf(q) >= 0));
  }, [query, people]);

  const chain = useMemo(() => {
    const flat = [];
    const walk = (ns, parents) => (ns || []).forEach((n) => {
      flat.push({ person: n, chain: parents });
      walk(n.children, [...parents, n]);
    });
    walk(nodes, []);
    const me = flat.find((f) => f.person.userId === session.userId || f.person.username === session.username);
    if (!me) return null;
    const roles = { Supervisor: 'Hub in-charge', Moderator: 'Region in-charge', Administrator: 'Admin', Platform: 'Platform' };
    return me.chain.slice().reverse().map((p) => ({ label: roles[p.role] || p.role, name: p.fullName || p.username, role: p.role }));
  }, [nodes, session]);

  const toggleZone = (name) => setOpenZones((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const toggleRegion = (id) => setOpenRegions((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleHub = (id) => setOpenHubs((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const expandAll = () => {
    setOpenZones(new Set(zones.map((z) => z.zone)));
    setOpenRegions(new Set([...regions.map((r) => r.id), ...groups.orphanHubs.map((h) => h.regionId)]));
    setOpenHubs(new Set(hubs.map((h) => h.id)));
  };
  const collapseAll = () => { setOpenZones(new Set()); setOpenRegions(new Set()); setOpenHubs(new Set()); };

  const hubFold = (hub, level = 3) => (
    <Fold key={hub.id} level={level} open={openHubs.has(hub.id)} onToggle={() => toggleHub(hub.id)}
      title={hub.name}
      subtitle={`${hub.members.length} ${hub.members.length === 1 ? 'person' : 'people'}${hub.lead ? ` · in-charge ${displayName(hub.lead)}` : ''}`}
      right={<span className="row" style={{ gap: 6 }}>
        {hub.lead ? <Badge tone="ok">In-charge</Badge> : <Badge tone="warn">No in-charge</Badge>}
        {hub.code ? <span className="muted small">{hub.code}</span> : null}
      </span>}>
      {hub.tree.length
        ? hub.tree.map((p) => <PersonCard key={p.userId || p.username} person={p} depth={0} />)
        : <div className="org-empty">No people assigned to this hub yet.</div>}
    </Fold>
  );

  const regionFold = (region, level = 2) => (
    <Fold key={region.id} level={level}
      open={openRegions.has(region.id)} onToggle={() => toggleRegion(region.id)}
      title={region.name}
      subtitle={`${region.hubs.length} ${region.hubs.length === 1 ? 'hub' : 'hubs'} · ${region.count} ${region.count === 1 ? 'person' : 'people'}`}
      right={<span className="row" style={{ gap: 6 }}>
        {region.code ? <Badge tone="info">{region.code}</Badge> : <Badge tone="info">Region</Badge>}
      </span>}>
      {region.people.length ? (
        <div style={{ marginBottom: 8 }}>
          {region.people.map((p) => <PersonCard key={p.userId || p.username} person={p} depth={0} />)}
        </div>
      ) : null}
      {region.hubs.length
        ? region.hubs.map((hub) => hubFold(hub, level + 1))
        : <div className="org-empty">No hubs in this region yet.</div>}
    </Fold>
  );

  return (
    <>
      <PageHeader title="Team"
        subtitle="Hierarchy: Zone → region in-charge (moderator) → hub in-charge (supervisor) → technicians" />
      {chain ? (
        <div className="hint-info" style={{ marginBottom: 16 }}>
          <strong>Your chain:</strong>{' '}
          {chain.length
            ? chain.map((c, i) => <span key={i}>{i > 0 ? ' → ' : ''}<strong>{c.name}</strong> ({c.label})</span>)
            : 'You are at the top of your visible scope.'}
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Card pad={false} title="Organization"
          subtitle="Zone → region → hub → people. Click a group to fold it open."
          actions={
            <span className="muted small">{people.length} people · {hubs.length} hubs · {regions.length} regions</span>
          }>
          <div style={{ padding: 16 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <input placeholder="Search people, role, hub, zone…" value={query}
                onChange={(e) => setQuery(e.target.value)} style={{ width: 260 }} />
              <Btn size="sm" variant="ghost" onClick={expandAll} disabled={!regions.length}>Expand all</Btn>
              <Btn size="sm" variant="ghost" onClick={collapseAll} disabled={!regions.length}>Collapse all</Btn>
              {query ? <Btn size="sm" variant="ghost" onClick={() => setQuery('')}>Clear</Btn> : null}
              {canAdmin ? <Btn size="sm" variant="ghost" onClick={() => setZoneModal(true)} disabled={!regions.length}>Map zones</Btn> : null}
              {canAdmin ? <Btn size="sm" onClick={() => setAlertModal(true)} disabled={!(zones.length || regions.length || hubs.length)}>Broadcast alert</Btn> : null}
            </div>

            {tree.loading ? <Spinner label="Loading org…" /> : null}
            {tree.error ? <div className="hint-banner">{tree.error.message}</div> : null}
            {tree.data && !people.length ? <Empty>No people in your scope.</Empty> : null}

            {searchHits ? (
              <div>
                <div className="muted small" style={{ marginBottom: 8 }}>
                  {searchHits.length} match{searchHits.length === 1 ? '' : 'es'} for “{query}”
                </div>
                {searchHits.length
                  ? searchHits.map((p) => <PersonCard key={p.userId || p.username} person={p} depth={0} />)
                  : <Empty>No people match that search.</Empty>}
              </div>
            ) : (
              <>
                {showZones
                  ? zones.map((zone) => (
                      <Fold key={zone.zone} level={1}
                        open={openZones.has(zone.zone)} onToggle={() => toggleZone(zone.zone)}
                        title={zone.zone}
                        subtitle={`${zone.regions.length} ${zone.regions.length === 1 ? 'region' : 'regions'} · ${zone.hubCount} ${zone.hubCount === 1 ? 'hub' : 'hubs'} · ${zone.peopleCount} ${zone.peopleCount === 1 ? 'person' : 'people'}`}
                        right={<Badge tone="primary">Zone</Badge>}>
                        {zone.regions.map((region) => regionFold(region, 2))}
                      </Fold>
                    ))
                  : groups.byRegion.map((region) => regionFold(region, 1))}

                {groups.orphanHubs.length ? (
                  <Fold level={1} open={openRegions.has('orphans')} onToggle={() => toggleRegion('orphans')}
                    title="Hubs without a region"
                    subtitle={`${groups.orphanHubs.length} hubs`}
                    right={<Badge tone="warn">Unmapped</Badge>}>
                    {groups.orphanHubs.map((hub) => hubFold(hub, 2))}
                  </Fold>
                ) : null}

                {groups.unassigned.length ? (
                  <Fold level={1} open={openRegions.has('unassigned')} onToggle={() => toggleRegion('unassigned')}
                    title="Unassigned people"
                    subtitle={`${groups.unassigned.length} people`}
                    right={<Badge tone="neutral">Company</Badge>}>
                    {groups.unassigned.map((p) => <PersonCard key={p.userId || p.username} person={p} depth={0} />)}
                  </Fold>
                ) : null}
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="Hub Performance" subtitle="Open + completed job cards per hub">
          {perf.loading ? <Spinner label="Loading hub workload…" /> : null}
          {!perf.loading ? <BarList data={analytics.hubWorkload} tone="#0284c7" empty="No hub workload yet." /> : null}
        </Card>
        <Card title="Your Performance" subtitle="Completed job cards per engineer">
          {perf.loading ? <Spinner label="Loading peer productivity…" /> : null}
          {!perf.loading ? <BarList data={analytics.engineerProductivity} tone="#16a34a" empty="No peer productivity yet." /> : null}
        </Card>
      </div>

      {zoneModal && canAdmin
        ? <ZoneModal open regions={regions} onClose={() => setZoneModal(false)}
            onSaved={() => { setZoneModal(false); tree.reload(); }} />
        : null}
      {alertModal && canAdmin
        ? <BroadcastModal open zones={realZones}
            regions={regions} hubs={hubs} people={people}
            onClose={() => setAlertModal(false)} />
        : null}
    </>
  );
}
