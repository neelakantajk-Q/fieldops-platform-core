import { useState } from 'react';
import { Btn, Card, Field, PageHeader, Spinner, Table, useAsync, useToast } from '../components.jsx';
import { fieldopsPost, listRecords } from '../lib/fieldops.js';

const OPEN_JOB_STATES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD'];

export default function PartExtract() {
  const toast = useToast();
  const jobs = useAsync(() => listRecords('job_cards'), []);
  const [jobCardId, setJobCardId] = useState('');
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [useLlm, setUseLlm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [rows, setRows] = useState([]);

  const jobRows = (jobs.data || []).filter((j) => OPEN_JOB_STATES.indexOf(j.status) >= 0);
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
    </>
  );
}
