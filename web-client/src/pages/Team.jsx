import { useEffect, useMemo, useState } from 'react';
import { call } from '../api.js';
import { Badge, Btn, Card, Empty, PageHeader, Spinner, useAsync } from '../components.jsx';

const ROLE_TONE = { Administrator: 'primary', Moderator: 'info', Supervisor: 'warn', Technician: 'neutral', Platform: 'bad' };
const LEAD_ROLES = ['Moderator', 'Administrator', 'Platform'];

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

export default function Team({ session }) {
  const tree = useAsync(() => call('getOrgTree', {}), []);
  const perf = useAsync(() => call('getAnalytics', {}), []);
  const data = (tree.data || {});
  const nodes = data.tree || [];
  const regions = data.regions || [];
  const hubs = data.hubs || [];
  const people = data.people || [];
  const analytics = (perf.data && perf.data.analytics) || {};

  const [openRegions, setOpenRegions] = useState(() => new Set());
  const [openHubs, setOpenHubs] = useState(() => new Set());
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState('');

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

  useEffect(() => {
    if (opened || !people.length) return;
    const me = people.find((p) => p.userId === session.userId || p.username === session.username) || {};
    const regionId = me.regionId || (groups.byRegion[0] && groups.byRegion[0].id) || '';
    const hubId = me.hubId || '';
    setOpenRegions(new Set(regionId ? [regionId] : []));
    setOpenHubs(new Set(hubId ? [hubId] : []));
    setOpened(true);
  }, [opened, people, groups, session]);

  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return people.filter((p) => [p.username, p.userId, p.role, p.userCode, p.hub, p.region]
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
    setOpenRegions(new Set([...regions.map((r) => r.id), ...groups.orphanHubs.map((h) => h.regionId)]));
    setOpenHubs(new Set(hubs.map((h) => h.id)));
  };
  const collapseAll = () => { setOpenRegions(new Set()); setOpenHubs(new Set()); };

  const hubFold = (hub) => (
    <Fold key={hub.id} level={2} open={openHubs.has(hub.id)} onToggle={() => toggleHub(hub.id)}
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

  return (
    <>
      <PageHeader title="Team"
        subtitle="Hierarchy: Administrator → region in-charge (moderator) → hub in-charge (supervisor) → technicians" />
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
          subtitle="Click a region, then a hub, to fold open its hierarchy and people"
          actions={
            <span className="muted small">{people.length} people · {hubs.length} hubs · {regions.length} regions</span>
          }>
          <div style={{ padding: 16 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <input placeholder="Search people, role, hub…" value={query}
                onChange={(e) => setQuery(e.target.value)} style={{ width: 260 }} />
              <Btn size="sm" variant="ghost" onClick={expandAll} disabled={!regions.length}>Expand all</Btn>
              <Btn size="sm" variant="ghost" onClick={collapseAll} disabled={!regions.length}>Collapse all</Btn>
              {query ? <Btn size="sm" variant="ghost" onClick={() => setQuery('')}>Clear</Btn> : null}
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
                {groups.byRegion.map((region) => (
                  <Fold key={region.id} level={1}
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
                      ? region.hubs.map(hubFold)
                      : <div className="org-empty">No hubs in this region yet.</div>}
                  </Fold>
                ))}

                {groups.orphanHubs.length ? (
                  <Fold level={1} open={openRegions.has('orphans')} onToggle={() => toggleRegion('orphans')}
                    title="Hubs without a region"
                    subtitle={`${groups.orphanHubs.length} hubs`}
                    right={<Badge tone="warn">Unmapped</Badge>}>
                    {groups.orphanHubs.map(hubFold)}
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
        <Card title="Hub performance" subtitle="Open + completed job cards per hub">
          {perf.loading ? <Spinner label="Loading hub workload…" /> : null}
          {!perf.loading ? <BarList data={analytics.hubWorkload} tone="#0284c7" empty="No hub workload yet." /> : null}
        </Card>
        <Card title="Peer performance" subtitle="Completed job cards per engineer">
          {perf.loading ? <Spinner label="Loading peer productivity…" /> : null}
          {!perf.loading ? <BarList data={analytics.engineerProductivity} tone="#16a34a" empty="No peer productivity yet." /> : null}
        </Card>
      </div>
    </>
  );
}
