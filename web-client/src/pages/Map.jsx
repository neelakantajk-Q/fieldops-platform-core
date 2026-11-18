import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { call } from '../api.js';
import { Card, Empty, PageHeader, SegTabs, Spinner, useAsync } from '../components.jsx';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; OpenStreetMap contributors';

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

export default function LiveMap({ session }) {
  const holder = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef(null);
  const [mode, setMode] = useState('Latest');
  const [auto, setAuto] = useState(true);
  const live = useAsync(() => call('getLiveLocations', {}), []);
  const trail = useAsync(() => call('getTelemetry', { limit: 500 }), []);

  const locations = (live.data && live.data.locations) || [];
  const hubs = (live.data && live.data.hubs) || [];
  const points = (trail.data && trail.data.points) || [];

  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = L.map(holder.current, { zoomControl: true, attributionControl: true })
      .setView([Number(session.lat) || 20.5937, Number(session.lng) || 78.9629], 5);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layersRef.current = null; };
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

    if (mode === 'Trails') {
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
  }, [live.data, trail.data, mode]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => { live.reload(); }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  const stale = locations.filter((p) => !recent(p.at, 15)).length;
  const mock = locations.filter((p) => p.mock).length;

  return (
    <>
      <PageHeader title="Live Map"
        subtitle="Latest technician GPS, hub geofences and telemetry trails from the cloud backend"
        actions={(
          <>
            <button className="btn ghost sm" onClick={() => { live.reload(); trail.reload(); }}>REFRESH</button>
            <button className={`btn ${auto ? '' : 'ghost'} sm`} onClick={() => setAuto((v) => !v)}>
              {auto ? 'AUTO 60s ON' : 'AUTO OFF'}
            </button>
          </>
        )} />

      <div className="row" style={{ gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <SegTabs tabs={[{ id: 'Latest', label: 'Latest' }, { id: 'Trails', label: 'Trails' }]}
          active={mode} onChange={setMode} ariaLabel="Map mode" />
        <span className="chip ok">{locations.length} live</span>
        <span className="chip warn">{stale} stale</span>
        <span className={`chip ${mock ? 'bad' : 'neutral'}`}>{mock} mock flags</span>
        <span className="chip neutral">{hubs.length} hubs</span>
      </div>

      <Card pad={false} title="Map" subtitle={`${points.length} telemetry points loaded`}>
        <div style={{ padding: 10 }}>
          <div ref={holder} style={{ height: 'min(60vh, 560px)', minHeight: 360, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }} />
        </div>
        {live.error ? <div className="hint-banner" style={{ margin: 12 }}>{live.error.message}</div> : null}
      </Card>

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
