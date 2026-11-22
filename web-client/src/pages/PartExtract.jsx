import { useState } from 'react';
import { call } from '../api.js';
import { Btn, Card, Field, PageHeader, Spinner, Table, useAsync, useToast } from '../components.jsx';
import { fieldopsPost, listRecords } from '../lib/fieldops.js';
import { getApiBaseUrl } from '../config.js';

const OPEN_JOB_STATES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD'];

export default function PartExtract() {
  const toast = useToast();
  const jobs = useAsync(() => listRecords('job_cards'), []);
  const queue = useAsync(() => call('partsReviewQueue'), []);
  const [jobCardId, setJobCardId] = useState('');
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [useLlm, setUseLlm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prefillBusy, setPrefillBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [rows, setRows] = useState([]);
  const [qEdits, setQEdits] = useState({});

  const allJobs = jobs.data || [];
  const jobRows = allJobs.filter((j) => OPEN_JOB_STATES.indexOf(j.status) >= 0 || j.parts_extract_status === 'PENDING');
  const pendingProofJobs = allJobs.filter((j) => j.parts_extract_status === 'PENDING' && j.end_proof_photo);
  const selectedJob = jobRows.find((j) => j.id === jobCardId) || null;

  const pickImage = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) {
      toast.push('Image must be under 4 MB.', 'bad');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const s = String(ev.target.result || '');
      const comma = s.indexOf(',');
      setImage({ data: comma >= 0 ? s.slice(comma + 1) : s, mime: f.type || 'image/jpeg', name: f.name });
    };
    reader.readAsDataURL(f);
  };

  const reset = () => {
    setText('');
    setImage(null);
    setResult(null);
    setRows([]);
  };

  const runExtract = async () => {
    if (!jobCardId) { toast.push('Select a job card first.', 'bad'); return; }
    if (!text.trim() && !image) { toast.push('Paste the OCR text or attach a job-card photo.', 'bad'); return; }
    setBusy(true);
    setResult(null);
    try {
      const res = await fieldopsPost('/api/fieldops/parts/extract', {
        jobCardId,
        text: text.trim() || undefined,
        imageBase64: image ? image.data : undefined,
        mimeType: image ? image.mime : undefined,
        useLlm
      });
      setResult(res);
      setRows((res.lines || []).map((l, i) => ({
        _k: i, partCode: l.partCode, qty: l.qty, description: l.description,
        resolved: l.resolved, matchType: l.matchType
      })));
      const c = res.counts || {};
      toast.push(
        `Extracted ${c.total || 0} line(s): ${c.resolved || 0} matched, ${c.unresolved || 0} unresolved.`,
        c.unresolved ? 'warn' : 'ok'
      );
    } catch (e) {
      toast.push(e.message, 'bad');
      setResult({ error: e.message });
      setRows([]);
    } finally {
      setBusy(false);
    }
  };

  const setRow = (k, patch) => setRows((rs) => rs.map((r) => (r._k === k ? Object.assign({}, r, patch) : r)));
  const removeRow = (k) => setRows((rs) => rs.filter((r) => r._k !== k));

  const loadEndProof = async (job) => {
    if (!job || !job.end_proof_photo) return;
    setPrefillBusy(true);
    try {
      const url = `${getApiBaseUrl()}/api/files/job_cards/${job.id}/${encodeURIComponent(job.end_proof_photo)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not fetch the end-proof photo (HTTP ${res.status}).`);
      const blob = await res.blob();
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const comma = data.indexOf(',');
      setJobCardId(job.id);
      setImage({ data: comma >= 0 ? data.slice(comma + 1) : data, mime: blob.type || 'image/jpeg', name: job.end_proof_photo });
      setText('');
      setResult(null);
      setRows([]);
      toast.push(`Loaded end-proof photo for ${job.job_code || job.id}. Tap Extract parts.`, 'ok');
    } catch (e) {
      toast.push(e.message, 'bad');
    } finally {
      setPrefillBusy(false);
    }
  };

  const confirmQueueRow = async (r, patch) => {
    try {
      await call('confirmPartLine', Object.assign({ id: r.id }, patch), { queue: false });
      toast.push('Part line confirmed.', 'ok');
      queue.reload();
    } catch (e) {
      toast.push(e.message, 'bad');
    }
  };

  const apply = async () => {
    if (!rows.length) return;
    setBusy(true);
    try {
      const res = await fieldopsPost('/api/fieldops/parts/extract', {
        jobCardId,
        apply: true,
        source: 'OCR_REVIEW',
        lines: rows.map((r) => ({ partCode: r.partCode, qty: Number(r.qty) || 1, description: r.description }))
      });
      const ap = res.applied || {};
      toast.push(`Added ${ap.created || 0} part line(s); skipped ${ap.skipped || 0}.`, ap.created ? 'ok' : 'warn');
      setRows((res.lines || []).map((l, i) => ({
        _k: i, partCode: l.partCode, qty: l.qty, description: l.description,
        resolved: l.resolved, matchType: l.matchType
      })));
    } catch (e) {
      toast.push(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Part Extraction"
        subtitle="Read a job card (OCR text or photo), match part codes to the master, then post them to the job"
      />

      {pendingProofJobs.length ? (
        <Card title={`End-proof queue (${pendingProofJobs.length})`}
          subtitle="Closed jobs whose handwritten end-proof photo was captured automatically. Load the photo, review the lines, then apply.">
          <Table
            columns={[
              { key: 'job_code', label: 'Job', render: (j) => <strong>{j.job_code || j.id}</strong> },
              { key: 'status', label: 'Status', render: (j) => <span className="badge neutral">{j.status}</span> },
              { key: 'photo', label: 'End proof', render: (j) => <a className="btn ghost sm" target="_blank" rel="noreferrer" href={`${getApiBaseUrl()}/api/files/job_cards/${j.id}/${encodeURIComponent(j.end_proof_photo)}`}>View</a> },
              { key: 'actions', label: '', render: (j) => <Btn size="sm" variant="ghost" disabled={prefillBusy} onClick={() => loadEndProof(j)}>Use photo</Btn> }
            ]}
            rows={pendingProofJobs}
            rowKey={(j) => j.id}
            empty="No pending end proofs."
          />
        </Card>
      ) : null}

      <Card title="1 · Input"
        actions={<Btn size="sm" variant="ghost" onClick={reset} disabled={busy}>Clear</Btn>}>
        <div className="grid two">
          <Field label="Job card">
            <select value={jobCardId} onChange={(e) => setJobCardId(e.target.value)}>
              <option value="">Select an open job…</option>
              {jobRows.map((j) => (
                <option key={j.id} value={j.id}>{j.job_code || j.id} · {j.status}</option>
              ))}
            </select>
          </Field>
          <Field label="Job-card photo (optional)">
            <input type="file" accept="image/*" onChange={pickImage} />
          </Field>
        </div>
        {selectedJob ? (
          <p className="small muted">Target: <b>{selectedJob.job_code || selectedJob.id}</b> · {selectedJob.status}</p>
        ) : null}
        {image ? (
          <p className="small muted">Attached: {image.name} <Btn size="sm" variant="ghost" onClick={() => setImage(null)}>Remove</Btn></p>
        ) : null}

        <Field label="OCR / typed parts text"
          hint="One part per line, e.g. BRK-1042 Brake shoe x2. Text mode works without any LLM key.">
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'BRK-1042 Brake shoe x2\nOIL-2201 Engine oil 4\nAIR-FILTER-77 Air filter 1'} />
        </Field>

        <div className="row" style={{ gap: 12, alignItems: 'center', marginTop: 8 }}>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} style={{ width: 'auto' }} />
            <span className="small">Use Gemini refinement (needs a configured key)</span>
          </label>
          <Btn onClick={runExtract} disabled={busy}>{busy ? 'Extracting…' : 'Extract parts'}</Btn>
        </div>
      </Card>

      {jobs.loading ? <Spinner label="Loading job cards…" /> : null}
      {jobs.error ? <div className="hint-banner">{jobs.error.message}</div> : null}

      {result && result.error ? <div className="hint-banner">{result.error}</div> : null}
      {result && result.llmError ? (
        <div className="hint-banner">
          LLM refinement unavailable ({result.llmError}). Showing {result.llmError === 'LLM_NOT_CONFIGURED' ? 'text-based matches only' : 'local matches'}.
        </div>
      ) : null}

      {rows.length ? (
        <Card title={`2 · Review (${rows.length} line${rows.length === 1 ? '' : 's'})`}
          subtitle="Edit a code or quantity, remove noise, then post to the job. Unresolved codes are skipped."
          actions={<Btn onClick={apply} disabled={busy}>{busy ? 'Working…' : 'Apply to job'}</Btn>}>
          <Table
            columns={[
              {
                key: 'partCode', label: 'Part code',
                render: (r) => (
                  <input value={r.partCode} onChange={(e) => setRow(r._k, { partCode: e.target.value })}
                    style={{ width: 170 }} className="mono" />
                )
              },
              {
                key: 'qty', label: 'Qty',
                render: (r) => (
                  <input type="number" min="1" value={r.qty}
                    onChange={(e) => setRow(r._k, { qty: e.target.value })} style={{ width: 80 }} />
                )
              },
              { key: 'description', label: 'Description', render: (r) => r.description || '—' },
              {
                key: 'match', label: 'Match',
                render: (r) => (
                  <span className={`badge ${r.resolved ? 'ok' : 'warn'}`}>
                    {r.resolved ? (r.matchType || 'MATCHED') : 'UNRESOLVED'}
                  </span>
                )
              },
              {
                key: 'actions', label: '',
                render: (r) => <Btn size="sm" variant="ghost" onClick={() => removeRow(r._k)}>Remove</Btn>
              }
            ]}
            rows={rows}
            rowKey={(r) => r._k}
            empty="No lines extracted."
          />
        </Card>
      ) : null}

      <Card title={`3 · Review queue${queue.data && queue.data.rows ? ` (${queue.data.rows.length})` : ''}`}
        subtitle="Extracted lines flagged for review. Fix the part code or quantity, then confirm."
        actions={<Btn size="sm" variant="ghost" onClick={queue.reload} disabled={queue.loading}>Refresh</Btn>}>
        {queue.loading ? <Spinner label="Loading review queue…" /> : null}
        {queue.error ? <div className="hint-banner">{queue.error.message}</div> : null}
        {queue.data && !queue.loading ? (
          <Table
            columns={[
              { key: 'jobCode', label: 'Job', render: (r) => <strong>{r.jobCode}</strong> },
              {
                key: 'partCode', label: 'Part code',
                render: (r) => (
                  <input className="mono" style={{ width: 170 }}
                    value={(qEdits[r.id] && qEdits[r.id].partCode) !== undefined ? qEdits[r.id].partCode : r.partCode}
                    onChange={(e) => setQEdits((m) => ({ ...m, [r.id]: { ...(m[r.id] || {}), partCode: e.target.value } }))} />
                )
              },
              {
                key: 'qty', label: 'Qty',
                render: (r) => (
                  <input type="number" min="1" style={{ width: 80 }}
                    value={(qEdits[r.id] && qEdits[r.id].qty) !== undefined ? qEdits[r.id].qty : r.qty}
                    onChange={(e) => setQEdits((m) => ({ ...m, [r.id]: { ...(m[r.id] || {}), qty: e.target.value } }))} />
                )
              },
              { key: 'confidence', label: 'Confidence', render: (r) => <span className={`badge ${r.confidence >= 0.8 ? 'ok' : 'warn'}`}>{Math.round((r.confidence || 0) * 100)}%</span> },
              { key: 'status', label: 'Status', render: (r) => <span className="badge neutral">{r.status || '—'}</span> },
              {
                key: 'actions', label: '',
                render: (r) => (
                  <Btn size="sm" variant="ghost" onClick={() => confirmQueueRow(r, {
                    partCode: (qEdits[r.id] && qEdits[r.id].partCode) || r.partCode,
                    qty: (qEdits[r.id] && qEdits[r.id].qty) || r.qty
                  })}>Confirm</Btn>
                )
              }
            ]}
            rows={queue.data.rows || []}
            rowKey={(r) => r.id}
            empty="No lines need review."
          />
        ) : null}
      </Card>
    </>
  );
}
