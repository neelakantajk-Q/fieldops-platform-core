import { useState, useCallback, useEffect } from 'react';
import { call } from '../api.js';
import { Btn, Card, Empty, Field, Modal, PageHeader, Spinner, Table, Tabs, ToastProvider, useToast, useAsync } from '../components.jsx';
import { getApiBaseUrl } from '../config.js';
import { currentToken } from '../lib/pb.js';
import { listRecords } from '../lib/fieldops.js';

const base = getApiBaseUrl();
const token = currentToken();

export default function BulkParts({ session }) {
  const toast = useToast();
  const [tab, setTab] = useState('download');

  return (
    <ToastProvider>
      <PageHeader title="Bulk Parts Correction"
        subtitle="Download job-card part lines, correct part code + qty offline, then re-upload for validation" />
      <Tabs
        tabs={[
          { id: 'download', label: 'Download' },
          { id: 'upload', label: 'Upload & Validate' },
          { id: 'batches', label: 'Batches' }
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'download' ? <DownloadCard session={session} /> : null}
      {tab === 'upload' ? <UploadCard session={session} /> : null}
      {tab === 'batches' ? <BatchesCard session={session} /> : null}
    </ToastProvider>
  );
}

/* ------------------------------------------------- download ------------------------------------------------- */
function DownloadCard({ session }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [unresolved, setUnresolved] = useState(true);
  const [templateType, setTemplateType] = useState('parts_master');
  const x = useAsync(() => {
    return fetch(base + "/api/fieldops/bulk-parts/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionToken: token, dateFrom: from || undefined, dateTo: to || undefined,
        unresolvedOnly: unresolved
      })
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Export failed");
      return r.json();
    });
  }, [from, to, unresolved]);

  const downloadTemplate = async () => {
    const res = await fetch(base + "/api/fieldops/bulk-parts/template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token, type: templateType })
    });
    if (!res.ok) throw new Error("Template download failed");
    const data = await res.json();
    downloadBlob(data.csv, data.filename);
    toast.push("Template downloaded: " + data.filename, "ok");
  };

  return (
    <Card title="Download part lines for correction"
      actions={
        <div className="row">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 140 }} placeholder="From" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 140 }} placeholder="To" />
          <label><input type="checkbox" checked={unresolved} onChange={(e) => setUnresolved(e.target.checked)} style={{ width: "auto", marginRight: 6 }} /> UNBILLED only</label>
          <Btn onClick={x.reload} disabled={x.loading}>{x.loading ? "Generating…" : "Download CSV"}</Btn>
        </div>
      }>
      <div className="row" style={{ marginTop: 10, gap: 10 }}>
        <select value={templateType} onChange={(e) => setTemplateType(e.target.value)} style={{ width: 170 }}>
          <option value="parts_master">Parts master</option>
          <option value="vehicle_registry">Vehicle registry</option>
          <option value="inventory_stock">Inventory stock</option>
          <option value="job_card_parts">Job-card parts</option>
        </select>
        <Btn onClick={downloadTemplate}>Download template</Btn>
        <p className="small muted">Use the template to bulk-upload master data or corrections.</p>
      </div>
      {x.loading ? <Spinner label="Building export…" /> : null}
      {x.error ? <div className="hint-banner">{x.error.message}</div> : null}
      {x.data && !x.loading ? (
        <>
          <p className="small muted">{x.data.count} part line(s) ready → <b>{x.data.filename}</b></p>
          <Btn onClick={() => downloadBlob(x.data.csv, x.data.filename)}>Save file</Btn>
        </>
      ) : null}
    </Card>
  );
}

