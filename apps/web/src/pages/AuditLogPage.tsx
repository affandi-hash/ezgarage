import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Search, Clock, User, ChevronRight, RefreshCw, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';

type AuditLog = {
  id: string;
  branch_id: string | null;
  user_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  user_name?: string;
  // logAudit fields
  module?: string | null;
  record_id?: string | null;
  record_type?: string | null;
  details?: Record<string, unknown> | null;
};

type DateRange = 'today' | 'week' | 'month' | 'all';
type ActionCategory = 'all' | 'job' | 'booking' | 'customer' | 'vehicle' | 'user' | 'parts' | 'fleet' | 'settings';

const colors = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  orange: '#F15A22',
  textPrimary: '#F0F0F0',
  textSecondary: '#A0A0A0',
};

function getActionColor(action: string): string {
  const lower = action.toLowerCase();
  if (lower.includes('create') || lower.includes('created')) return '#22c55e';
  if (lower.includes('update') || lower.includes('changed') || lower.includes('edited')) return '#3b82f6';
  if (lower.includes('delete') || lower.includes('deleted') || lower.includes('removed')) return '#ef4444';
  return colors.orange;
}

function getActionLabel(action: string): string {
  return action.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-MY', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true,
  });
}

const STATUS_LABELS: Record<string, string> = {
  checked_in: 'Checked In', diagnosing: 'Diagnosing', waiting_approval: 'Waiting Approval',
  waiting_parts: 'Waiting Parts', in_progress: 'In Progress', ready: 'Ready',
  long_due: 'Long Due', closed: 'Closed',
}

