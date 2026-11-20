import { useState } from 'react';
import { Btn, Card, Empty, Field, Modal, PageHeader, Spinner, Stat, Table, Tabs, useToast, useAsync } from '../components.jsx';
import { getApiBaseUrl } from '../config.js';
import { currentToken } from '../lib/pb.js';

const base = getApiBaseUrl();

const apiFetch = async (path, body) => {
  const t = currentToken();
  return fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ sessionToken: t }, body || {}))
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Request failed");
    return r.json();
  });
};

export default function Inventory({ session }) {
  const toast = useToast();
  const [tab, setTab] = useState('trends');
  const hubs = useAsync(() => apiFetch("/api/collections/service_hubs/records", { filter: "", perPage: 200 }).then((d) => (d.items || [])), []);

  return (
    <PageHeader title="Inventory & Parts Forecasting"
      subtitle="Usage trends, reorder suggestions, stock sheet and replenishment queue"
      actions={
        <div className="row">
          {hubs.data && (
            <select style={{ width: 170 }} value={session.hub || ""} onChange={(e) => { session.hub = e.target.value; }} className="small">
              <option value="">All hubs</option>
              {(hubs.data.items || []).map((h) => <option key={h.id} value={h.hub_code || h.id}>{h.hub_code || h.name}</option>)}
            </select>
          )}
        </div>
      }>
      <Tabs
        tabs={[
          { id: 'trends', label: 'Trends' },
          { id: 'forecast', label: 'Forecast' },
          { id: 'reorder', label: 'Reorder' },
          { id: 'stocksheet', label: 'Stock sheet' },
          { id: 'replenish', label: 'Replenishment' }
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'trends' ? <TrendsTab session={session} /> : null}
      {tab === 'forecast' ? <ForecastTab session={session} /> : null}
      {tab === 'reorder' ? <ReorderTab session={session} /> : null}
      {tab === 'stocksheet' ? <StockSheetTab session={session} /> : null}
      {tab === 'replenish' ? <ReplenishTab session={session} /> : null}
    </PageHeader>
  );
}

/* ------------------------------------------------- Trends ------------------------------------------------- */
function TrendsTab({ session }) {
  const [bucket, setBucket] = useState("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const data = useAsync(() => apiFetch("/api/fieldops/parts/usage", {
    bucket: bucket, from: from || undefined, to: to || undefined, groupBy: "part"
  }), [bucket, from, to]);

  return (
    <Card title="Parts used over time" actions={
      <div className="row">
        <select value={bucket} onChange={(e) => setBucket(e.target.value)} style={{ width: 110 }}>
          <option value="month">Month</option><option value="week">Week</option><option value="day">Day</option>
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 130 }} placeholder="From" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 130 }} placeholder="To" />
        <Btn onClick={data.reload} disabled={data.loading}>Refresh</Btn>
      </div>
    }>
    {data.loading ? <Spinner label="Loading usage…" /> : null}
    {data.error ? <div className="hint-banner">{data.error.message}</div> : null}
    {data.data && !data.loading ? (
      <>
        <div className="grid cols-2" style={{ marginBottom: 12 }}>
          <Stat label="Parts tracked" value={data.data.totals.parts} />
          <Stat label="Total qty" value={data.data.totals.qty} />
        </div>
        <div style={{ height: 260 }}>
          <svg width="100%" height="240" role="chart" aria-label="Parts usage over time">
            <BarChart data={data.data} bucket={data.data.bucket} />
          </svg>
        </div>
        <Table
          columns={[
            { key: "part_code", label: "Part code", render: (r) => r.part_code || "—" },
            { key: "total", label: "Total qty", render: (r) => r.total },
            { key: "abc", label: "ABC", render: (r) => r.abc || "—" },
            { key: "last", label: "Last used", render: (r) => r.last || "—" }
          ]}
          rows={data.data.parts.slice(0, 25)}
          rowKey={(r) => r.part_code}
          empty="No usage data."
        />
      </>
    ) : null}
    </Card>
  );
}

