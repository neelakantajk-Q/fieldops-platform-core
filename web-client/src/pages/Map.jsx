import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { call } from '../api.js';
import { Btn, Card, Empty, Field, PageHeader, SegTabs, Spinner, useAsync, useToast } from '../components.jsx';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; OpenStreetMap contributors';
const RANKS = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };

function ago(iso) {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function dot(color, size = 16) {
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 6px rgba(15,23,42,.45)"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function hubIcon() {
  return L.divIcon({
    className: '',
    html: '<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:#051330;color:#a6ce39;font:700 10px/1 Arial;border:2px solid #a6ce39;box-shadow:0 2px 8px rgba(5,19,48,.4)">HUB</span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
}

function recent(iso, minutes) {
  const t = Date.parse(iso || '');
  return isFinite(t) && Date.now() - t <= minutes * 60 * 1000;
}

function canManage(actor, target) {
  if (!actor || !target) return false;
  const ar = RANKS[actor.role] || 0;
  const tr = RANKS[target.role] || 0;
  if (ar < 2 || tr >= ar) return false;
  if (ar === 99) return true;
  if (actor.role === 'Supervisor') return Boolean(actor.hubId) && actor.hubId === target.hubId;
  if (actor.role === 'Moderator') return Boolean(actor.regionId) && actor.regionId === target.regionId;
  return true;
}

function zoneOf(user, hubById) {
  if (!user) return null;
  const mode = user.geofenceMode || 'INHERIT_HUB';
  const lat = Number(user.geofenceLat);
  const lng = Number(user.geofenceLng);
  const radius = Number(user.geofenceRadiusM);
  const hasCustom = isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0) && radius > 0;
  const hub = hubById[user.hubId];
  const hubLat = hub ? Number(hub.latitude) : NaN;
  const hubLng = hub ? Number(hub.longitude) : NaN;
  const hasHub = isFinite(hubLat) && isFinite(hubLng) && !(hubLat === 0 && hubLng === 0);

  if (mode === 'CUSTOM' && hasCustom) {
    return { lat, lng, radius, source: 'CUSTOM' };
  }
  if (mode === 'ROAMING') {
    if (hasCustom) return { lat, lng, radius: 0, source: 'ROAMING' };
    if (hasHub) return { lat: hubLat, lng: hubLng, radius: 0, source: 'ROAMING' };
    return null;
  }
  if (hasHub) {
    return { lat: hubLat, lng: hubLng, radius: Number(hub.radiusMeters) || 250, source: 'HUB' };
  }
  if (hasCustom) return { lat, lng, radius, source: 'CUSTOM' };
  return null;
}

export default function LiveMap({ session }) {
  const holder = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef(null);
  const editLayerRef = useRef(null);
  const draftRef = useRef(null);
  const toast = useToast();
  const [mode, setMode] = useState('Latest');
  const [auto, setAuto] = useState(true);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const live = useAsync(() => call('getLiveLocations', {}), []);
  const trail = useAsync(() => call('getTelemetry', { limit: 500 }), []);
  const team = useAsync(() => call('getUsers', {}), []);

  const locations = (live.data && live.data.locations) || [];
  const hubs = (live.data && live.data.hubs) || [];
  const points = (trail.data && trail.data.points) || [];
  const teamUsers = (team.data && team.data.users) || [];
  const actor = (team.data && team.data.actor) || null;
  const canEditGeofence = Boolean(team.data && team.data.canEditGeofence);
  const hubById = hubs.reduce((acc, h) => { acc[h.id] = h; return acc; }, {});
  const editableUsers = teamUsers.filter((u) => canManage(actor, u));

  useEffect(() => { draftRef.current = draft; }, [draft]);

  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = L.map(holder.current, { zoomControl: true, attributionControl: true })
      .setView([Number(session.lat) || 20.5937, Number(session.lng) || 78.9629], 5);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    editLayerRef.current = L.layerGroup().addTo(map);
    map.on('click', (ev) => {
      const d = draftRef.current;
      if (!d) return;
      setDraft({ ...d, lat: ev.latlng.lat, lng: ev.latlng.lng });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      editLayerRef.current = null;
    };
  }, [session.lat, session.lng]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layersRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds = [];

    hubs.forEach((h) => {
      const lat = Number(h.latitude), lng = Number(h.longitude);
      if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return;
      const radius = Number(h.radiusMeters) || 250;
      L.circle([lat, lng], {
        radius, color: '#a6ce39', weight: 2, fillColor: '#a6ce39', fillOpacity: 0.12
      }).addTo(layer).bindPopup(
        `<strong>${h.name || h.hub_code || 'Hub'}</strong><br>${h.hub_code || ''}<br>Radius ${Math.round(radius)} m`
      );
      L.marker([lat, lng], { icon: hubIcon() }).addTo(layer)
        .bindPopup(`<strong>${h.name || h.hub_code || 'Hub'}</strong><br>${h.hub_code || ''}`);
      bounds.push([lat, lng]);
    });

    if (mode === 'Geofences') {
      teamUsers.forEach((u) => {
        const zone = zoneOf(u, hubById);
        if (!zone) return;
        if (zone.radius > 0) {
          L.circle([zone.lat, zone.lng], {
            radius: zone.radius, color: '#7c3aed', weight: 2,
            dashArray: '6 6', fillColor: '#7c3aed', fillOpacity: 0.06
          }).addTo(layer).bindPopup(
            `<strong>${u.username}</strong><br>${zone.source} zone · ${Math.round(zone.radius)} m` +
            `<br>${u.geofenceUpdatedBy ? 'set by ' + u.geofenceUpdatedBy : 'default'}`
          );
        }
        L.marker([zone.lat, zone.lng], { icon: dot(zone.source === 'ROAMING' ? '#16a34a' : '#7c3aed', 12) })
          .addTo(layer).bindPopup(
            `<strong>${u.username}</strong><br>${u.role || ''}` +
            `<br>${zone.source === 'ROAMING' ? 'Roaming (no radius limit)' : zone.source + ' · ' + Math.round(zone.radius) + ' m'}`
          );
        bounds.push([zone.lat, zone.lng]);
      });
    } else if (mode === 'Trails') {
      const byUser = {};
      points.slice().reverse().forEach((p) => {
        const box = byUser[p.userId] || (byUser[p.userId] = { name: p.username, pts: [] });
        box.pts.push([p.lat, p.lng]);
      });
      Object.values(byUser).forEach((u) => {
        if (u.pts.length < 2) return;
        L.polyline(u.pts, { color: '#2563eb', weight: 3, opacity: 0.55 }).addTo(layer)
          .bindPopup(`<strong>${u.name}</strong><br>${u.pts.length} trail points`);
        bounds.push(u.pts[0], u.pts[u.pts.length - 1]);
      });
    } else {
      locations.forEach((p) => {
        const fresh = recent(p.at, 15);
        const color = p.mock ? '#dc2626' : (fresh ? '#16a34a' : '#f59e0b');
        L.circleMarker([p.lat, p.lng], {
          radius: fresh ? 9 : 7, color: '#fff', weight: 2,
          fillColor: color, fillOpacity: 0.95
        }).addTo(layer).bindPopup(
          `<strong>${p.username}</strong><br>${p.role || ''} ${p.hub ? '· ' + p.hub : ''}` +
          `<br>${p.zone || 'zone unknown'} · ${p.accuracy ? Math.round(p.accuracy) + ' m accuracy' : ''}` +
          `<br>${ago(p.at)}${p.mock ? '<br><b style="color:#dc2626">MOCK GPS</b>' : ''}`
        );
        bounds.push([p.lat, p.lng]);
      });
    }

    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [live.data, trail.data, mode, team.data]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = editLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!draft) return;
    const lat = Number(draft.lat), lng = Number(draft.lng);
    if (!isFinite(lat) || !isFinite(lng)) return;
    const radius = Number(draft.radiusM) || 250;
    if (draft.mode === 'CUSTOM') {
      L.circle([lat, lng], {
        radius, color: '#2563eb', weight: 2, dashArray: '4 4',
        fillColor: '#2563eb', fillOpacity: 0.1
      }).addTo(layer);
    }
    const marker = L.marker([lat, lng], { draggable: true }).addTo(layer);
    marker.bindTooltip('Drag to move the centre', { permanent: false });
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      setDraft((cur) => (cur ? { ...cur, lat: p.lat, lng: p.lng } : cur));
    });
    map.panTo([lat, lng]);
  }, [draft]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => { live.reload(); }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  const stale = locations.filter((p) => !recent(p.at, 15)).length;
  const mock = locations.filter((p) => p.mock).length;

  function pickUser(id) {
    const u = teamUsers.find((x) => x.id === id);
    if (!u) { setDraft(null); return; }
    const zone = zoneOf(u, hubById) || {};
    setDraft({
      userId: u.id,
      username: u.username,
      mode: u.geofenceMode || 'INHERIT_HUB',
      lat: Number(zone.lat) || Number(session.lat) || 20.5937,
      lng: Number(zone.lng) || Number(session.lng) || 78.9629,
      radiusM: Number(zone.radius) || 250
    });
  }

  function useMyLocation() {
    if (!navigator.geolocation) { toast.push('Geolocation is not available in this browser.', 'bad'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setDraft((cur) => (cur ? { ...cur, lat: pos.coords.latitude, lng: pos.coords.longitude } : cur)),
      (err) => toast.push(err.message || 'Could not read your location.', 'bad'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function saveDraft(resetMode) {
    if (!draft) return;
    const nextMode = resetMode || draft.mode;
    setSaving(true);
    try {
      await call('adminSetGeofence', {
        userId: draft.userId,
        mode: nextMode,
        lat: Number(draft.lat),
        lng: Number(draft.lng),
        radiusM: Number(draft.radiusM)
      });
      toast.push(nextMode === 'INHERIT_HUB' ? 'Zone reset to hub.' : 'Geofence saved.', 'ok');
      setDraft({ ...draft, mode: nextMode });
      team.reload();
    } catch (err) {
      toast.push(err.message, 'bad');
    } finally {
      setSaving(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    if (next !== 'Geofences') setDraft(null);
  }

  const tabs = [{ id: 'Latest', label: 'Latest' }, { id: 'Trails', label: 'Trails' }];
  if (canEditGeofence) tabs.push({ id: 'Geofences', label: 'Geofences' });

  return (
    <>
      <PageHeader title="Live Map"
        subtitle={canEditGeofence
          ? 'Latest technician GPS, hub geofences and manager-drawn per-user zones'
          : 'Latest technician GPS, hub geofences and telemetry trails from the cloud backend'}
        actions={(
          <>
            <button className="btn ghost sm" onClick={() => { live.reload(); trail.reload(); team.reload(); }}>REFRESH</button>
            <button className={`btn ${auto ? '' : 'ghost'} sm`} onClick={() => setAuto((v) => !v)}>
              {auto ? 'AUTO 60s ON' : 'AUTO OFF'}
            </button>
          </>
        )} />

      <div className="row" style={{ gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <SegTabs tabs={tabs} active={mode} onChange={switchMode} ariaLabel="Map mode" />
        <span className="chip ok">{locations.length} live</span>
        <span className="chip warn">{stale} stale</span>
        <span className={`chip ${mock ? 'bad' : 'neutral'}`}>{mock} mock flags</span>
        <span className="chip neutral">{hubs.length} hubs</span>
        {mode === 'Geofences' ? <span className="chip neutral">{teamUsers.length} user zones</span> : null}
      </div>

      <Card pad={false} title="Map" subtitle={`${points.length} telemetry points loaded`}>
        <div style={{ padding: 10 }}>
          <div ref={holder} style={{ height: 'min(60vh, 560px)', minHeight: 360, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }} />
        </div>
        {live.error ? <div className="hint-banner" style={{ margin: 12 }}>{live.error.message}</div> : null}
      </Card>

      {mode === 'Geofences' ? (
        <Card title="Geofence editor"
          subtitle="Pick a user, then click the map or drag the pin. Supervisors edit their hub; moderators their region.">
          {team.loading ? <Spinner label="Loading team…" /> : null}
          {!team.loading && !editableUsers.length ? <Empty>No users in your scope.</Empty> : null}
          {editableUsers.length ? (
            <div className="form-grid">
              <Field label="User" hint="Only users below your role and inside your scope are listed">
                <select value={draft ? draft.userId : ''} onChange={(e) => pickUser(e.target.value)}>
                  <option value="">Select a user…</option>
                  {editableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username} · {u.role}{u.hub ? ' · ' + u.hub : ''}
                    </option>
                  ))}
                </select>
              </Field>

              {draft ? (
                <>
                  <Field label="Geofence mode" hint="INHERIT_HUB follows the hub radius; ROAMING removes the limit">
                    <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
                      <option value="INHERIT_HUB">Inherit hub</option>
                      <option value="CUSTOM">Custom zone (radius)</option>
                      <option value="ROAMING">Roaming (no limit)</option>
                    </select>
                  </Field>
                  {draft.mode === 'CUSTOM' ? (
                    <>
                      <Field label="Latitude">
                        <input type="number" step="0.000001" value={draft.lat}
                          onChange={(e) => setDraft({ ...draft, lat: e.target.value })} />
                      </Field>
                      <Field label="Longitude">
                        <input type="number" step="0.000001" value={draft.lng}
                          onChange={(e) => setDraft({ ...draft, lng: e.target.value })} />
                      </Field>
                      <Field label="Radius (m)" hint="25 to 5000 metres">
                        <input type="number" min="25" max="5000" step="5" value={draft.radiusM}
                          onChange={(e) => setDraft({ ...draft, radiusM: e.target.value })} />
                      </Field>
                      <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
                        <Btn variant="ghost" onClick={useMyLocation}>Use my location</Btn>
                      </div>
                    </>
                  ) : null}
                  <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
                    <Btn onClick={() => saveDraft()} disabled={saving}>{saving ? 'Saving…' : 'Save zone'}</Btn>
                    <Btn variant="ghost" onClick={() => saveDraft('INHERIT_HUB')} disabled={saving}>Reset to hub</Btn>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card title="Latest positions" subtitle="One row per person, newest telemetry first">
        {live.loading ? <Spinner label="Loading positions…" /> : null}
        {!live.loading && !locations.length ? <Empty>No GPS telemetry yet.</Empty> : null}
        {locations.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>User</th><th>Role</th><th>Zone</th><th>Coordinates</th><th>Age</th><th /></tr>
              </thead>
              <tbody>
                {locations.map((p) => (
                  <tr key={p.userId}>
                    <td><strong>{p.username}</strong></td>
                    <td className="muted small">{p.role || '—'}</td>
                    <td>
                      <span className={`chip ${p.zone === 'INSIDE' ? 'ok' : p.zone === 'OUTSIDE' ? 'warn' : 'neutral'}`}>
                        {p.zone || 'unknown'}
                      </span>
                      {p.mock ? <span className="chip bad" style={{ marginLeft: 6 }}>MOCK</span> : null}
                    </td>
                    <td className="mono small">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</td>
                    <td className="muted small">{ago(p.at)}</td>
                    <td>
                      <a className="btn ghost sm" target="_blank" rel="noreferrer"
                        href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`}>Open</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  );
}