function summarize(log: AuditLog): { headline: string; detail: string; icon: string; context: Record<string, string> } {
  const who = log.user_name || 'Someone'
  const a = log.action.toLowerCase()
  const d = (log.details ?? {}) as Record<string, string>
  const mod = (log.module ?? log.entity_type ?? '').toLowerCase()
  const ov = (log.old_values ?? {}) as Record<string, string>

  // Build context chips from details
  const context: Record<string, string> = {}
  if (d.plate)         context['Plate']        = String(d.plate)
  if (d.brand)         context['Brand']        = String(d.brand)
  if (d.model)         context['Model']        = String(d.model)
  if (d.customer)      context['Customer']     = String(d.customer)
  if (d.service)       context['Service']      = String(d.service)
  if (d.service_type)  context['Service Type'] = String(d.service_type)
  if (d.job_number)    context['Job No.']      = String(d.job_number)
  if (d.leave_type)    context['Leave Type']   = String(d.leave_type).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
  if (d.date_from)     context['From']         = String(d.date_from).split('-').reverse().join('/')
  if (d.date_to)       context['To']           = String(d.date_to).split('-').reverse().join('/')
  if (d.ot_hours)      context['OT Hours']     = String(d.ot_hours) + ' hrs'
  if (d.litres)        context['Litres']       = String(d.litres) + ' L'
  if (d.station)       context['Station']      = String(d.station)
  if (d.document_type) context['Doc Type']     = String(d.document_type)
  if (d.expiry)        context['Expiry']       = String(d.expiry).split('-').reverse().join('/')
  if (d.from_status)   context['From Status']  = String(d.from_status).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
  if (d.to_status)     context['To Status']    = String(d.to_status).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
  if (d.approved_by)   context['Approved By']  = String(d.approved_by)

  const vehicleRef  = d.plate       ? ` for vehicle ${d.plate}`       : ''
  const customerRef = d.customer    ? ` (${d.customer})`              : ''
  const brandRef    = d.brand && d.model ? ` ${d.brand} ${d.model}`   : ''

  // â”€â”€ Fleet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (a === 'vehicle added') {
    return { icon: 'ðŸš—', headline: `Vehicle Added â€” ${d.plate ?? ''}`, detail: `${who} registered a new vehicle${brandRef}${d.plate ? ' ('+d.plate+')' : ''} into the fleet.`, context }
  }
  if (a === 'service logged') {
    return { icon: 'ðŸ”§', headline: `Service Logged â€” ${d.service_type ?? ''}`, detail: `${who} logged a ${d.service_type ?? 'maintenance'} service${vehicleRef}.`, context }
  }
  if (a === 'fuel log added') {
    return { icon: 'â›½', headline: `Fuel Fill-up â€” ${d.litres ? d.litres+' L' : ''}`, detail: `${who} recorded a fuel fill-up${vehicleRef}${d.station ? ' at '+d.station : ''}.`, context }
  }
  if (a === 'document uploaded') {
    return { icon: 'ðŸ“„', headline: `Document Uploaded â€” ${d.document_type ?? ''}`, detail: `${who} uploaded a ${d.document_type ?? 'document'}${vehicleRef}${d.expiry ? ', expires '+String(d.expiry).split('-').reverse().join('/') : ''}.`, context }
  }

  // â”€â”€ Attendance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (a === 'leave request submitted') {
    const lt = d.leave_type?.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) ?? 'Leave'
    return { icon: 'ðŸŒ´', headline: `Leave Request â€” ${lt}`, detail: `${who} submitted a ${lt} request${d.date_from ? ' from '+String(d.date_from).split('-').reverse().join('/') : ''}${d.date_to ? ' to '+String(d.date_to).split('-').reverse().join('/') : ''}.`, context }
  }
  if (a === 'ot request submitted') {
    return { icon: 'â°', headline: `OT Request â€” ${d.ot_hours ? d.ot_hours+' hrs' : ''}`, detail: `${who} submitted an overtime request${d.date ? ' for '+String(d.date).split('-').reverse().join('/') : ''}${d.ot_hours ? ' ('+d.ot_hours+' hours)' : ''}.`, context }
  }

  // â”€â”€ Workshop / Job status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (a.startsWith('status_change:')) {
    const to = d.to_status ?? a.split(':')[1]
    const from = d.from_status ?? ov?.status ?? ''
    const fromLabel = STATUS_LABELS[from] ?? from?.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
    const toLabel = STATUS_LABELS[to] ?? to?.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
    const jobRef = d.job_number ? ` [${d.job_number}]` : ''
    return { icon: 'ðŸ”„', headline: `Job${jobRef} â†’ ${toLabel}`, detail: `${who} moved the job status${fromLabel ? ` from "${fromLabel}"` : ''} to "${toLabel}"${vehicleRef}${customerRef}.`, context }
  }
  if (a.startsWith('approval:')) {
    const to = d.to_status ?? a.split(':')[1]
    const toLabel = STATUS_LABELS[to] ?? to?.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
    const jobRef = d.job_number ? ` [${d.job_number}]` : ''
    const approver = d.approved_by ? ` by ${d.approved_by}` : ''
    return { icon: 'âœ…', headline: `Approved${jobRef} â†’ ${toLabel}`, detail: `Job approved${approver} and progressed to "${toLabel}"${vehicleRef}${customerRef}.`, context }
  }

  // â”€â”€ Generic CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (a === 'create' && mod.includes('job')) return { icon: 'ðŸ†•', headline: 'New Job Card', detail: `${who} checked in a vehicle${vehicleRef}${customerRef}${d.service ? ' for '+d.service : ''}.`, context }
  if (a === 'create' && (mod.includes('vehicle') || d.plate)) return { icon: 'ðŸš—', headline: 'Vehicle Registered', detail: `${who} registered ${d.plate ?? 'a vehicle'}${customerRef}.`, context }
  if (a === 'create' && mod.includes('customer')) return { icon: 'ðŸ§‘', headline: 'Customer Added', detail: `${who} created a customer record${d.customer ? ' for '+d.customer : ''}.`, context }
  if (a === 'create' && mod.includes('booking')) return { icon: 'ðŸ“…', headline: 'Booking Created', detail: `${who} created a new booking${vehicleRef}${customerRef}.`, context }
  if (a === 'create') return { icon: 'ðŸ†•', headline: `New ${log.module ?? log.record_type ?? 'Record'}`, detail: `${who} created a new record${vehicleRef}${customerRef}.`, context }
  if (a === 'attendance edit') return { icon: 'u{1F550}', headline: 'Attendance Edited', detail: `\ edited attendance for \\\\.`, context }
  if (a.includes('update') || a.includes('edit')) return { icon: 'âœï¸', headline: 'Record Updated', detail: `${who} edited details${vehicleRef}${customerRef}.`, context }
  if (a.includes('delete') || a.includes('remove')) return { icon: 'ðŸ—‘ï¸', headline: 'Record Deleted', detail: `${who} deleted a record${vehicleRef}.`, context }
  if (a.includes('login'))    return { icon: 'ðŸ”', headline: 'User Signed In',    detail: `${who} logged into the system.`, context }
  if (a.includes('logout'))   return { icon: 'ðŸšª', headline: 'User Signed Out',   detail: `${who} logged out.`, context }
  if (a.includes('password')) return { icon: 'ðŸ”‘', headline: 'Password Changed',  detail: `${who} changed a password.`, context }
  if (a.includes('note'))     return { icon: 'ðŸ“', headline: 'Note Added',        detail: `${who} added a note${vehicleRef}.`, context }
  if (a.includes('photo'))    return { icon: 'ðŸ“·', headline: 'Photo Uploaded',    detail: `${who} uploaded a photo${vehicleRef}.`, context }
  if (a.includes('part'))     return { icon: 'ðŸ“¦', headline: 'Parts Activity',    detail: `${who} performed a parts action.`, context }
  return { icon: 'ðŸ“‹', headline: getActionLabel(log.action), detail: `${who} performed this action${vehicleRef}${customerRef}.`, context }
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 13, color: colors.textPrimary, fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