function BarChart({ data, bucket }) {
  const parts = (data.parts || []).slice(0, 12);
  const buckets = data.buckets || [];
  if (!parts.length || !buckets.length) return null;
  const totals = {};
  buckets.forEach((b) => { totals[b] = 0; });
  parts.forEach((p) => {
    Object.entries(p.buckets || {}).forEach(([b, v]) => { if (totals[b] !== undefined) totals[b] += Number(v || 0); });
  });
  const vals = buckets.map((b) => totals[b] || 0);
  const max = Math.max(...vals) || 1;
  const w = 700, h = 200, pad = 40;
  const bw = (w - pad * 2) / Math.max(buckets.length, 1);
  return (
    <svg width={w} height={h} role="chart" aria-label="Parts usage over time">
      <rect width="100%" height="100%" fill="#fff" />
      <line x1={pad} y1={h - 30} x2={w} y2={h - 30} stroke="#cbd5e1" strokeWidth={1} />
      {buckets.map((b, i) => {
        const v = totals[b] || 0;
        const barH = (v / max) * (h - 60);
        const x = pad + i * bw + bw * 0.2;
        return (
          <g key={b}>
            <rect x={x} y={h - 30 - barH} width={bw * 0.6} height={barH} fill="#25d366" />
            <text x={x + bw * 0.3} y={h - 18} fontSize={10} fill="#64748b" textAnchor="middle">{b}</text>
          </g>
        );
      })}
      <text x={20} y={20} fontSize={12} fill="#0f172a" fontWeight="600">Qty by {bucket}</text>
    </svg>
  );
}

/* ------------------------------------------------- Forecast ------------------------------------------------- */
function ForecastTab({ session }) {
  const [horizon, setHorizon] = useState(4);
  const data = useAsync(() => apiFetch("/api/fieldops/parts/forecast", { horizon: horizon }), [horizon]);
  return (
    <Card title="Parts forecast" actions={
      <div className="row">
        <span className="small">Horizon (weeks):</span>
        <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} style={{ width: 90 }}>
          {[4, 8, 12, 16, 20, 24, 52].map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <Btn onClick={data.reload} disabled={data.loading}>Refresh</Btn>
      </div>
    }>
    {data.loading ? <Spinner label="Computing forecast…" /> : null}
    {data.error ? <div className="hint-banner">{data.error.message}</div> : null}
    {data.data && !data.loading ? (
      <Table
        columns={[
          { key: "part_code", label: "Part code", render: (r) => r.part_code || "—" },
          { key: "avg", label: "Avg/wk", render: (r) => r.avg },
          { key: "forecast", label: "Forecast", render: (r) => r.forecast },
          { key: "safety", label: "Safety", render: (r) => r.safety },
          { key: "reorder", label: "Reorder pt", render: (r) => r.reorder },
          { key: "suggested", label: "Suggest qty", render: (r) => r.suggested },
          { key: "coverDays", label: "Cover (days)", render: (r) => r.coverDays },
          { key: "flags", label: "Flag", render: (r) => <span className={r.flags === "CRITICAL" ? "badge bad" : (r.flags === "BELOW_REORDER" ? "badge warn" : "badge ok")}>{r.flags}</span> },
          { key: "intermittent", label: "Intermittent", render: (r) => r.intermittent ? "yes" : "no" }
        ]}
        rows={data.data.rows}
        rowKey={(r) => r.part_code}
        empty="No forecastable parts (need 2+ usage buckets)."
      />
    ) : null}
    </Card>
  );
}

/* ------------------------------------------------- Reorder ------------------------------------------------- */
function ReorderTab({ session }) {
  const data = useAsync(() => apiFetch("/api/fieldops/parts/forecast", { horizon: 4 }), []);
  const rows = (data.data && data.data.rows || []).filter((r) => r.flags !== "OK");
  return (
    <Card title="Reorder suggestions" subtitle="Parts below reorder point, sorted by suggested quantity">
    {data.loading ? <Spinner label="Loading…" /> : null}
    {data.error ? <div className="hint-banner">{data.error.message}</div> : null}
    {!data.loading && data.data ? (
      <>
        <p className="small muted">{rows.length} part(s) need attention.</p>
        <Table
          columns={[
            { key: "part_code", label: "Part code", render: (r) => r.part_code || "—" },
            { key: "onhand_est", label: "On hand (est.)", render: (r) => "—" },
            { key: "suggested", label: "Suggested qty", render: (r) => r.suggested },
            { key: "coverDays", label: "Cover days", render: (r) => r.coverDays },
            { key: "flags", label: "Flag", render: (r) => <span className={r.flags === "CRITICAL" ? "badge bad" : "badge warn"}>{r.flags}</span> }
          ]}
          rows={rows}
          rowKey={(r) => r.part_code}
          empty="All parts are stocked adequately."
        />
      </>
    ) : null}
    </Card>
  );
}

