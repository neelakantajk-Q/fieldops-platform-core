import { useMemo, useState } from 'react';
import { Btn, Card, Field, Modal, PageHeader, Spinner, Table, Tabs, useAsync, useToast } from '../components.jsx';
import { fieldopsPost, listRecords } from '../lib/fieldops.js';

const STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'CANCELLED'];
const OPEN_STATES = ['DRAFT', 'ISSUED'];

function money(n) {
  return 'INR ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function day(v) {
  return v ? String(v).replace(' ', 'T').slice(0, 10) : '—';
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function download(csv, filename) {
  const blob = new Blob([csv || ''], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'export.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Billing() {
  const toast = useToast();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);
  const list = useAsync(() => fieldopsPost('/api/fieldops/billing/list', {}), []);

  const items = (list.data && list.data.items) || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((r) => {
      if (tab !== 'all' && r.status !== tab) return false;
      if (!q) return true;
      return `${r.invoiceNo} ${r.jobCode} ${r.customerName} ${r.plate}`.toLowerCase().indexOf(q) >= 0;
    });
  }, [items, tab, search]);

  const exportAll = async () => {
    try {
      const res = await fieldopsPost('/api/fieldops/billing/export', { status: tab === 'all' ? undefined : tab });
      download(res.csv, res.filename);
      toast.push(`Exported ${res.count || 0} invoice(s).`, 'ok');
    } catch (e) { toast.push(e.message, 'bad'); }
  };

  return (
    <>
      <PageHeader title="Billing" subtitle="Per-job invoices: parts from the master price list, plus labour and consumables with GST"
        actions={<div className="row" style={{ gap: 8 }}>
          <Btn variant="ghost" onClick={exportAll}>Export CSV</Btn>
          <Btn onClick={() => setCreating(true)}>New invoice</Btn>
        </div>}>
        <Tabs
          tabs={[{ id: 'all', label: 'All' }, ...STATUSES.map((s) => ({ id: s, label: s[0] + s.slice(1).toLowerCase() }))]}
          active={tab}
          onChange={setTab}
        />
        <Card
          title={`${filtered.length} invoice(s)`}
          actions={<input placeholder="Search invoice / job / customer" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} />}>
          {list.loading ? <Spinner label="Loading invoices…" /> : null}
          {list.error ? <div className="hint-banner">{list.error.message}</div> : null}
          {!list.loading && list.data ? (
            <Table
              columns={[
                { key: 'invoiceNo', label: 'Invoice', render: (r) => <strong className="mono">{r.invoiceNo || '—'}</strong> },
                { key: 'jobCode', label: 'Job', render: (r) => <span className="mono small">{r.jobCode || '—'}</span> },
                { key: 'customerName', label: 'Customer', render: (r) => r.customerName || '—' },
                { key: 'plate', label: 'Vehicle', render: (r) => r.plate || '—' },
                { key: 'total', label: 'Total', render: (r) => money(r.total) },
                {
                  key: 'status', label: 'Status',
                  render: (r) => (
                    <span className={`badge ${r.status === 'PAID' ? 'ok' : r.status === 'CANCELLED' ? 'bad' : r.status === 'ISSUED' ? 'primary' : 'warn'}`}>
                      {r.status}
                    </span>
                  )
                },
                { key: 'issuedAt', label: 'Issued', render: (r) => day(r.issuedAt) },
                { key: 'actions', label: '', render: (r) => <Btn size="sm" variant="ghost" onClick={() => setDetail(r)}>Open</Btn> }
              ]}
              rows={filtered}
              rowKey={(r) => r.id}
              empty="No invoices in this view."
            />
          ) : null}
        </Card>
      </PageHeader>

      {detail ? (
        <InvoiceDetail item={detail} toast={toast}
          onClose={() => setDetail(null)}
          onChanged={() => { setDetail(null); list.reload(); }} />
      ) : null}
      {creating ? (
        <InvoiceCreate toast={toast}
          onClose={() => setCreating(false)}
          onCreated={(created) => { setCreating(false); list.reload(); setDetail(created); }} />
      ) : null}
    </>
  );
}