function DetailPane({ log }: { log: AuditLog | null }) {
  const [related, setRelated] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    setRelated(null)
    if (!log) return
    const recordId = log.record_id ?? log.entity_id
    const recType = (log.record_type ?? log.entity_type ?? '').toLowerCase()
    const modLower = (log.module ?? '').toLowerCase()
    const action   = (log.action  ?? '').toLowerCase()
    if (!recordId) return

    async function fetchRelated() {
      const isJobRecord = recType.includes('job') || modLower.includes('job') || action.startsWith('status_change') || action.startsWith('approval')
      const isVehicleRecord = !isJobRecord && (recType.includes('vehicle') || recType.includes('fleet') || modLower.includes('fleet') || action.includes('vehicle') || action.includes('fuel') || action.includes('service logged') || action.includes('document'))
      if (isJobRecord) {
        const { data } = await supabase.from('jobs')
          .select('job_number, status, service_type, checked_in_at, customers!customer_id(full_name), vehicles!vehicle_id(plate_number, make, model)')
          .eq('id', recordId).single()
        if (data) setRelated({
          'Job Number': (data as any).job_number ?? 'â€”',
          'Plate': (data as any).vehicles?.plate_number ?? 'â€”',
          'Customer': (data as any).customers?.full_name ?? 'â€”',
          'Service': (data as any).service_type ?? 'â€”',
          'Current Status': ((data as any).status ?? '').replace(/_/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase()),
          'Checked In': (data as any).checked_in_at ? new Date((data as any).checked_in_at).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) : 'â€”',
        })
      } else if (isVehicleRecord) {
        const { data } = await supabase.from('fleet_vehicles')
          .select('plate_number, brand, model, year, status, current_mileage')
          .eq('id', recordId).single()
        if (data) setRelated({
          'Plate': data.plate_number ?? 'â€”',
          'Vehicle': `${data.brand} ${data.model} (${data.year})`,
          'Status': data.status ?? 'â€”',
          'Mileage': data.current_mileage ? `${data.current_mileage.toLocaleString()} km` : 'â€”',
        })
      }
    }
    fetchRelated()
  }, [log?.id])

  if (!log) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: colors.textSecondary }}>
        <Shield size={48} strokeWidth={1.2} color={colors.border} />
        <div style={{ fontSize: 14 }}>Select a log entry to view details</div>
      </div>
    )
  }

  const actionColor = getActionColor(log.action)
  const { icon, headline, detail, context } = summarize(log)
  const hasDiff = log.old_values || log.new_values
  const hasDetails = log.details && Object.keys(log.details).length > 0
  const recordType = log.record_type ?? log.entity_type ?? log.module ?? null

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

      {/* Summary card */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: '20px 22px', marginBottom: 16, borderLeft: `4px solid ${actionColor}` }}>
        <div style={{ fontSize: 26, marginBottom: 8 }}>{icon}</div>
        <p style={{ fontSize: 17, fontWeight: 700, color: colors.textPrimary, margin: '0 0 6px' }}>{headline}</p>
        <p style={{ fontSize: 13, color: colors.textSecondary, margin: '0 0 14px', lineHeight: 1.6 }}>{detail}</p>

        {/* Context chips */}
        {Object.keys(context).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {Object.entries(context).filter(([k]) => k !== 'Record ID').map(([k, v]) => (
              <span key={k} style={{ background: '#1E1E1E', border: `1px solid ${colors.border}`, borderRadius: 6, padding: '3px 10px', fontSize: 12, color: colors.textPrimary }}>
                <span style={{ color: colors.textSecondary, marginRight: 4 }}>{k}:</span>{v}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: colors.textSecondary }}>
          <Clock size={12} />
          <span>{formatTimestamp(log.created_at)}</span>
          <span style={{ color: colors.border }}>Â·</span>
          <span>{relativeTime(log.created_at)}</span>
        </div>
      </div>

      {/* Who & What */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '16px 18px', marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <InfoRow label="Performed By" value={log.user_name || log.user_id} />
        <InfoRow label="Action" value={getActionLabel(log.action)} />
        <InfoRow label="Module" value={[log.module, recordType].filter(Boolean).map(s => s!.charAt(0).toUpperCase() + s!.slice(1)).join(' / ') || 'â€”'} />
        <InfoRow label="Timestamp" value={formatTimestamp(log.created_at)} />
        {(log.record_id ?? log.entity_id) && <InfoRow label="Record ID" value={String(log.record_id ?? log.entity_id)} mono />}
        {log.branch_id && <InfoRow label="Branch ID" value={log.branch_id} mono />}
      </div>

      {/* Live related record lookup */}
      {related && Object.keys(related).length > 0 && (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '16px 18px', marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>ðŸ”— Related Record</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {Object.entries(related).map(([k, v]) => <InfoRow key={k} label={k} value={v} />)}
          </div>
        </div>
      )}

      {/* Extra details from logAudit's details field */}
      {hasDetails && (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '16px 18px', marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>ðŸ“‹ Transaction Details</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {Object.entries(log.details!).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '').map(([k, v]) => (
              <InfoRow key={k} label={k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} value={
                // format date-like values
                /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v).split('-').reverse().join('/') : String(v)
              } />
            ))}
          </div>
        </div>
      )}

      {/* Before / After diff */}
      {hasDiff && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Changes</p>
          <div style={{ display: 'flex', gap: 12 }}>
            {log.old_values && (
              <div style={{ flex: 1, background: 'rgba(239,68,68,0.07)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '12px 14px' }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: '#FCA5A5', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Before</p>
                <pre style={{ margin: 0, fontSize: 12, color: colors.textPrimary, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(log.old_values, null, 2)}</pre>
              </div>
            )}
            {log.new_values && (
              <div style={{ flex: 1, background: 'rgba(34,197,94,0.07)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '12px 14px' }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: '#86EFAC', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>After</p>
                <pre style={{ margin: 0, fontSize: 12, color: colors.textPrimary, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(log.new_values, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Technical details */}
      {(log.ip_address || log.user_agent) && (
        <details style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 14px' }}>
          <summary style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', userSelect: 'none' }}>Technical Details</summary>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {log.ip_address && <InfoRow label="IP Address" value={log.ip_address} mono />}
            {log.user_agent && <InfoRow label="User Agent" value={log.user_agent} />}
          </div>
        </details>
      )}
    </div>
  )
}

const PAGE_SIZE = 30;

export function AuditLogPage() {
  const { user } = useAuthStore();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [category, setCategory] = useState<ActionCategory>('all');
  const [loading, setLoading] = useState(false);
  const [_offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);

  const fetchLogs = useCallback(async (reset = false) => {
    if (!user) return;
    setLoading(true);

    const currentOffset = reset ? 0 : offsetRef.current;

    let query = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(currentOffset, currentOffset + PAGE_SIZE - 1);

    if (user.role !== 'super_admin' && user.branch_id) {
      query = query.eq('branch_id', user.branch_id);
    }

    if (dateRange !== 'all') {
      const now = new Date();
      let from: Date;
      if (dateRange === 'today') {
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (dateRange === 'week') {
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else {
        from = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      query = query.gte('created_at', from.toISOString());
    }

    if (category !== 'all') {
      // match both old-style "fleet.xxx" action prefix AND new-style module field
      query = query.or(`action.ilike.${category}.%,module.ilike.${category}`);
    }

    if (search.trim()) {
      const s = search.trim()
      query = query.or(`action.ilike.%${s}%,module.ilike.%${s}%,record_type.ilike.%${s}%,entity_type.ilike.%${s}%`);
    }

    const { data, error } = await query;

    if (!error && data) {
      const userIds = [...new Set(data.map(l => l.user_id))];
      let userMap: Record<string, string> = {};

      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', userIds);
        if (users) {
          userMap = Object.fromEntries(users.map(u => [u.id, u.full_name]));
        }
      }

      const enriched: AuditLog[] = data.map(l => ({
        ...l,
        user_name: userMap[l.user_id] || undefined,
      }));

      if (reset) {
        setLogs(enriched);
        offsetRef.current = enriched.length;
        setOffset(enriched.length);
      } else {
        setLogs(prev => [...prev, ...enriched]);
        offsetRef.current = offsetRef.current + enriched.length;
        setOffset(prev => prev + enriched.length);
      }

      setHasMore(data.length === PAGE_SIZE);
    }

    setLoading(false);
  }, [user, dateRange, category, search]);

  useEffect(() => {
    offsetRef.current = 0;
    setOffset(0);
    setSelected(null);
    fetchLogs(true);
  }, [dateRange, category, search, user]);

  const handleRefresh = () => {
    offsetRef.current = 0;
    setOffset(0);
    setSelected(null);
    fetchLogs(true);
  };

  const handleExport = () => {
    const csv = [
      ['ID', 'Timestamp', 'User', 'Action', 'Entity Type', 'Entity ID', 'IP Address'].join(','),
      ...logs.map(l => [
        l.id,
        l.created_at,
        l.user_name || l.user_id,
        l.action,
        l.entity_type,
        l.entity_id,
        l.ip_address || '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const categories: ActionCategory[] = ['all', 'job', 'booking', 'customer', 'vehicle', 'user', 'parts', 'fleet', 'settings'];
  const dateRanges: { value: DateRange; label: string }[] = [
    { value: 'all', label: 'All Time' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
  ];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: colors.bg,
      color: colors.textPrimary,
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        padding: '16px 24px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield size={20} color={colors.orange} />
          <span style={{ fontSize: 16, fontWeight: 700 }}>Audit Log</span>
          <span style={{ fontSize: 12, color: colors.textSecondary, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 20, padding: '2px 10px' }}>
            {logs.length} entries
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleRefresh}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: 8, padding: '7px 14px',
              color: colors.textSecondary, fontSize: 13, cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            onClick={handleExport}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: colors.orange, border: 'none',
              borderRadius: 8, padding: '7px 14px',
              color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600,
            }}
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{
          width: 380,
          flexShrink: 0,
          borderRight: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: colors.textSecondary }} />
              <input
                type="text"
                placeholder="Search action or entity..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  padding: '8px 10px 8px 32px',
                  color: colors.textPrimary,
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {dateRanges.map(r => (
                <button
                  key={r.value}
                  onClick={() => setDateRange(r.value)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 20,
                    border: `1px solid ${dateRange === r.value ? colors.orange : colors.border}`,
                    background: dateRange === r.value ? `${colors.orange}22` : colors.surface,
                    color: dateRange === r.value ? colors.orange : colors.textSecondary,
                    fontSize: 12,
                    cursor: 'pointer',
                    fontWeight: dateRange === r.value ? 600 : 400,
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {categories.map(c => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 20,
                    border: `1px solid ${category === c ? colors.orange : colors.border}`,
                    background: category === c ? `${colors.orange}22` : colors.surface,
                    color: category === c ? colors.orange : colors.textSecondary,
                    fontSize: 12,
                    cursor: 'pointer',
                    fontWeight: category === c ? 600 : 400,
                    textTransform: 'capitalize',
                  }}
                >
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading && logs.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: colors.textSecondary, fontSize: 13 }}>
                Loading...
              </div>
            ) : logs.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: colors.textSecondary, fontSize: 13 }}>
                No logs found
              </div>
            ) : (
              <>
                {logs.map(log => {
                  const isSelected = selected?.id === log.id;
                  const actionColor = getActionColor(log.action);
                  return (
                    <div
                      key={log.id}
                      onClick={() => setSelected(log)}
                      style={{
                        padding: '12px 16px',
                        borderBottom: `1px solid ${colors.border}`,
                        cursor: 'pointer',
                        background: isSelected ? `${colors.orange}11` : 'transparent',
                        borderLeft: isSelected ? `3px solid ${colors.orange}` : '3px solid transparent',
                        transition: 'background 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: actionColor, flexShrink: 0,
                          }} />
                          <span style={{
                            fontSize: 13, fontWeight: 600,
                            color: colors.textPrimary,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {getActionLabel(log.action)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <Clock size={10} color={colors.textSecondary} />
                          <span style={{ fontSize: 11, color: colors.textSecondary, whiteSpace: 'nowrap' }}>
                            {relativeTime(log.created_at)}
                          </span>
                        </div>
                      </div>
                      <div style={{ marginTop: 3, paddingLeft: 15 }}>
                        <span style={{ fontSize: 11, color: colors.textSecondary }}>
                          {(() => {
                            const d = (log.details ?? {}) as Record<string, string>
                            const mod = log.module ?? log.record_type ?? log.entity_type
                            const snippets: string[] = []
                            if (d.plate)         snippets.push(d.plate)
                            if (d.brand && d.model) snippets.push(`${d.brand} ${d.model}`)
                            if (d.service_type)  snippets.push(d.service_type)
                            if (d.leave_type)    snippets.push(d.leave_type.replace(/_/g,' '))
                            if (d.litres)        snippets.push(`${d.litres} L`)
                            if (d.document_type) snippets.push(d.document_type)
                            if (d.ot_hours)      snippets.push(`${d.ot_hours} hrs OT`)
                            if (d.customer)      snippets.push(d.customer)
                            if (snippets.length > 0) return snippets.join(' Â· ')
                            return mod ?? ''
                          })()}
                        </span>
                      </div>
                      <div style={{ marginTop: 3, paddingLeft: 15, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <User size={10} color={colors.textSecondary} />
                        <span style={{ fontSize: 11, color: colors.textSecondary }}>
                          {log.user_name || log.user_id.slice(0, 8) + 'â€¦'}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {hasMore && (
                  <div style={{ padding: '14px 16px', textAlign: 'center' }}>
                    <button
                      onClick={() => fetchLogs(false)}
                      disabled={loading}
                      style={{
                        background: colors.surface,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        padding: '8px 20px',
                        color: loading ? colors.textSecondary : colors.textPrimary,
                        fontSize: 13,
                        cursor: loading ? 'not-allowed' : 'pointer',
                        width: '100%',
                      }}
                    >
                      {loading ? 'Loading...' : 'Load More'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: colors.bg,
        }}>
          {selected && (
            <div style={{
              padding: '14px 28px',
              borderBottom: `1px solid ${colors.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 12, color: colors.textSecondary }}>Audit Log</span>
              <ChevronRight size={12} color={colors.border} />
              <span style={{ fontSize: 12, color: colors.textPrimary, fontWeight: 600 }}>
                {getActionLabel(selected.action)}
              </span>
            </div>
          )}
          <DetailPane log={selected} />
        </div>
      </div>
    </div>
  );
}