/* ------------------------------------------------- Stock sheet ------------------------------------------------- */
function StockSheetTab({ session }) {
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState(null);
  const [file, setFile] = useState(null);

  const fetchSheet = useCallback(async () => {
    const res = await apiFetch("/api/fieldops/inventory/export", {});
    setResult(res);
    setRows((res.csv || "").split("\n").slice(1).map((line) => {
      const v = line.split(",");
      return { hub_id: v[0], part_code: v[1], component: v[2], critical: v[4], on_hand: Number(v[5]) || 0, adj: 0, movement_type: "ADJUSTMENT", reason: "" };
    }).filter((r) => r.part_code));
  }, [apiFetch]);

  const handleFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = (ev) => {
      const lines = ev.target.result.split(/\r?\n/).map(l => l.trim()).filter(l => l);
      if (lines.length < 2) return;
      const header = lines[0].split(",");
      const parsed = lines.slice(1).map((line) => {
        const vals = line.split(",");
        const obj = {};
        header.forEach((h, i) => obj[h] = (vals[i] || "").trim());
        return obj;
      });
      setRows(parsed.map((r) => ({
        hub_id: r.hub_id || session.hub || "", part_code: r.part_code, component: r.component || "",
        critical: r.critical, on_hand: Number(r.on_hand) || 0, adj: Number(r.qty) || 0,
        movement_type: r.movement_type || "ADJUSTMENT", reason: r.reason || ""
      })));
    };
    fr.readAsText(f);
  };

  const runValidate = async () => {
    const toSend = rows.map((r) => ({
      hub_id: r.hub_id, part_code: r.part_code, qty: Number(r.adj) || 0,
      movement_type: r.movement_type, reason: r.reason
    }));
    const res = await apiFetch("/api/fieldops/inventory/validate", { rows: toSend });
    setResult(res);
    if (res.success) toast.push("Sheet validated: " + res.accepted + " ok, " + res.rejected + " issues", res.rejected ? "bad" : "ok");
  };

  const runApply = async () => {
    const toSend = rows.map((r) => ({
      hub_id: r.hub_id, part_code: r.part_code, qty: Number(r.adj) || 0,
      movement_type: r.movement_type, reason: r.reason
    }));
    const res = await apiFetch("/api/fieldops/inventory/apply", { rows: toSend });
    setResult(res);
    if (res.success) { toast.push("Applied " + res.applied + " stock movement(s)", "ok"); fetchSheet(); }
  };

  return (
    <Card title="Stock sheet" subtitle="Editable per-hub part stock. Enter adjustment qty (+/-) and movement type.">
    <div className="row" style={{ marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
      <input type="file" accept=".csv" onChange={handleFile} />
      <Btn onClick={fetchSheet}>Refresh from server</Btn>
      <Btn onClick={runValidate}>Validate</Btn>
      <Btn onClick={runApply}>Apply changes</Btn>
    </div>
    {result && !result.success && <div className="hint-banner">{result.message}</div>}
    {result && result.success && !result.dry_run && !Array.isArray(result.rows) && <div className="hint-banner" style={{ borderColor: "var(--ok,#22c55e)" }}>Applied {result.applied} movement(s).</div>}
    {rows.length ? (
      <Table
        columns={[
          { key: "part_code", label: "Part", render: (r) => r.part_code || "—" },
          { key: "component", label: "Component", render: (r) => r.component || "—" },
          { key: "critical", label: "Class", render: (r) => r.critical || "—" },
          { key: "on_hand", label: "On hand", render: (r) => r.on_hand },
          { key: "adj", label: "Adjust qty", render: (r) => <input type="number" value={r.adj} onChange={(ev) => { r.adj = Number(ev.target.value) || 0; }} style={{ width: 70 }} /> },
          { key: "movement_type", label: "Movement", render: (r) => <select value={r.movement_type} onChange={(ev) => { r.movement_type = ev.target.value; }} style={{ width: 110 }}><option value="ADJUSTMENT">Adjustment</option><option value="RECEIPT">Receipt</option><option value="ISSUE">Issue</option><option value="CYCLE_COUNT">Cycle count</option></select> },
          { key: "reason", label: "Reason", render: (r) => <input value={r.reason} onChange={(ev) => { r.reason = ev.target.value; }} style={{ width: 140 }} /> }
        ]}
        rows={rows}
        rowKey={(r) => r.hub_id + "|" + r.part_code}
        empty="No stock rows. Click Refresh from server or upload a CSV."
      />
    ) : (
      <Field label="CSV file"><input type="file" accept=".csv" onChange={handleFile} /></Field>
    )}
    </Card>
  );
}

/* ------------------------------------------------- Replenishment ------------------------------------------------- */
function ReplenishTab({ session }) {
  const [reqs, setReqs] = useState([]);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/fieldops/replenishment/list", {});
    setReqs(res.requests || []);
  }, [apiFetch]);

  const runCheck = async () => {
    const res = await apiFetch("/api/fieldops/inventory/stock-check", {});
    setResult(res);
    if (res.success) toast.push("Stock check: " + res.created + " replenishment request(s) created, " + res.notified + " notified", "ok");
    load();
  };

  const transition = async (req, status) => {
    const res = await apiFetch("/api/fieldops/replenishment/transition", { reqId: req.id, status: status });
    if (res.success) { toast.push("Request " + req.id + " → " + status, "ok"); load(); }
    else toast.push(res.message || "Transition failed", "bad");
  };

  return (
    <Card title="Replenishment queue" subtitle="Auto-created when stock falls below reorder point">
    <div className="row" style={{ marginBottom: 10, gap: 10 }}>
      <Btn onClick={runCheck}>Run stock check now</Btn>
      <Btn onClick={load}>Refresh</Btn>
    </div>
    {result && !result.success && <div className="hint-banner">{result.message}</div>}
    {result && result.success && <div className="hint-banner" style={{ borderColor: "var(--ok,#22c55e)" }}>Created {result.created} request(s), notified {result.notified} manager(s).</div>}
    <Table
      columns={[
        { key: "part_code", label: "Part", render: (r) => r.part_code || "—" },
        { key: "priority", label: "Priority", render: (r) => <span className={r.priority === "CRITICAL" ? "badge bad" : (r.priority === "HIGH" ? "badge warn" : "badge ok")}>{r.priority}</span> },
        { key: "current_qty", label: "Current qty", render: (r) => r.current_qty },
        { key: "suggested_qty", label: "Suggested", render: (r) => r.suggested_qty },
        { key: "status", label: "Status", render: (r) => r.status },
        { key: "actions", label: "Action", render: (r) => {
            const btns = [];
            if (r.status === "OPEN") btns.push(<Btn key="ack" size="sm" onClick={() => transition(req, "ACK")}>Ack</Btn>);
            if (r.status === "ACK") btns.push(<Btn key="appr" size="sm" onClick={() => transition(req, "APPROVED")}>Approve</Btn>);
            if (r.status === "APPROVED") btns.push(<Btn key="order" size="sm" onClick={() => transition(req, "ORDERED")}>Order</Btn>);
            if (r.status === "ORDERED") btns.push(<Btn key="recv" size="sm" onClick={() => transition(req, "RECEIVED")}>Receive</Btn>);
            btns.push(<Btn key="cancel" size="sm" variant="ghost" onClick={() => transition(req, "CANCELLED")}>Cancel</Btn>);
            return btns;
          }}
      ]}
      rows={reqs}
      rowKey={(r) => r.id}
      empty="No replenishment requests."
    />
    </Card>
  );
}
