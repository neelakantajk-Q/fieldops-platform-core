import { Badge, Btn } from '../components.jsx';

function fmtIst(v) {
  if (!v) return '-';
  const d = new Date(String(v).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(v);
  const out = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  return out + ' ' + time;
}

function fmtMin(m) {
  const n = Number(m) || 0;
  if (!n) return '-';
  if (n < 60) return n + 'm';
  return Math.floor(n / 60) + 'h ' + (n % 60) + 'm';
}

function jobTone(status) {
  const s = String(status || '');
  if (s === 'Completed') return 'ok';
  if (s === 'InProgress') return 'primary';
  if (s === 'OnHold' || s === 'HoldRequested') return 'bad';
  return 'warn';
}

export function JobDetail({ task, onClose, onEdit, onHold, checkedIn, onOpenTech, onOpenVehicle, onNewRepair, now }) {
  if (!task) return null;
  const status = String(task.status || '-');
  const tone = jobTone(status);
  const tNow = now || Date.now();
  const startMs = task.startTime ? new Date(String(task.startTime).replace(' ', 'T')).getTime() : null;
  const endMs = task.endTime ? new Date(String(task.endTime).replace(' ', 'T')).getTime() : null;
  const startOdo = task.startOdometer == null ? null : Number(task.startOdometer);
  const endOdo = task.endOdometer == null ? null : Number(task.endOdometer);
  const odoDelta = startOdo != null && endOdo != null ? endOdo - startOdo : null;
  const elapsedMin = task.turnaroundMinutes
    ? Number(task.turnaroundMinutes)
    : (startMs != null && isFinite(startMs) ? Math.max(0, Math.round((tNow - startMs) / 60000)) : 0);
  const odoUnit = task.odometerUnit || 'km';
  const canEdit = typeof onEdit === 'function';
  const canHold = typeof onHold === 'function' && Boolean(checkedIn);

  const Section = ({ title, children, defaultOpen }) => (
    <details className="jd-sec" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="jd-sec-body">{children}</div>
    </details>
  );

  const Fact = ({ label, value }) => (
    <div className="jd-fact">
      <span>{label}</span>
      <strong>{value == null || value === '' ? '-' : String(value)}</strong>
    </div>
  );

  return (
    <div className="jd">
      <div className="jd-head">
        <div>
          <div className="jd-no">{task.complaintNo ? <span className="mono small">{task.complaintNo}</span> : null}</div>
          <h2 className="jd-title">{task.jobId}</h2>
          <div className="jd-sub">{[task.vehicleNo, task.client].filter(Boolean).join(' · ') || 'Unassigned job'}</div>
        </div>
        <div className="jd-badges">
          <Badge tone={tone}>{status}</Badge>
          {task.jobType ? <Badge tone="neutral">{task.jobType === 'HUB_REPAIR' ? 'Repair' : 'Field'}</Badge> : null}
        </div>
      </div>

      <div className="jd-stats">
        <div className="jd-stat"><span>Start</span><strong>{task.startTime ? fmtIst(task.startTime) : '-'}</strong></div>
        <div className="jd-stat"><span>Stop</span><strong>{task.endTime ? fmtIst(task.endTime) : 'In progress'}</strong></div>
        <div className="jd-stat"><span>Start odo</span><strong>{startOdo != null ? `${Number(startOdo).toLocaleString()} ${odoUnit}` : '-'}</strong></div>
        <div className="jd-stat"><span>Stop odo</span><strong>{endOdo != null ? `${Number(endOdo).toLocaleString()} ${odoUnit}` : '-'}</strong></div>
        <div className="jd-stat"><span>Delta odo</span><strong>{odoDelta != null ? `${Number(odoDelta).toLocaleString()} ${odoUnit}` : '-'}</strong></div>
        <div className="jd-stat"><span>TAT</span><strong>{fmtMin(task.turnaroundMinutes || elapsedMin)}</strong></div>
        <div className="jd-stat"><span>Downtime</span><strong>{fmtMin(task.downtimeMinutes)}</strong></div>
      </div>

      {task.remarks ? (
        <Section title="Remarks" defaultOpen>
          <p className="jd-p">{task.remarks}</p>
        </Section>
      ) : null}

      <Section title="Technician" defaultOpen>
        <div className="jd-facts">
          <Fact label="Technician" value={task.assignedUserName || task.assignedUserId || '-'} />
          <Fact label="Role" value={task.technicianRole || '-'} />
          {task.technicianPhone ? <Fact label="Phone" value={task.technicianPhone} /> : null}
          {task.hubName ? <Fact label="Hub" value={task.hubName} /> : null}
        </div>
        {typeof onOpenTech === 'function' && task.technicianId ? (
          <Btn size="sm" variant="ghost" onClick={() => onOpenTech(task.technicianId)}>Open 360</Btn>
        ) : null}
      </Section>

      <Section title="Vehicle">
        <div className="jd-facts">
          <Fact label="Plate" value={task.vehicleNo || task.vehicleId || '-'} />
          {task.vehicleMake ? <Fact label="Make" value={task.vehicleMake} /> : null}
          {task.vehicleModel ? <Fact label="Model" value={task.vehicleModel} /> : null}
          {task.vehicleVin ? <Fact label="VIN" value={task.vehicleVin} /> : null}
          {task.hubName ? <Fact label="Hub" value={task.hubName} /> : null}
        </div>
        {typeof onOpenVehicle === 'function' && task.vehicleId ? (
          <Btn size="sm" variant="ghost" onClick={() => onOpenVehicle(task.vehicleId)}>Open vehicle</Btn>
        ) : null}
      </Section>

      <Section title="Customer">
        <div className="jd-facts">
          <Fact label="Client" value={task.client || task.clientName || '-'} />
          {task.clientPhone ? <Fact label="Phone" value={task.clientPhone} /> : null}
          {task.clientAddress ? <Fact label="Address" value={task.clientAddress} /> : null}
        </div>
      </Section>

      <Section title="Complaint">
        <div className="jd-facts">
          <Fact label="Complaint" value={task.complaintNo || task.complaintId || '-'} />
          <Fact label="Status" value={task.complaintStatus || '-'} />
          {task.complaintReportedAt ? <Fact label="Reported" value={fmtIst(task.complaintReportedAt)} /> : null}
          {task.complaintDescription ? <Fact label="Description" value={task.complaintDescription} /> : null}
        </div>
      </Section>

      <Section title="Work">
        <div className="jd-facts">
          {task.remarks ? <Fact label="Remarks" value={task.remarks} /> : null}
          {task.checklist ? <Fact label="Checklist" value={task.checklist} /> : null}
          {task.partsUsed ? <Fact label="Parts used" value={task.partsUsed} /> : null}
          {task.serviceNotes ? <Fact label="Service notes" value={task.serviceNotes} /> : null}
          {task.holdCategory ? <Fact label="Hold category" value={task.holdCategory} /> : null}
          {task.holdReason ? <Fact label="Hold reason" value={task.holdReason} /> : null}
        </div>
      </Section>

      <Section title="Proof" defaultOpen={false}>
        <div className="jd-facts">
          {task.startProof ? <Fact label="Start proof" value={task.startProof} /> : null}
          {task.endProof ? <Fact label="Stop proof" value={task.endProof} /> : null}
          {!task.startProof && !task.endProof ? <span className="muted">No proof captures.</span> : null}
        </div>
      </Section>

      <div className="jd-actions">
        {typeof onNewRepair === 'function' ? <Btn size="sm" variant="ghost" onClick={() => onNewRepair(task)}>New repair</Btn> : null}
        {canEdit ? <Btn size="sm" variant="ghost" onClick={() => onEdit(task)}>Edit</Btn> : null}
        {canHold ? <Btn size="sm" variant="ghost" onClick={() => onHold(task)}>Hold</Btn> : null}
        {onClose ? <Btn size="sm" variant="ghost" onClick={onClose}>Close</Btn> : null}
      </div>
    </div>
  );
}