function printInvoice(inv, lines) {
  const w = window.open('', '_blank');
  if (!w) return;
  const rows = (lines || []).map((l) => `
    <tr>
      <td>${esc(l.kind)}</td>
      <td>${esc(l.partCode || '—')}</td>
      <td>${esc(l.description || '')}</td>
      <td class="r">${l.qty}</td>
      <td class="r">${esc(Number(l.unitPrice || 0).toFixed(2))}</td>
      <td class="r">${l.taxRate}%</td>
      <td class="r">${esc(Number(l.lineTotal || 0).toFixed(2))}</td>
    </tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.invoiceNo)}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:32px}
      h1{font-size:20px;margin:0 0 4px}
      .muted{color:#64748b;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:18px;font-size:12px}
      th,td{border-bottom:1px solid #e2e8f0;padding:8px 6px;text-align:left;vertical-align:top}
      th{background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
      .r{text-align:right}
      .totals{margin-top:14px;width:320px;margin-left:auto;font-size:13px}
      .totals div{display:flex;justify-content:space-between;padding:4px 0}
      .totals .grand{border-top:2px solid #0f172a;font-weight:700;font-size:15px;margin-top:6px;padding-top:8px}
      .grid{display:flex;gap:32px;margin-top:14px;font-size:12px}
      .grid div{min-width:180px}
    </style></head><body>
    <h1>${esc(inv.currency || 'INR')} Invoice ${esc(inv.invoiceNo)}</h1>
    <div class="muted">Job ${esc(inv.jobCode || '')} · Vehicle ${esc(inv.plate || '—')} · Status ${esc(inv.status)}</div>
    <div class="grid">
      <div><b>Bill to</b><br>${esc(inv.customerName || '—')}<br>${esc(inv.customerAddress || '')}<br>${inv.customerGstin ? 'GSTIN: ' + esc(inv.customerGstin) : ''}</div>
      <div><b>Dates</b><br>Issued: ${esc(day(inv.issuedAt))}<br>Due: ${esc(day(inv.dueDate))}${inv.paidAt ? '<br>Paid: ' + esc(day(inv.paidAt)) : ''}</div>
    </div>
    <table><thead><tr><th>Type</th><th>Code</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="totals">
      <div><span>Parts</span><span>${esc(Number(inv.partsSubtotal || 0).toFixed(2))}</span></div>
      <div><span>Labour</span><span>${esc(Number(inv.labourSubtotal || 0).toFixed(2))}</span></div>
      <div><span>Consumables</span><span>${esc(Number(inv.consumablesSubtotal || 0).toFixed(2))}</span></div>
      <div><span>Subtotal</span><span>${esc(Number(inv.subtotal || 0).toFixed(2))}</span></div>
      <div><span>GST</span><span>${esc(Number(inv.taxTotal || 0).toFixed(2))}</span></div>
      <div class="grand"><span>Total</span><span>${esc(Number(inv.total || 0).toFixed(2))}</span></div>
    </div>
    ${inv.notes ? `<p class="muted" style="margin-top:18px">${esc(inv.notes)}</p>` : ''}
    </body></html>`;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

function InvoiceDetail({ item, toast, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    customerName: item.customerName || '',
    customerGstin: item.customerGstin || '',
    customerAddress: item.customerAddress || '',
    dueDate: item.dueDate ? String(item.dueDate).replace(' ', 'T').slice(0, 10) : '',
    notes: item.notes || ''
  });
  const detail = useAsync(() => fieldopsPost('/api/fieldops/billing/get', { id: item.id }), [item.id]);
  const lines = (detail.data && detail.data.lines) || [];
  const full = (detail.data && detail.data.item) || item;
  const editable = OPEN_STATES.indexOf(full.status) >= 0;
  const upd = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await fieldopsPost('/api/fieldops/billing/update', Object.assign({ id: full.id }, form));
      toast.push('Invoice details saved.', 'ok');
      detail.reload();
    } catch (e) { toast.push(e.message, 'bad'); }
    finally { setBusy(false); }
  };

  const move = async (to) => {
    let paymentRef = '';
    if (to === 'PAID') {
      paymentRef = window.prompt('Payment reference (optional):', '') || '';
    }
    if (to === 'CANCELLED' && !window.confirm(`Cancel ${full.invoiceNo}? Billed parts will return to UNBILLED.`)) return;
    setBusy(true);
    try {
      await fieldopsPost('/api/fieldops/billing/transition', { id: full.id, to, paymentRef });
      toast.push(`Invoice ${to.toLowerCase()}.`, 'ok');
      onChanged();
    } catch (e) { toast.push(e.message, 'bad'); }
    finally { setBusy(false); }
  };

  const exportOne = async () => {
    try {
      const res = await fieldopsPost('/api/fieldops/billing/export', { id: full.id });
      download(res.csv, res.filename);
    } catch (e) { toast.push(e.message, 'bad'); }
  };

  const footer = (
    <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <Btn variant="ghost" onClick={exportOne} disabled={busy}>Export CSV</Btn>
      <Btn variant="ghost" onClick={() => printInvoice(full, lines)} disabled={busy}>Print</Btn>
      {editable ? <Btn variant="ghost" onClick={save} disabled={busy}>Save details</Btn> : null}
      {full.status === 'DRAFT' ? <Btn onClick={() => move('ISSUED')} disabled={busy}>Issue</Btn> : null}
      {full.status === 'ISSUED' ? <Btn onClick={() => move('PAID')} disabled={busy}>Mark paid</Btn> : null}
      {OPEN_STATES.indexOf(full.status) >= 0 ? <Btn variant="ghost" onClick={() => move('CANCELLED')} disabled={busy}>Cancel</Btn> : null}
    </div>
  );

  return (
    <Modal open wide title={`${full.invoiceNo} · ${full.status}`} onClose={onClose} footer={footer}>
      {detail.error ? <div className="hint-banner">{detail.error.message}</div> : null}
      <div className="grid two">
        <Field label="Job"><div className="mono">{full.jobCode || '—'}</div></Field>
        <Field label="Vehicle"><div>{full.plate || '—'}</div></Field>
        <Field label="Issued"><div>{day(full.issuedAt)}</div></Field>
        <Field label="Paid"><div>{day(full.paidAt)}{full.paymentRef ? ` · ${full.paymentRef}` : ''}</div></Field>
      </div>
      <Field label="Customer"><input value={form.customerName} onChange={(e) => upd('customerName', e.target.value)} disabled={!editable} /></Field>
      <div className="grid two">
        <Field label="GSTIN"><input value={form.customerGstin} onChange={(e) => upd('customerGstin', e.target.value)} disabled={!editable} /></Field>
        <Field label="Due date"><input type="date" value={form.dueDate} onChange={(e) => upd('dueDate', e.target.value)} disabled={!editable} /></Field>
      </div>
      <Field label="Billing address"><textarea rows={2} value={form.customerAddress} onChange={(e) => upd('customerAddress', e.target.value)} disabled={!editable} /></Field>

      <Card title="Lines" pad={false}>
        {detail.loading ? <Spinner label="Loading lines…" /> : (
          <div style={{ padding: 8 }}>
            <Table
              columns={[
                { key: 'kind', label: 'Type', render: (l) => <span className="badge neutral">{l.kind}</span> },
                { key: 'partCode', label: 'Code', render: (l) => <span className="mono small">{l.partCode || '—'}</span> },
                { key: 'description', label: 'Description', render: (l) => l.description || '—' },
                { key: 'qty', label: 'Qty', render: (l) => l.qty },
                { key: 'unitPrice', label: 'Rate', render: (l) => money(l.unitPrice) },
                { key: 'taxRate', label: 'GST', render: (l) => `${l.taxRate}%` },
                { key: 'lineTotal', label: 'Amount', render: (l) => money(l.lineTotal) }
              ]}
              rows={lines}
              rowKey={(l) => l.id}
              empty="No lines."
            />
          </div>
        )}
      </Card>

      <div className="grid two" style={{ marginTop: 12 }}>
        <div />
        <div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Parts</span><span>{money(full.partsSubtotal)}</span></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Labour</span><span>{money(full.labourSubtotal)}</span></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Consumables</span><span>{money(full.consumablesSubtotal)}</span></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Subtotal</span><span>{money(full.subtotal)}</span></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">GST</span><span>{money(full.taxTotal)}</span></div>
          <div className="row" style={{ justifyContent: 'space-between', fontWeight: 700 }}><span>Total</span><span>{money(full.total)}</span></div>
        </div>
      </div>

      <Field label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => upd('notes', e.target.value)} disabled={!editable} /></Field>
    </Modal>
  );
}