function downloadBlob(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------- upload ------------------------------------------------- */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.replace(/^"|"$"/g, "").trim());
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj = {};
    header.forEach((h, i) => { obj[h] = (vals[i] || "").replace(/^"|"$"/g, "").trim(); });
    return obj;
  });
}

function UploadCard({ session }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [result, setResult] = useState(null);
  const [applied, setApplied] = useState(false);
  const [partCodes, setPartCodes] = useState(null);

  useEffect(() => {
    listRecords('parts_master', 'filter=(active=true)')
      .then((rows) => {
        const set = new Set((rows || []).map((p) => String(p.part_code || '').trim().toUpperCase()));
        setPartCodes(set);
      })
      .catch(() => setPartCodes(null));
  }, []);

  const unknownCodes = preview
    .map((r) => String(r.part_code || '').trim().toUpperCase())
    .filter((c) => c && partCodes && !partCodes.has(c));
  const unknownSet = new Set(unknownCodes);

  const handleFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFile(f);
    const r = new FileReader();
    r.onload = (ev) => {
      try { setPreview(parseCsv(ev.target.result)); } catch (err) { toast.push("Failed to parse CSV: " + err.message, "bad"); }
    };
    r.readAsText(f);
  };

  const runValidate = async () => {
    setApplied(false);
    const res = await fetch(base + "/api/fieldops/bulk-parts/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token, rows: preview })
    });
    const data = await res.json();
    setResult(data);
    if (data.success) toast.push(`Validation: ${data.accepted} accepted, ${data.rejected} rejected`, data.rejected ? "bad" : "ok");
    else toast.push(data.message || "Validation failed", "bad");
  };

  const runApply = async () => {
    const res = await fetch(base + "/api/fieldops/bulk-parts/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token, rows: preview })
    });
    const data = await res.json();
    setApplied(true);
    setResult(data);
    if (data.success) toast.push(`Applied ${data.applied} row(s)`, "ok");
    else toast.push(data.message || "Apply failed", "bad");
  };

  return (
    <Card title="Upload corrected parts"
      subtitle="CSV columns: line_uid,job_card_no,job_date,vin,plate,model,part_code,qty,status,revision">
      {preview.length === 0 ? (
        <>
          <Field label="CSV file"><input type="file" accept=".csv" onChange={handleFile} /></Field>
          <p className="small muted">Export first from the Download tab, edit part_code and qty, then upload here.</p>
        </>
      ) : (
        <>
          <p className="small muted">{preview.length} row(s) in file.</p>
          {partCodes === null ? null : unknownCodes.length ? (
            <div className="hint-banner" style={{ marginBottom: 8 }}>
              {unknownCodes.length} part code{unknownCodes.length === 1 ? '' : 's'} not found in the parts master:
              {' '}<span className="mono small">{Array.from(new Set(unknownCodes)).slice(0, 8).join(', ')}</span>
              {new Set(unknownCodes).size > 8 ? '…' : ''}
            </div>
          ) : (
            <div className="hint-banner" style={{ borderColor: 'var(--ok,#22c55e)', marginBottom: 8 }}>
              Pre-check passed — every part code exists in the parts master.
            </div>
          )}
          <Table
            columns={[
              { key: "line_uid", label: "Line", render: (r) => r.line_uid || "—" },
              { key: "job_card_no", label: "Job card", render: (r) => r.job_card_no || "—" },
              { key: "part_code", label: "Part code", render: (r) => r.part_code || "—" },
              { key: "qty", label: "Qty", render: (r) => r.qty || "—" },
              {
                key: "precheck", label: "Pre-check",
                render: (r) => {
                  const code = String(r.part_code || '').trim().toUpperCase();
                  if (!code) return <span className="badge warn">MISSING</span>;
                  if (partCodes === null) return <span className="badge neutral">—</span>;
                  return unknownSet.has(code)
                    ? <span className="badge bad">UNKNOWN</span>
                    : <span className="badge ok">OK</span>;
                }
              }
            ]}
            rows={preview.slice(0, 30)}
            empty="No rows."
          />
          {preview.length > 30 && <p className="small muted">Showing first 30 rows.</p>}
          <div className="row">
            <Btn onClick={runValidate} disabled={result && !result.success}>Dry run</Btn>
            <Btn onClick={runApply} disabled={applied || !result || !result.success}>Apply changes</Btn>
          </div>
          {result && !result.success && <div className="hint-banner">{result.message}</div>}
          {result && result.success && (
            <div className="hint-banner" style={{ borderColor: "var(--ok,#22c55e)" }}>
              Dry run: {result.accepted} accepted, {result.rejected} rejected.
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------- batches ------------------------------------------------- */
function BatchesCard({ session }) {
  const x = useAsync(() => {
    return fetch(base + "/api/fieldops/bulk-parts/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token })
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Failed");
      return r.json();
    });
  }, []);

  return (
    <Card title="Import batches" actions={<Btn onClick={x.reload} disabled={x.loading}>Refresh</Btn>}>
      {x.loading ? <Spinner label="Loading batches…" /> : null}
      {x.error ? <div className="hint-banner">{x.error.message}</div> : null}
      {x.data && !x.loading ? (
        <Table
          columns={[
            { key: "file_name", label: "File", render: (r) => r.file_name || "—" },
            { key: "status", label: "Status", render: (r) => r.status || "—" },
            { key: "row_count", label: "Rows", render: (r) => r.row_count || 0 },
            { key: "accepted", label: "Accepted", render: (r) => r.accepted || 0 },
            { key: "rejected", label: "Rejected", render: (r) => r.rejected || 0 },
            { key: "uploaded_at", label: "Uploaded", render: (r) => r.uploaded_at || "—" }
          ]}
          rows={x.data.batches || []}
          empty="No batches yet."
        />
      ) : null}
    </Card>
  );
}