function InvoiceCreate({ toast, onClose, onCreated }) {
  const jobs = useAsync(() => listRecords('job_cards'), []);
  const [form, setForm] = useState({
    jobCardId: '', labourAmount: '', labourTaxRate: '18',
    consumablesAmount: '', consumablesTaxRate: '18',
    customerName: '', customerGstin: '', customerAddress: '',
    dueDate: '', notes: '', issue: true
  });
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));

  const jobRows = (jobs.data || []).filter((j) => j.status !== 'CANCELLED');

  const submit = async () => {
    if (!form.jobCardId) { toast.push('Select a job card first.', 'bad'); return; }
    setBusy(true);
    try {
      const res = await fieldopsPost('/api/fieldops/billing/generate', {
        jobCardId: form.jobCardId,
        labourAmount: Number(form.labourAmount) || 0,
        labourTaxRate: Number(form.labourTaxRate) || 0,
        consumablesAmount: Number(form.consumablesAmount) || 0,
        consumablesTaxRate: Number(form.consumablesTaxRate) || 0,
        customerName: form.customerName || undefined,
        customerGstin: form.customerGstin || undefined,
        customerAddress: form.customerAddress || undefined,
        dueDate: form.dueDate || undefined,
        notes: form.notes || undefined,
        issue: form.issue
      });
      toast.push(`Invoice ${res.item.invoiceNo} created.`, 'ok');
      onCreated(res.item);
    } catch (e) { toast.push(e.message, 'bad'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open wide title="New invoice" onClose={onClose}
      footer={<div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={submit} disabled={busy}>{busy ? 'Generating…' : 'Generate invoice'}</Btn>
      </div>}>
      <Field label="Job card" hint="Parts already on the job are priced from the parts master (unit price + GST).">
        <select value={form.jobCardId} onChange={(e) => upd('jobCardId', e.target.value)}>
          <option value="">Select a job…</option>
          {jobRows.map((j) => <option key={j.id} value={j.id}>{j.job_code || j.id} · {j.status}</option>)}
        </select>
      </Field>
      <div className="grid two">
        <Field label="Labour amount"><input type="number" min="0" step="0.01" value={form.labourAmount} onChange={(e) => upd('labourAmount', e.target.value)} /></Field>
        <Field label="Labour GST %"><input type="number" min="0" step="0.01" value={form.labourTaxRate} onChange={(e) => upd('labourTaxRate', e.target.value)} /></Field>
        <Field label="Consumables amount"><input type="number" min="0" step="0.01" value={form.consumablesAmount} onChange={(e) => upd('consumablesAmount', e.target.value)} /></Field>
        <Field label="Consumables GST %"><input type="number" min="0" step="0.01" value={form.consumablesTaxRate} onChange={(e) => upd('consumablesTaxRate', e.target.value)} /></Field>
      </div>
      <Field label="Customer (optional)" hint="Defaults to the job's client name."><input value={form.customerName} onChange={(e) => upd('customerName', e.target.value)} /></Field>
      <div className="grid two">
        <Field label="GSTIN"><input value={form.customerGstin} onChange={(e) => upd('customerGstin', e.target.value)} /></Field>
        <Field label="Due date"><input type="date" value={form.dueDate} onChange={(e) => upd('dueDate', e.target.value)} /></Field>
      </div>
      <Field label="Billing address"><textarea rows={2} value={form.customerAddress} onChange={(e) => upd('customerAddress', e.target.value)} /></Field>
      <Field label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => upd('notes', e.target.value)} /></Field>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={form.issue} onChange={(e) => upd('issue', e.target.checked)} style={{ width: 'auto' }} />
        <span className="small">Issue immediately (marks the job's parts as BILLED)</span>
      </label>
    </Modal>
  );
}
