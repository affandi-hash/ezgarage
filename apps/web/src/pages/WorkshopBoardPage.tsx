import { useState, useEffect, useCallback, useMemo } from 'react'
import { Wrench, RefreshCw, Plus, X, ChevronDown, Search, MessageCircle, Camera, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'
import { logAudit } from '@/lib/audit'
import { PhotoUploader, QuickPhotoUpload } from '@/components/ui/PhotoUploader'
import type { Job, JobStatus, ServiceType, ArrivalMode, PaymentStatus } from '@/types'

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  new:              { label: 'New',              bg: 'rgba(107,114,128,0.2)', text: '#9CA3AF', dot: '#6B7280' },
  booked:           { label: 'Booked',           bg: 'rgba(59,130,246,0.2)',  text: '#60A5FA', dot: '#3B82F6' },
  checked_in:       { label: 'Checked In',       bg: 'rgba(139,92,246,0.2)', text: '#A78BFA', dot: '#8B5CF6' },
  diagnosing:       { label: 'Diagnosing',       bg: 'rgba(245,158,11,0.2)', text: '#FCD34D', dot: '#F59E0B' },
  waiting_approval: { label: 'Waiting Approval', bg: 'rgba(239,68,68,0.2)',  text: '#FCA5A5', dot: '#EF4444' },
  waiting_parts:    { label: 'Waiting Parts',    bg: 'rgba(249,115,22,0.2)', text: '#FDBA74', dot: '#F97316' },
  in_progress:      { label: 'In Progress',      bg: 'rgba(16,185,129,0.2)', text: '#6EE7B7', dot: '#10B981' },
  ready:            { label: 'Ready',            bg: 'rgba(34,197,94,0.2)',  text: '#86EFAC', dot: '#22C55E' },
  closed:           { label: 'Closed',           bg: 'rgba(75,85,99,0.2)',   text: '#6B7280', dot: '#4B5563' },
  long_due:         { label: 'Long Due',         bg: 'rgba(220,38,38,0.2)',  text: '#FCA5A5', dot: '#DC2626' },
  cancelled:        { label: 'Cancelled',        bg: 'rgba(107,114,128,0.2)', text: '#9CA3AF', dot: '#6B7280' },
}

const BOARD_COLUMNS: JobStatus[] = [
  'checked_in', 'diagnosing', 'waiting_approval',
  'waiting_parts', 'in_progress', 'ready', 'long_due',
]

const SERVICE_TYPE_LABELS: Record<string, string> = {
  service:    'Routine Service',
  repair:     'Repair',
  inspection: 'Inspection',
  body_work:  'Body Work',
  tyre:       'Tyre',
  other:      'Other',
}

const SERVICE_TYPES: { value: ServiceType; label: string }[] = [
  { value: 'service',    label: 'Routine Service' },
  { value: 'repair',     label: 'Repair' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'body_work',  label: 'Body Work' },
  { value: 'tyre',       label: 'Tyre' },
  { value: 'other',      label: 'Other' },
]

const ARRIVAL_MODES: { value: ArrivalMode; label: string }[] = [
  { value: 'walk_in',   label: 'Walk-in' },
  { value: 'booked',    label: 'Drive-in (Booked)' },
  { value: 'fleet',     label: 'Fleet' },
  { value: 'insurance', label: 'Insurance' },
]

// ---------------------------------------------------------------------------
// Process flow
// ---------------------------------------------------------------------------
const FOREMAN_ROLES = ['foreman', 'ops_manager', 'super_admin']
const canApprove = (role: string) => FOREMAN_ROLES.includes(role)

// Strict allowlist — the ONLY valid next status for each current status
const ALLOWED_TRANSITIONS: Partial<Record<string, JobStatus[]>> = {
  checked_in:       ['diagnosing'],
  diagnosing:       ['waiting_approval'],
  waiting_approval: ['waiting_parts'],
  waiting_parts:    ['in_progress'],
  in_progress:      ['ready', 'waiting_approval'],
}

// Transitions that require Foreman sign-off via approval flow
const GATED_SET = new Set([
  'diagnosing→waiting_approval',
  'waiting_approval→waiting_parts',
  'in_progress→ready',
  'in_progress→waiting_approval',
])

function isGatedTransition(from: string, to: string): boolean {
  return GATED_SET.has(`${from}→${to}`)
}

function getChecklistQuestion(from: string, to: string): string {
  if (from === 'diagnosing')       return "Is the diagnosis confirmed and ready to present to the customer?"
  if (from === 'waiting_approval') return "Has the customer approved the repair estimate?"
  if (from === 'in_progress' && to === 'ready')            return "Is the repair completed to standard?"
  if (from === 'in_progress' && to === 'waiting_approval') return "Does this repair require customer re-approval?"
  return ''
}

// Who is allowed to initiate a status update from a given status
function canUserInitiate(status: string, role: string): boolean {
  const next = ALLOWED_TRANSITIONS[status] ?? []
  if (next.length === 0) return false
  // checked_in → diagnosing: Foreman / Ops Manager only
  if (status === 'checked_in') return ['foreman', 'ops_manager', 'super_admin'].includes(role)
  // waiting_parts → in_progress: Mechanic, Foreman, Ops Manager
  if (status === 'waiting_parts') return ['mechanic', 'foreman', 'ops_manager', 'super_admin'].includes(role)
  // All other gated transitions: Mechanic submits; Foreman/Ops also allowed (they confirm inline)
  return ['mechanic', 'foreman', 'ops_manager', 'super_admin'].includes(role)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface StatusChangeRequest {
  id: string
  job_id: string
  branch_id: string
  tenant_id: string | null
  requested_by: string | null
  requested_by_name: string | null
  from_status: string
  to_status: string
  checklist_question: string
  checklist_answer: boolean | null
  reviewer_notes: string | null
  reviewed_by: string | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  request_status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

interface JobRow extends Job {
  customers?: { full_name: string; phone: string } | null
  vehicles?: { plate_number: string; make: string; model: string; year: number | null; vehicle_type: string } | null
  assigned_foreman?: { full_name: string } | null
  assigned_mechanic?: { full_name: string } | null
  next_action?: string | null
  status_updated_at?: string | null
  plate_number?: string | null
  customer_name?: string | null
  tenant_id?: string | null
}

interface CustomerOption { id: string; full_name: string; phone: string }
interface VehicleOption  { id: string; plate_number: string; make: string; model: string }
interface StaffOption    { id: string; full_name: string; role: string }

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px',
  backgroundColor: '#0E0E0E', border: '1px solid #2A2A2A',
  borderRadius: 8, color: '#F0F0F0', fontSize: 13,
  outline: 'none', boxSizing: 'border-box',
}

const inputLabelStyle: React.CSSProperties = {
  color: '#A0A0A0', fontSize: 11, display: 'block', marginBottom: 5,
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.new
  return (
    <span style={{ backgroundColor: cfg.bg, color: cfg.text, padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600 }}>
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Checklist toggle (Yes / No)
// ---------------------------------------------------------------------------
function ChecklistToggle({ question, value, onChange }: { question: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div style={{ backgroundColor: 'rgba(241,90,34,0.06)', border: '1px solid rgba(241,90,34,0.2)', borderRadius: 10, padding: 16 }}>
      <p style={{ color: '#F0F0F0', fontSize: 13, fontWeight: 600, margin: '0 0 12px' }}>{question}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onChange(true)}
          style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `2px solid ${value === true ? '#22C55E' : '#2A2A2A'}`, backgroundColor: value === true ? 'rgba(34,197,94,0.15)' : 'transparent', color: value === true ? '#86EFAC' : '#A0A0A0', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <CheckCircle size={15} /> Yes
        </button>
        <button onClick={() => onChange(false)}
          style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `2px solid ${value === false ? '#EF4444' : '#2A2A2A'}`, backgroundColor: value === false ? 'rgba(239,68,68,0.15)' : 'transparent', color: value === false ? '#FCA5A5' : '#A0A0A0', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <XCircle size={15} /> No
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status Update Modal — enhanced with gated approval logic
// ---------------------------------------------------------------------------
interface StatusModalProps {
  job: JobRow
  userRole: string
  userName: string
  userId: string
  tenantId: string
  onClose: () => void
  onConfirmDirect: (jobId: string, newStatus: JobStatus, nextAction: string, note: string, checklistAnswer?: boolean | null, checklistQuestion?: string) => Promise<void>
  onRequestApproval: (jobId: string, toStatus: JobStatus, fromStatus: string, question: string, nextAction: string, note: string) => Promise<void>
}

function StatusUpdateModal({ job, userRole, onClose, onConfirmDirect, onRequestApproval }: StatusModalProps) {
  const allowedNext = ALLOWED_TRANSITIONS[job.status] ?? []
  const [selectedStatus, setSelectedStatus] = useState<JobStatus>(allowedNext[0] ?? job.status)
  const [nextAction, setNextAction] = useState(job.next_action ?? '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [checklistAnswer, setChecklistAnswer] = useState<boolean | null>(null)

  const gated = isGatedTransition(job.status, selectedStatus)
  const isForemanUser = canApprove(userRole)
  const question = gated ? getChecklistQuestion(job.status, selectedStatus) : ''
  const isSubmitForApproval = gated && !isForemanUser

  const handleConfirm = async () => {
    setSaving(true)
    if (isSubmitForApproval) {
      await onRequestApproval(job.id, selectedStatus, job.status, question, nextAction, notes)
    } else {
      await onConfirmDirect(job.id, selectedStatus, nextAction, notes, gated ? checklistAnswer : null, gated ? question : undefined)
    }
    setSaving(false)
    onClose()
  }

  const confirmDisabled = saving || (!isSubmitForApproval && gated && checklistAnswer === null)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, width: '100%', maxWidth: 480, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <p style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 16, margin: 0 }}>Update Job Status</p>
            <p style={{ color: '#A0A0A0', fontSize: 13, margin: '4px 0 0' }}>{job.vehicles?.plate_number ?? '—'} · {job.job_number}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
        </div>

        {/* Current → Next flow */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 14 }}>
          <StatusBadge status={job.status} />
          <span style={{ color: '#555', fontSize: 18 }}>→</span>
          {allowedNext.length === 1 ? (
            <StatusBadge status={allowedNext[0]} />
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {allowedNext.map(s => {
                const cfg = STATUS_CONFIG[s]
                const sel = selectedStatus === s
                return (
                  <button key={s} onClick={() => { setSelectedStatus(s); setChecklistAnswer(null) }}
                    style={{ padding: '4px 12px', borderRadius: 9999, border: `2px solid ${sel ? cfg.dot : '#2A2A2A'}`, backgroundColor: sel ? cfg.bg : 'transparent', color: cfg.text, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    {cfg.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Foreman sign-off checklist */}
        {gated && isForemanUser && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ color: '#A0A0A0', fontSize: 12, marginBottom: 8 }}>FOREMAN SIGN-OFF</p>
            <ChecklistToggle question={question} value={checklistAnswer} onChange={setChecklistAnswer} />
            {checklistAnswer === false && (
              <p style={{ color: '#FCA5A5', fontSize: 12, marginTop: 8 }}>Add a note below explaining what needs to be corrected.</p>
            )}
          </div>
        )}

        {/* Approval notice for mechanic */}
        {isSubmitForApproval && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
            <AlertTriangle size={13} color="#F59E0B" />
            <p style={{ color: '#FCD34D', fontSize: 12, margin: 0 }}>This transition requires <strong>Foreman approval</strong>. Your request will be queued.</p>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ color: '#A0A0A0', fontSize: 12, display: 'block', marginBottom: 6 }}>
            {isSubmitForApproval ? 'CONTEXT FOR FOREMAN' : 'NEXT ACTION'}
          </label>
          <input value={nextAction} onChange={(e) => setNextAction(e.target.value)}
            placeholder={isSubmitForApproval ? 'Describe findings for the foreman…' : 'e.g. Waiting for oil filter delivery'} style={inputStyle} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ color: '#A0A0A0', fontSize: 12, display: 'block', marginBottom: 6 }}>
            {isSubmitForApproval ? 'NOTES FOR FOREMAN' : 'ADD NOTE'}
          </label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder={isSubmitForApproval ? 'Any additional details…' : 'Internal notes appended to history…'}
            style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleConfirm} disabled={confirmDisabled}
            style={{ padding: '8px 24px', borderRadius: 8, border: 'none', backgroundColor: isSubmitForApproval ? '#F59E0B' : '#F15A22', color: isSubmitForApproval ? '#000' : '#fff', fontSize: 13, fontWeight: 700, cursor: confirmDisabled ? 'not-allowed' : 'pointer', opacity: confirmDisabled ? 0.6 : 1 }}>
            {saving ? 'Saving…' : isSubmitForApproval ? 'Submit for Approval' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Approval Modal — foreman reviews a pending request
// ---------------------------------------------------------------------------
interface ApprovalModalProps {
  request: StatusChangeRequest
  job: JobRow | undefined
  reviewerName: string
  reviewerId: string
  onClose: () => void
  onApprove: (requestId: string, jobId: string, toStatus: JobStatus, checklistAnswer: boolean, notes: string, reviewerName: string, reviewerId: string) => Promise<void>
  onReject: (requestId: string, jobId: string, notes: string, reviewerName: string, reviewerId: string) => Promise<void>
}

function ApprovalModal({ request, job, reviewerName, reviewerId, onClose, onApprove, onReject }: ApprovalModalProps) {
  const [checklistAnswer, setChecklistAnswer] = useState<boolean | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const plate = job?.vehicles?.plate_number ?? '—'
  const customer = job?.customers?.full_name ?? '—'
  const fromCfg = STATUS_CONFIG[request.from_status]
  const toCfg = STATUS_CONFIG[request.to_status]

  const handleApprove = async () => {
    if (checklistAnswer === null) { toast('Please answer the checklist question', 'error'); return }
    setSaving(true)
    await onApprove(request.id, request.job_id, request.to_status as JobStatus, checklistAnswer, notes, reviewerName, reviewerId)
    setSaving(false)
    onClose()
  }

  const handleReject = async () => {
    if (!notes.trim()) { toast('Please add a note explaining the rejection', 'error'); return }
    setSaving(true)
    await onReject(request.id, request.job_id, notes, reviewerName, reviewerId)
    setSaving(false)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, width: '100%', maxWidth: 520, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <p style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 16, margin: 0 }}>Foreman Approval Required</p>
            <p style={{ color: '#A0A0A0', fontSize: 13, margin: '4px 0 0' }}>{plate} · {customer}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {/* Status change being requested */}
        <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 10px' }}>STATUS CHANGE REQUEST</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ backgroundColor: fromCfg?.bg, color: fromCfg?.text, padding: '3px 10px', borderRadius: 9999, fontSize: 12, fontWeight: 600 }}>{fromCfg?.label}</span>
            <span style={{ color: '#A0A0A0', fontSize: 14 }}>→</span>
            <span style={{ backgroundColor: toCfg?.bg, color: toCfg?.text, padding: '3px 10px', borderRadius: 9999, fontSize: 12, fontWeight: 600 }}>{toCfg?.label}</span>
          </div>
          <p style={{ color: '#A0A0A0', fontSize: 12, margin: '10px 0 0' }}>
            Requested by <span style={{ color: '#F0F0F0', fontWeight: 600 }}>{request.requested_by_name ?? 'Unknown'}</span>
          </p>
        </div>

        {/* Mechanic's notes/context */}
        {(request.reviewer_notes || notes) && null}
        <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 8px' }}>MECHANIC'S NOTES</p>
          {job?.next_action && (
            <p style={{ color: '#F0F0F0', fontSize: 13, margin: '0 0 6px', fontStyle: 'italic' }}>
              {job.next_action}
            </p>
          )}
          {job?.internal_notes && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {job.internal_notes.split('\n').filter(Boolean).map((line, i) => (
                <p key={i} style={{ color: '#A0A0A0', fontSize: 12, margin: 0, fontStyle: 'italic' }}>{line}</p>
              ))}
            </div>
          )}
          {!job?.next_action && !job?.internal_notes && (
            <p style={{ color: '#666', fontSize: 12, margin: 0, fontStyle: 'italic' }}>No notes provided</p>
          )}
        </div>

        {/* Checklist */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: '#A0A0A0', fontSize: 12, marginBottom: 8 }}>YOUR ASSESSMENT</p>
          <ChecklistToggle question={request.checklist_question} value={checklistAnswer} onChange={setChecklistAnswer} />
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ color: '#A0A0A0', fontSize: 12, display: 'block', marginBottom: 6 }}>
            NOTES {checklistAnswer === false && <span style={{ color: '#EF4444' }}>* (required for rejection)</span>}
          </label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder={checklistAnswer === false ? 'Explain what needs to be corrected...' : 'Optional remarks...'}
            style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleReject} disabled={saving || !notes.trim()}
            style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #EF4444', backgroundColor: 'rgba(239,68,68,0.1)', color: '#FCA5A5', fontSize: 13, fontWeight: 600, cursor: saving || !notes.trim() ? 'not-allowed' : 'pointer', opacity: saving || !notes.trim() ? 0.6 : 1 }}>
            Reject
          </button>
          <button onClick={handleApprove} disabled={saving || checklistAnswer === null}
            style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 600, cursor: saving || checklistAnswer === null ? 'not-allowed' : 'pointer', opacity: saving || checklistAnswer === null ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Approve & Move'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Approval Queue Modal — foreman sees all pending requests
// ---------------------------------------------------------------------------
function ApprovalQueueModal({ requests, jobs, reviewerName, reviewerId, onClose, onApprove, onReject }: {
  requests: StatusChangeRequest[]
  jobs: JobRow[]
  reviewerName: string
  reviewerId: string
  onClose: () => void
  onApprove: ApprovalModalProps['onApprove']
  onReject: ApprovalModalProps['onReject']
}) {
  const [selected, setSelected] = useState<StatusChangeRequest | null>(requests[0] ?? null)

  if (selected) {
    const job = jobs.find(j => j.id === selected.job_id)
    return (
      <ApprovalModal
        request={selected}
        job={job}
        reviewerName={reviewerName}
        reviewerId={reviewerId}
        onClose={() => { setSelected(null); if (requests.length <= 1) onClose() }}
        onApprove={async (...args) => { await onApprove(...args); setSelected(null); if (requests.length <= 1) onClose() }}
        onReject={async (...args) => { await onReject(...args); setSelected(null); if (requests.length <= 1) onClose() }}
      />
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, width: '100%', maxWidth: 480, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 16, margin: 0 }}>Pending Approvals ({requests.length})</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {requests.map(r => {
            const job = jobs.find(j => j.id === r.job_id)
            const fromCfg = STATUS_CONFIG[r.from_status]
            const toCfg = STATUS_CONFIG[r.to_status]
            return (
              <button key={r.id} onClick={() => setSelected(r)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#F15A22')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#2A2A2A')}
              >
                <div>
                  <p style={{ color: '#F15A22', fontSize: 14, fontWeight: 800, fontFamily: 'monospace', margin: '0 0 4px' }}>{job?.vehicles?.plate_number ?? r.job_id.slice(0, 8)}</p>
                  <p style={{ color: '#A0A0A0', fontSize: 12, margin: '0 0 6px' }}>{job?.customers?.full_name ?? ''} · by {r.requested_by_name}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ backgroundColor: fromCfg?.bg, color: fromCfg?.text, padding: '2px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 600 }}>{fromCfg?.label}</span>
                    <span style={{ color: '#A0A0A0', fontSize: 11 }}>→</span>
                    <span style={{ backgroundColor: toCfg?.bg, color: toCfg?.text, padding: '2px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 600 }}>{toCfg?.label}</span>
                  </div>
                </div>
                <ChevronDown size={14} color="#A0A0A0" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }} />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add Note Modal
// ---------------------------------------------------------------------------
function AddNoteModal({ job, onClose, onSave }: { job: JobRow; onClose: () => void; onSave: (id: string, note: string) => Promise<void> }) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, width: '100%', maxWidth: 440, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 15, margin: 0 }}>Add Internal Note</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <p style={{ color: '#A0A0A0', fontSize: 12, margin: '0 0 12px' }}>{job.vehicles?.plate_number ?? ''} · {job.job_number}</p>
        <textarea autoFocus rows={4} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Enter note..." style={{ ...inputStyle, resize: 'vertical', marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={async () => { setSaving(true); await onSave(job.id, note); setSaving(false); onClose() }}
            disabled={saving || !note.trim()}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving || !note.trim() ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Note'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Job Detail Drawer
// ---------------------------------------------------------------------------
function JobDetailDrawer({ job, approvalHistory, onClose, onRefresh }: {
  job: JobRow
  approvalHistory: StatusChangeRequest[]
  onClose: () => void
  onRefresh: () => void
}) {
  const { user } = useAuthStore()
  const plate    = job.vehicles?.plate_number ?? '—'
  const make     = job.vehicles?.make ?? ''
  const model    = job.vehicles?.model ?? ''
  const year     = job.vehicles?.year ?? null
  const vType    = (job.vehicles?.vehicle_type ?? 'car').toUpperCase()
  const customer = job.customers?.full_name ?? '—'
  const phone    = job.customers?.phone ?? ''
  const foreman  = job.assigned_foreman?.full_name ?? '—'
  const mechanic = job.assigned_mechanic?.full_name ?? '—'
  const notes    = job.internal_notes ?? ''
  const daysIn   = job.checked_in_at
    ? Math.floor((Date.now() - new Date(job.checked_in_at).getTime()) / 86400000)
    : 0

  // Edit mode state
  const [editMode, setEditMode] = useState(false)
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [editData, setEditData] = useState({
    service_type: job.service_type as string,
    assigned_foreman_id: job.assigned_foreman_id ?? '',
    assigned_mechanic_id: job.assigned_mechanic_id ?? '',
    estimated_cost: job.estimated_cost != null ? String(job.estimated_cost) : '',
    payment_status: job.payment_status ?? 'unpaid',
    customer_complaint: job.customer_complaint ?? '',
    diagnosis_summary: job.diagnosis_summary ?? '',
    next_action: job.next_action ?? '',
  })

  useEffect(() => {
    async function loadStaff() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/users/staff-options`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        })
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data)) { setStaffOptions(data as StaffOption[]); return }
        }
      } catch (_) {}
      // Fallback: direct Supabase query (works if RLS allows it)
      const { data } = await supabase.from('users').select('id, full_name, role')
        .in('role', ['foreman', 'mechanic', 'ops_manager'])
      setStaffOptions((data ?? []) as StaffOption[])
    }
    loadStaff()
  }, [])

  const foremanOpts = staffOptions.filter(s => s.role === 'foreman')
  const mechanicOpts = staffOptions.filter(s => s.role === 'mechanic')

  function startEdit() {
    setEditData({
      service_type: job.service_type as string,
      assigned_foreman_id: job.assigned_foreman_id ?? '',
      assigned_mechanic_id: job.assigned_mechanic_id ?? '',
      estimated_cost: job.estimated_cost != null ? String(job.estimated_cost) : '',
      payment_status: job.payment_status ?? 'unpaid',
      customer_complaint: job.customer_complaint ?? '',
      diagnosis_summary: job.diagnosis_summary ?? '',
      next_action: job.next_action ?? '',
    })
    setSaveError(null)
    setEditMode(true)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    const cost = editData.estimated_cost.trim() === '' ? null : parseFloat(editData.estimated_cost)
    const { error } = await supabase.from('jobs').update({
      service_type: editData.service_type,
      assigned_foreman_id: editData.assigned_foreman_id || null,
      assigned_mechanic_id: editData.assigned_mechanic_id || null,
      estimated_cost: isNaN(cost as number) ? null : cost,
      payment_status: editData.payment_status,
      customer_complaint: editData.customer_complaint.trim() || null,
      diagnosis_summary: editData.diagnosis_summary.trim() || null,
      next_action: editData.next_action.trim() || null,
    }).eq('id', job.id)
    setSaving(false)
    if (error) { setSaveError(error.message); return }
    setEditMode(false)
    onRefresh()
  }

  async function handleCancelJob() {
    if (!cancelReason.trim()) return
    setCancelling(true)
    const existingNotes = job.internal_notes ? job.internal_notes + '\n' : ''
    const cancelNote = `[CANCELLED by ${user?.full_name ?? user?.role ?? 'staff'}] ${cancelReason.trim()}`
    const { error } = await supabase.from('jobs').update({
      status: 'cancelled',
      internal_notes: existingNotes + cancelNote,
    }).eq('id', job.id)
    setCancelling(false)
    if (error) { toast('Failed to cancel job: ' + error.message); return }
    toast('Job cancelled')
    onClose()
    onRefresh()
  }

  function openWhatsApp() {
    const raw = phone.replace(/\D/g, '')
    const waNum = raw.startsWith('0') ? '6' + raw : raw
    const statusLabel = STATUS_CONFIG[job.status]?.label ?? job.status
    const msg = encodeURIComponent(
      `Hi ${customer}, your vehicle *${plate}* is currently at status: *${statusLabel}*.\n` +
      (job.next_action ? `Next step: ${job.next_action}\n` : '') +
      `\nJob No: ${job.job_number}\nThank you from our workshop team.`
    )
    window.open(`https://wa.me/${waNum}?text=${msg}`, '_blank')
  }

  const noteLines = notes ? notes.split('\n').filter(Boolean) : []

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40, backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 560, backgroundColor: '#161616', borderLeft: '1px solid #2A2A2A', zIndex: 50, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, position: 'sticky', top: 0, backgroundColor: '#161616', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Wrench size={18} color="#F15A22" />
            <div>
              <p style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 16, margin: 0 }}>Job Detail</p>
              <p style={{ color: '#A0A0A0', fontSize: 12, margin: '2px 0 0', fontFamily: 'monospace' }}>{job.job_number}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '20px 24px', flex: 1 }}>
          {/* Status row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <StatusBadge status={job.status} />
            {daysIn > 0 && (
              <span style={{ backgroundColor: daysIn > 3 ? 'rgba(220,38,38,0.2)' : 'rgba(107,114,128,0.2)', color: daysIn > 3 ? '#FCA5A5' : '#9CA3AF', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600 }}>
                {daysIn}d in garage
              </span>
            )}
            <span style={{ backgroundColor: vType === 'BIKE' ? 'rgba(139,92,246,0.2)' : 'rgba(59,130,246,0.2)', color: vType === 'BIKE' ? '#A78BFA' : '#60A5FA', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>{vType}</span>
          </div>

          {/* Vehicle + Customer */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16 }}>
              <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 10px' }}>VEHICLE</p>
              <p style={{ color: '#F15A22', fontSize: 20, fontWeight: 800, fontFamily: 'monospace', margin: '0 0 4px', letterSpacing: '0.05em' }}>{plate}</p>
              <p style={{ color: '#F0F0F0', fontSize: 13, margin: '0 0 2px' }}>{[make, model, year].filter(Boolean).join(' ')}</p>
              <p style={{ color: '#A0A0A0', fontSize: 12, margin: 0 }}>{SERVICE_TYPE_LABELS[job.service_type] ?? job.service_type}</p>
            </div>
            <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16 }}>
              <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 10px' }}>CUSTOMER</p>
              <p style={{ color: '#F0F0F0', fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>{customer}</p>
              {phone && <p style={{ color: '#A0A0A0', fontSize: 12, margin: '0 0 2px' }}>{phone}</p>}
            </div>
          </div>

          {/* Staff */}
          <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 10px' }}>ASSIGNED STAFF</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <p style={{ color: '#A0A0A0', fontSize: 11, margin: '0 0 4px' }}>Foreman</p>
                {editMode ? (
                  <select value={editData.assigned_foreman_id} onChange={e => setEditData(d => ({ ...d, assigned_foreman_id: e.target.value }))} style={{ ...inputStyle, padding: '6px 10px' }}>
                    <option value="">— None —</option>
                    {foremanOpts.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </select>
                ) : (
                  <p style={{ color: '#F0F0F0', fontSize: 13, fontWeight: 600, margin: 0 }}>{foreman}</p>
                )}
              </div>
              <div>
                <p style={{ color: '#A0A0A0', fontSize: 11, margin: '0 0 4px' }}>Mechanic</p>
                {editMode ? (
                  <select value={editData.assigned_mechanic_id} onChange={e => setEditData(d => ({ ...d, assigned_mechanic_id: e.target.value }))} style={{ ...inputStyle, padding: '6px 10px' }}>
                    <option value="">— None —</option>
                    {mechanicOpts.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </select>
                ) : (
                  <p style={{ color: '#F0F0F0', fontSize: 13, fontWeight: 600, margin: 0 }}>{mechanic}</p>
                )}
              </div>
            </div>
          </div>

          {/* Financials */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 14 }}>
              <p style={{ color: '#A0A0A0', fontSize: 11, margin: '0 0 4px' }}>EST. COST (RM)</p>
              {editMode ? (
                <input type="number" min="0" step="0.01" value={editData.estimated_cost} onChange={e => setEditData(d => ({ ...d, estimated_cost: e.target.value }))} placeholder="0.00" style={{ ...inputStyle, padding: '6px 10px' }} />
              ) : (
                <p style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 700, margin: 0 }}>{job.estimated_cost != null ? `RM ${Number(job.estimated_cost).toFixed(2)}` : '—'}</p>
              )}
            </div>
            <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 14 }}>
              <p style={{ color: '#A0A0A0', fontSize: 11, margin: '0 0 4px' }}>PAYMENT</p>
              {editMode ? (
                <select value={editData.payment_status} onChange={e => setEditData(d => ({ ...d, payment_status: e.target.value as PaymentStatus }))} style={{ ...inputStyle, padding: '6px 10px' }}>
                  <option value="unpaid">Unpaid</option>
                  <option value="partial">Partial</option>
                  <option value="paid">Paid</option>
                </select>
              ) : (
                <p style={{ color: job.payment_status === 'paid' ? '#4ADE80' : job.payment_status === 'partial' ? '#FBBF24' : '#FCA5A5', fontSize: 13, fontWeight: 700, margin: 0, textTransform: 'capitalize' }}>{job.payment_status ?? 'Unpaid'}</p>
              )}
            </div>
          </div>

          {/* Service type — editable */}
          {editMode && (
            <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 8px' }}>SERVICE TYPE</p>
              <select value={editData.service_type} onChange={e => setEditData(d => ({ ...d, service_type: e.target.value }))} style={{ ...inputStyle, padding: '6px 10px' }}>
                {SERVICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          )}

          {/* Complaint */}
          {(editMode || job.customer_complaint) && (
            <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 8px' }}>CUSTOMER COMPLAINT</p>
              {editMode ? (
                <textarea rows={3} value={editData.customer_complaint} onChange={e => setEditData(d => ({ ...d, customer_complaint: e.target.value }))} placeholder="Describe customer complaint…" style={{ ...inputStyle, resize: 'vertical' }} />
              ) : (
                <p style={{ color: '#F0F0F0', fontSize: 13, margin: 0, lineHeight: 1.6 }}>{job.customer_complaint}</p>
              )}
            </div>
          )}

          {/* Diagnosis */}
          {(editMode || job.diagnosis_summary) && (
            <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 8px' }}>DIAGNOSIS</p>
              {editMode ? (
                <textarea rows={3} value={editData.diagnosis_summary} onChange={e => setEditData(d => ({ ...d, diagnosis_summary: e.target.value }))} placeholder="Diagnosis findings…" style={{ ...inputStyle, resize: 'vertical' }} />
              ) : (
                <p style={{ color: '#F0F0F0', fontSize: 13, margin: 0, lineHeight: 1.6 }}>{job.diagnosis_summary}</p>
              )}
            </div>
          )}

          {/* Next action */}
          {(editMode || job.next_action) && (
            <div style={{ backgroundColor: 'rgba(241,90,34,0.06)', border: '1px solid rgba(241,90,34,0.2)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 4px' }}>NEXT ACTION</p>
              {editMode ? (
                <input type="text" value={editData.next_action} onChange={e => setEditData(d => ({ ...d, next_action: e.target.value }))} placeholder="e.g. waiting for parts delivery" style={{ ...inputStyle, padding: '6px 10px' }} />
              ) : (
                <p style={{ color: '#F15A22', fontSize: 13, margin: 0 }}>{job.next_action}</p>
              )}
            </div>
          )}

          {/* Approval History */}
          {approvalHistory.length > 0 && (
            <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle size={12} /> APPROVAL HISTORY
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {approvalHistory.map(r => (
                  <div key={r.id} style={{ backgroundColor: '#0E0E0E', borderRadius: 8, padding: '10px 12px', borderLeft: `3px solid ${r.request_status === 'approved' ? '#22C55E' : r.request_status === 'rejected' ? '#EF4444' : '#F59E0B'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {r.request_status === 'approved' && <CheckCircle size={12} color="#22C55E" />}
                        {r.request_status === 'rejected' && <XCircle size={12} color="#EF4444" />}
                        {r.request_status === 'pending' && <Clock size={12} color="#F59E0B" />}
                        <span style={{ color: '#F0F0F0', fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>{r.request_status}</span>
                      </div>
                      <span style={{ color: '#555', fontSize: 10 }}>{r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : new Date(r.created_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ backgroundColor: STATUS_CONFIG[r.from_status]?.bg, color: STATUS_CONFIG[r.from_status]?.text, padding: '1px 6px', borderRadius: 9999, fontSize: 10, fontWeight: 600 }}>{STATUS_CONFIG[r.from_status]?.label}</span>
                      <span style={{ color: '#555', fontSize: 10 }}>→</span>
                      <span style={{ backgroundColor: STATUS_CONFIG[r.to_status]?.bg, color: STATUS_CONFIG[r.to_status]?.text, padding: '1px 6px', borderRadius: 9999, fontSize: 10, fontWeight: 600 }}>{STATUS_CONFIG[r.to_status]?.label}</span>
                    </div>
                    {r.request_status !== 'pending' && (
                      <p style={{ color: '#A0A0A0', fontSize: 11, margin: '4px 0 0' }}>
                        {r.checklist_question}: <span style={{ color: r.checklist_answer ? '#86EFAC' : '#FCA5A5', fontWeight: 600 }}>{r.checklist_answer === true ? 'Yes' : r.checklist_answer === false ? 'No' : '—'}</span>
                        {r.reviewed_by_name && <span> · by {r.reviewed_by_name}</span>}
                      </p>
                    )}
                    {r.reviewer_notes && <p style={{ color: '#A0A0A0', fontSize: 11, margin: '4px 0 0', fontStyle: 'italic' }}>"{r.reviewer_notes}"</p>}
                    {r.request_status === 'pending' && <p style={{ color: '#A0A0A0', fontSize: 11, margin: '4px 0 0' }}>Requested by {r.requested_by_name}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Internal notes */}
          <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 12px' }}>INTERNAL NOTES</p>
            {noteLines.length === 0 ? (
              <p style={{ color: '#666', fontSize: 12, margin: 0, fontStyle: 'italic' }}>No notes yet</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {noteLines.map((line, i) => (
                  <div key={i} style={{ backgroundColor: '#0E0E0E', borderRadius: 6, padding: '8px 12px', borderLeft: '2px solid #2A2A2A' }}>
                    <p style={{ color: '#A0A0A0', fontSize: 12, margin: 0 }}>{line}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Photos */}
          <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16 }}>
            <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Camera size={13} /> JOB PHOTOS
            </p>
            <PhotoUploader jobId={job.id} branchId={job.branch_id ?? ''} tenantId={user?.tenant_id ?? ''} uploadedBy={user?.id ?? ''} currentStatus={job.status} />
          </div>
        </div>

        {/* Sticky footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #2A2A2A', flexShrink: 0, backgroundColor: '#161616', position: 'sticky', bottom: 0 }}>
          {saveError && <p style={{ color: '#FCA5A5', fontSize: 12, margin: '0 0 10px', textAlign: 'center' }}>{saveError}</p>}

          {/* Cancel confirm panel */}
          {showCancelConfirm && (
            <div style={{ marginBottom: 12, padding: '12px 14px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8 }}>
              <p style={{ color: '#FCA5A5', fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>Cancel this job?</p>
              <textarea
                rows={2}
                placeholder="Reason for cancellation (required)"
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                style={{ width: '100%', background: '#1E1E1E', border: '1px solid #3A3A3A', borderRadius: 6, color: '#F0F0F0', fontSize: 13, padding: '7px 10px', resize: 'none', boxSizing: 'border-box', outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => { setShowCancelConfirm(false); setCancelReason('') }} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: '1px solid #2A2A2A', background: 'transparent', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>Back</button>
                <button onClick={handleCancelJob} disabled={!cancelReason.trim() || cancelling} style={{ flex: 2, padding: '8px 0', borderRadius: 6, border: 'none', background: '#DC2626', color: '#fff', fontSize: 13, fontWeight: 700, cursor: (!cancelReason.trim() || cancelling) ? 'not-allowed' : 'pointer', opacity: (!cancelReason.trim() || cancelling) ? 0.6 : 1 }}>
                  {cancelling ? 'Cancelling…' : 'Confirm Cancel'}
                </button>
              </div>
            </div>
          )}

          {editMode ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setEditMode(false); setSaveError(null) }} disabled={saving} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ flex: 2, padding: '9px 0', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {phone && (
                <button onClick={openWhatsApp} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: '1px solid #25D366', backgroundColor: 'rgba(37,211,102,0.1)', color: '#25D366', fontSize: 13, cursor: 'pointer' }}>
                  <MessageCircle size={14} /> WhatsApp
                </button>
              )}
              {canApprove(user?.role ?? '') && (
                <button onClick={startEdit} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: '1px solid #F15A22', backgroundColor: 'rgba(241,90,34,0.1)', color: '#F15A22', fontSize: 13, cursor: 'pointer' }}>
                  <Wrench size={14} /> Edit
                </button>
              )}
              {['ops_manager', 'foreman', 'super_admin'].includes(user?.role ?? '') &&
               ['new', 'booked', 'checked_in'].includes(job.status) && (
                <button onClick={() => { setShowCancelConfirm(v => !v); setCancelReason('') }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: '1px solid #DC2626', backgroundColor: showCancelConfirm ? 'rgba(220,38,38,0.15)' : 'transparent', color: '#FCA5A5', fontSize: 13, cursor: 'pointer' }}>
                  <X size={14} /> Cancel Job
                </button>
              )}
              <button onClick={onClose} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>Close</button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// New Job Modal
// ---------------------------------------------------------------------------
interface NewJobModalProps {
  branchId: string
  onClose: () => void
  onCreated: () => void
}

function NewJobModal({ branchId, onClose, onCreated }: NewJobModalProps) {
  const { user } = useAuthStore()
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null)
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCust, setNewCust] = useState({ full_name: '', phone: '', email: '', ic_number: '', full_address: '' })
  const [savingCust, setSavingCust] = useState(false)
  const [custError, setCustError] = useState('')
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [vehicleResults, setVehicleResults] = useState<VehicleOption[]>([])
  const [customerVehicles, setCustomerVehicles] = useState<VehicleOption[]>([])
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleOption | null>(null)
  const [showNewVehicle, setShowNewVehicle] = useState(false)
  const [newVehicle, setNewVehicle] = useState({ plate_number: '', make: '', model: '', year: '', color: '', current_mileage: '', vehicle_type: 'car' })
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [vehicleError, setVehicleError] = useState('')
  const [serviceType, setServiceType] = useState<ServiceType>('service')
  const [arrivalMode, setArrivalMode] = useState<ArrivalMode>('walk_in')
  const [complaint, setComplaint] = useState('')
  const [estimatedCost, setEstimatedCost] = useState('')
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  const [foremanId, setForemanId] = useState('')
  const [mechanicId, setMechanicId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('users').select('id, full_name, role').in('role', ['foreman', 'mechanic', 'ops_manager']).eq('branch_id', branchId).eq('is_active', true)
      .then(({ data }) => setStaffOptions((data ?? []) as StaffOption[]))
  }, [branchId])

  useEffect(() => {
    if (customerSearch.length < 2) { setCustomerResults([]); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase.from('customers').select('id, full_name, phone').or(`full_name.ilike.%${customerSearch}%,phone.ilike.%${customerSearch}%`).eq('branch_id', branchId).limit(5)
      setCustomerResults((data ?? []) as CustomerOption[])
    }, 300)
    return () => clearTimeout(timer)
  }, [customerSearch, branchId])

  useEffect(() => {
    if (!selectedCustomer) { setCustomerVehicles([]); setSelectedVehicle(null); return }
    supabase.from('vehicles').select('id, plate_number, make, model').eq('customer_id', selectedCustomer.id).order('plate_number')
      .then(({ data }) => setCustomerVehicles((data ?? []) as VehicleOption[]))
  }, [selectedCustomer])

  useEffect(() => {
    if (selectedCustomer) { setVehicleResults([]); return }
    if (vehicleSearch.length < 2) { setVehicleResults([]); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase.from('vehicles').select('id, plate_number, make, model').ilike('plate_number', `%${vehicleSearch}%`).limit(5)
      setVehicleResults((data ?? []) as VehicleOption[])
    }, 300)
    return () => clearTimeout(timer)
  }, [vehicleSearch, selectedCustomer])

  const handleCreateCustomer = async () => {
    if (!newCust.full_name.trim() || !newCust.phone.trim()) { setCustError('Name and phone are required.'); return }
    setSavingCust(true); setCustError('')
    const { data, error } = await supabase.from('customers').insert({
      full_name: newCust.full_name.trim(), phone: newCust.phone.trim(),
      email: newCust.email.trim() || null, ic_number: newCust.ic_number.trim() || null,
      full_address: newCust.full_address.trim() || null,
      customer_type: 'individual', customer_status: 'active',
      branch_id: branchId, tenant_id: user?.tenant_id,
    }).select('id, full_name, phone').single()
    setSavingCust(false)
    if (error) { setCustError(error.message); return }
    setSelectedCustomer(data as CustomerOption)
    setNewCust({ full_name: '', phone: '', email: '', ic_number: '', full_address: '' })
    setShowNewCustomer(false); setCustomerSearch('')
  }

  const handleCreateVehicle = async () => {
    if (!newVehicle.plate_number.trim()) { setVehicleError('Plate number is required.'); return }
    if (!selectedCustomer) { setVehicleError('Select a customer first.'); return }
    setSavingVehicle(true); setVehicleError('')
    const { data, error } = await supabase.from('vehicles').insert({
      plate_number: newVehicle.plate_number.trim().toUpperCase(),
      make: newVehicle.make.trim() || null, model: newVehicle.model.trim() || null,
      vehicle_type: newVehicle.vehicle_type,
      year: newVehicle.year ? parseInt(newVehicle.year) : null,
      color: newVehicle.color.trim() || null,
      current_mileage: newVehicle.current_mileage ? parseInt(newVehicle.current_mileage) : null,
      customer_id: selectedCustomer.id, branch_id: branchId, tenant_id: user?.tenant_id,
    }).select('id, plate_number, make, model').single()
    setSavingVehicle(false)
    if (error) { setVehicleError(error.message); return }
    const created = data as VehicleOption
    setCustomerVehicles(prev => [...prev, created])
    setSelectedVehicle(created)
    setNewVehicle({ plate_number: '', make: '', model: '', year: '', color: '', current_mileage: '', vehicle_type: 'car' })
    setShowNewVehicle(false)
  }

  const handleSubmit = async () => {
    if (!selectedCustomer) { setFormError('Please select a customer.'); return }
    if (!selectedVehicle)  { setFormError('Please select a vehicle.'); return }
    setSaving(true); setFormError(null)
    try {
      const { error: err } = await supabase.from('jobs').insert({
        branch_id: branchId, tenant_id: user?.tenant_id ?? null,
        customer_id: selectedCustomer.id, vehicle_id: selectedVehicle.id,
        service_type: serviceType, arrival_mode: arrivalMode,
        status: 'checked_in', vehicle_type: 'car', source: 'walk_in',
        customer_complaint: complaint || null,
        estimated_cost: estimatedCost ? parseFloat(estimatedCost) : null,
        assigned_foreman_id: foremanId || null, assigned_mechanic_id: mechanicId || null,
        checked_in_at: new Date().toISOString(), payment_status: 'unpaid',
      })
      if (err) throw err
      logAudit({ action: 'create', module: 'jobs', record_type: 'job', details: { customer: selectedCustomer.full_name, plate: selectedVehicle.plate_number, service: serviceType }, branch_id: branchId, user_id: user?.id, tenant_id: user?.tenant_id })
      toast('Job card created successfully')
      onCreated(); onClose()
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to create job')
    } finally {
      setSaving(false)
    }
  }

  const foremanOptions = staffOptions.filter(s => s.role === 'foreman')
  const mechanicOptions = staffOptions.filter(s => s.role === 'mechanic' || s.role === 'foreman')

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, width: '100%', maxWidth: 600, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={18} color="#F15A22" />
            <span style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 16 }}>New Job Card</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {/* Customer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={{ color: '#F15A22', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', margin: 0 }}>CUSTOMER</p>
            {!selectedCustomer && (
              <button type="button" onClick={() => { setShowNewCustomer(v => !v); setCustError('') }}
                style={{ fontSize: 12, color: '#F15A22', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                {showNewCustomer ? '✕ Cancel' : '+ New Customer'}
              </button>
            )}
          </div>
          {selectedCustomer ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
              <div>
                <p style={{ color: '#F0F0F0', fontSize: 13, fontWeight: 600, margin: 0 }}>{selectedCustomer.full_name}</p>
                <p style={{ color: '#A0A0A0', fontSize: 12, margin: '2px 0 0' }}>{selectedCustomer.phone}</p>
              </div>
              <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); setCustomerVehicles([]); setSelectedVehicle(null) }} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer' }}><X size={14} /></button>
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {showNewCustomer ? (
                <div style={{ background: '#1A1A1A', border: '1px solid #F15A22', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div><label style={inputLabelStyle}>Full Name *</label><input type="text" value={newCust.full_name} onChange={e => setNewCust(p => ({ ...p, full_name: e.target.value }))} placeholder="e.g. Ahmad Razif" style={inputStyle} /></div>
                    <div><label style={inputLabelStyle}>Phone *</label><input type="text" value={newCust.phone} onChange={e => setNewCust(p => ({ ...p, phone: e.target.value }))} placeholder="e.g. 0123456789" style={inputStyle} /></div>
                    <div><label style={inputLabelStyle}>IC Number</label><input type="text" value={newCust.ic_number} onChange={e => setNewCust(p => ({ ...p, ic_number: e.target.value }))} placeholder="e.g. 900101-14-1234" style={inputStyle} /></div>
                    <div><label style={inputLabelStyle}>Email</label><input type="email" value={newCust.email} onChange={e => setNewCust(p => ({ ...p, email: e.target.value }))} placeholder="e.g. ahmad@email.com" style={inputStyle} /></div>
                  </div>
                  <div><label style={inputLabelStyle}>Address</label><textarea value={newCust.full_address} onChange={e => setNewCust(p => ({ ...p, full_address: e.target.value }))} placeholder="e.g. No. 5, Jalan Ampang, 50450 KL" style={{ ...inputStyle, resize: 'vertical', minHeight: 56 }} /></div>
                  {custError && <p style={{ color: '#F87171', fontSize: 12, margin: 0 }}>{custError}</p>}
                  <button type="button" onClick={handleCreateCustomer} disabled={savingCust} style={{ padding: '0 20px', minHeight: 44, borderRadius: 8, fontSize: 13, fontWeight: 600, background: '#F15A22', color: '#fff', border: 'none', cursor: 'pointer', opacity: savingCust ? 0.7 : 1 }}>{savingCust ? 'Creating...' : 'Create & Select'}</button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <Search size={13} color="#A0A0A0" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search by name or phone..." style={{ ...inputStyle, paddingLeft: 30 }} />
                  {customerResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, zIndex: 10, overflow: 'hidden', marginTop: 2 }}>
                      {customerResults.map((c) => (
                        <button key={c.id} onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); setCustomerResults([]) }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid #2A2A2A' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2A2A2A' }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}>
                          <p style={{ color: '#F0F0F0', fontSize: 13, fontWeight: 600, margin: 0 }}>{c.full_name}</p>
                          <p style={{ color: '#A0A0A0', fontSize: 11, margin: 0 }}>{c.phone}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Vehicle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={{ color: '#F15A22', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', margin: 0 }}>VEHICLE</p>
            {selectedCustomer && !selectedVehicle && (
              <button type="button" onClick={() => { setShowNewVehicle(v => !v); setVehicleError('') }}
                style={{ fontSize: 12, color: '#F15A22', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                {showNewVehicle ? '✕ Cancel' : '+ New Vehicle'}
              </button>
            )}
          </div>
          {selectedVehicle ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
              <div>
                <p style={{ color: '#F15A22', fontSize: 16, fontWeight: 800, fontFamily: 'monospace', margin: 0 }}>{selectedVehicle.plate_number}</p>
                <p style={{ color: '#A0A0A0', fontSize: 12, margin: '2px 0 0' }}>{selectedVehicle.make} {selectedVehicle.model}</p>
              </div>
              <button onClick={() => setSelectedVehicle(null)} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer' }}><X size={14} /></button>
            </div>
          ) : selectedCustomer ? (
            <div style={{ marginBottom: 16 }}>
              {showNewVehicle ? (
                <div style={{ background: '#1A1A1A', border: '1px solid #F15A22', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div><label style={inputLabelStyle}>Plate Number *</label><input type="text" value={newVehicle.plate_number} onChange={e => setNewVehicle(p => ({ ...p, plate_number: e.target.value.toUpperCase() }))} placeholder="e.g. WXY1234" style={inputStyle} /></div>
                    <div><label style={inputLabelStyle}>Type</label><select value={newVehicle.vehicle_type} onChange={e => setNewVehicle(p => ({ ...p, vehicle_type: e.target.value }))} style={inputStyle}><option value="car">Car</option><option value="bike">Bike</option></select></div>
                    <div><label style={inputLabelStyle}>Make</label><input type="text" value={newVehicle.make} onChange={e => setNewVehicle(p => ({ ...p, make: e.target.value }))} placeholder="e.g. Toyota" style={inputStyle} /></div>
                    <div><label style={inputLabelStyle}>Model</label><input type="text" value={newVehicle.model} onChange={e => setNewVehicle(p => ({ ...p, model: e.target.value }))} placeholder="e.g. Vios" style={inputStyle} /></div>
                    <div><label style={inputLabelStyle}>Year</label><input type="number" value={newVehicle.year} onChange={e => setNewVehicle(p => ({ ...p, year: e.target.value }))} placeholder="e.g. 2020" min={1900} max={2100} style={inputStyle} /></div>
                    <div><label style={inputLabelStyle}>Color</label><input type="text" value={newVehicle.color} onChange={e => setNewVehicle(p => ({ ...p, color: e.target.value }))} placeholder="e.g. White" style={inputStyle} /></div>
                    <div style={{ gridColumn: '1 / -1' }}><label style={inputLabelStyle}>Current Mileage (km)</label><input type="number" value={newVehicle.current_mileage} onChange={e => setNewVehicle(p => ({ ...p, current_mileage: e.target.value }))} placeholder="e.g. 45000" min={0} style={inputStyle} /></div>
                  </div>
                  {vehicleError && <p style={{ color: '#F87171', fontSize: 12, margin: 0 }}>{vehicleError}</p>}
                  <button type="button" onClick={handleCreateVehicle} disabled={savingVehicle} style={{ padding: '0 20px', minHeight: 44, borderRadius: 8, fontSize: 13, fontWeight: 600, background: '#F15A22', color: '#fff', border: 'none', cursor: 'pointer', opacity: savingVehicle ? 0.7 : 1 }}>{savingVehicle ? 'Adding...' : 'Add & Select'}</button>
                </div>
              ) : customerVehicles.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {customerVehicles.map(v => (
                    <button key={v.id} onClick={() => setSelectedVehicle(v)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = '#F15A22')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = '#2A2A2A')}>
                      <div>
                        <p style={{ color: '#F15A22', fontSize: 14, fontWeight: 800, fontFamily: 'monospace', margin: 0 }}>{v.plate_number}</p>
                        <p style={{ color: '#A0A0A0', fontSize: 11, margin: '2px 0 0' }}>{v.make} {v.model}</p>
                      </div>
                      <ChevronDown size={14} color="#A0A0A0" style={{ transform: 'rotate(-90deg)' }} />
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '14px', backgroundColor: '#1A1A1A', border: '1px dashed #2A2A2A', borderRadius: 8, textAlign: 'center' }}>
                  <p style={{ color: '#A0A0A0', fontSize: 13, margin: '0 0 10px' }}>No vehicles found for this customer.</p>
                  <button type="button" onClick={() => setShowNewVehicle(true)} style={{ padding: '0 20px', minHeight: 40, borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'transparent', color: '#F15A22', border: '1px solid #F15A22', cursor: 'pointer' }}>+ Add New Vehicle</button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <Search size={13} color="#A0A0A0" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} placeholder="Select a customer first, or search plate..." style={{ ...inputStyle, paddingLeft: 30 }} />
              {vehicleResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, zIndex: 10, overflow: 'hidden', marginTop: 2 }}>
                  {vehicleResults.map((v) => (
                    <button key={v.id} onClick={() => { setSelectedVehicle(v); setVehicleSearch(''); setVehicleResults([]) }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid #2A2A2A' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2A2A2A' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}>
                      <p style={{ color: '#F15A22', fontSize: 14, fontWeight: 800, fontFamily: 'monospace', margin: 0 }}>{v.plate_number}</p>
                      <p style={{ color: '#A0A0A0', fontSize: 11, margin: 0 }}>{v.make} {v.model}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Service */}
          <p style={{ color: '#F15A22', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', margin: '0 0 10px' }}>SERVICE</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ color: '#A0A0A0', fontSize: 11, display: 'block', marginBottom: 5 }}>SERVICE TYPE</label>
              <div style={{ position: 'relative' }}>
                <select value={serviceType} onChange={(e) => setServiceType(e.target.value as ServiceType)} style={{ ...inputStyle, appearance: 'none', paddingRight: 28 }}>
                  {SERVICE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <ChevronDown size={12} color="#A0A0A0" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              </div>
            </div>
            <div>
              <label style={{ color: '#A0A0A0', fontSize: 11, display: 'block', marginBottom: 5 }}>ARRIVAL MODE</label>
              <div style={{ position: 'relative' }}>
                <select value={arrivalMode} onChange={(e) => setArrivalMode(e.target.value as ArrivalMode)} style={{ ...inputStyle, appearance: 'none', paddingRight: 28 }}>
                  {ARRIVAL_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <ChevronDown size={12} color="#A0A0A0" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              </div>
            </div>
          </div>

          {/* Staff */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ color: '#A0A0A0', fontSize: 11, display: 'block', marginBottom: 5 }}>FOREMAN</label>
              <div style={{ position: 'relative' }}>
                <select value={foremanId} onChange={(e) => setForemanId(e.target.value)} style={{ ...inputStyle, appearance: 'none', paddingRight: 28 }}>
                  <option value="">— Unassigned —</option>
                  {foremanOptions.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
                <ChevronDown size={12} color="#A0A0A0" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              </div>
            </div>
            <div>
              <label style={{ color: '#A0A0A0', fontSize: 11, display: 'block', marginBottom: 5 }}>MECHANIC</label>
              <div style={{ position: 'relative' }}>
                <select value={mechanicId} onChange={(e) => setMechanicId(e.target.value)} style={{ ...inputStyle, appearance: 'none', paddingRight: 28 }}>
                  <option value="">— Unassigned —</option>
                  {mechanicOptions.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
                <ChevronDown size={12} color="#A0A0A0" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ color: '#A0A0A0', fontSize: 11, display: 'block', marginBottom: 5 }}>ESTIMATED COST (RM)</label>
            <input type="number" value={estimatedCost} onChange={(e) => setEstimatedCost(e.target.value)} placeholder="0.00" min="0" step="0.01" style={inputStyle} />
          </div>

          <div style={{ marginBottom: 4 }}>
            <label style={{ color: '#A0A0A0', fontSize: 11, display: 'block', marginBottom: 5 }}>CUSTOMER COMPLAINT</label>
            <textarea rows={3} value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="What is the customer complaining about?" style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          {formError && <p style={{ color: '#FCA5A5', fontSize: 13, marginTop: 12 }}>{formError}</p>}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid #2A2A2A', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '9px 24px', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ padding: '9px 28px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Creating…' : 'Create Job Card'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vehicle Card
// ---------------------------------------------------------------------------
interface VehicleCardProps {
  job: JobRow
  userId: string
  userRole: string
  pendingRequest: StatusChangeRequest | null
  rejectedRequest: StatusChangeRequest | null
  onUpdateStatus: (job: JobRow) => void
  onAddNote: (job: JobRow) => void
  onView: (job: JobRow) => void
}

function useElapsed(checkedInAt: string | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!checkedInAt) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [checkedInAt])
  if (!checkedInAt) return null
  const diffMs = now - new Date(checkedInAt).getTime()
  const totalMins = Math.floor(diffMs / 60_000)
  const days  = Math.floor(totalMins / 1440)
  const hours = Math.floor((totalMins % 1440) / 60)
  const mins  = totalMins % 60
  if (days > 0)  return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function VehicleCard({ job, userId, userRole, pendingRequest, rejectedRequest, onUpdateStatus, onAddNote, onView }: VehicleCardProps) {
  const plate = job.vehicles?.plate_number ?? '—'
  const make = job.vehicles?.make ?? ''
  const model = job.vehicles?.model ?? ''
  const year = job.vehicles?.year ?? null
  const vType = (job.vehicles?.vehicle_type ?? job.vehicle_type ?? 'car').toUpperCase()
  const customerName = job.customers?.full_name ?? '—'
  const customerPhone = job.customers?.phone ?? ''
  const mechanicName = job.assigned_mechanic?.full_name ?? null
  const foremanName  = job.assigned_foreman?.full_name ?? null
  const daysInGarage = job.checked_in_at ? Math.floor((Date.now() - new Date(job.checked_in_at).getTime()) / 86400000) : 0
  const elapsed = useElapsed(job.checked_in_at)
  const serviceLabel = SERVICE_TYPE_LABELS[job.service_type] ?? job.service_type

  return (
    <div style={{ backgroundColor: '#161616', border: `1px solid ${pendingRequest ? '#F59E0B' : rejectedRequest ? '#EF4444' : '#2A2A2A'}`, borderRadius: 10, padding: 14, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 800, color: '#F15A22', letterSpacing: '0.06em' }}>{plate}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {daysInGarage > 0 && (
            <span style={{ backgroundColor: daysInGarage > 3 ? 'rgba(220,38,38,0.2)' : 'rgba(107,114,128,0.2)', color: daysInGarage > 3 ? '#FCA5A5' : '#9CA3AF', padding: '2px 7px', borderRadius: 9999, fontSize: 11, fontWeight: 600 }}>
              {daysInGarage}d
            </span>
          )}
          <span style={{ backgroundColor: vType === 'BIKE' ? 'rgba(139,92,246,0.2)' : 'rgba(59,130,246,0.2)', color: vType === 'BIKE' ? '#A78BFA' : '#60A5FA', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
            {vType}
          </span>
        </div>
      </div>

      {/* Approval status badges */}
      {pendingRequest && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, padding: '4px 8px', marginBottom: 8 }}>
          <Clock size={11} color="#F59E0B" />
          <span style={{ color: '#FCD34D', fontSize: 10, fontWeight: 700 }}>PENDING FOREMAN APPROVAL</span>
          <span style={{ color: '#A0A0A0', fontSize: 10 }}>→ {STATUS_CONFIG[pendingRequest.to_status]?.label}</span>
        </div>
      )}
      {rejectedRequest && !pendingRequest && (
        <div style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: '5px 8px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <XCircle size={11} color="#EF4444" />
            <span style={{ color: '#FCA5A5', fontSize: 10, fontWeight: 700 }}>REJECTED BY FOREMAN</span>
          </div>
          {rejectedRequest.reviewer_notes && (
            <p style={{ color: '#A0A0A0', fontSize: 10, margin: 0, fontStyle: 'italic' }}>"{rejectedRequest.reviewer_notes}"</p>
          )}
        </div>
      )}

      <div style={{ marginBottom: 4 }}>
        <p style={{ color: '#F0F0F0', fontSize: 13, fontWeight: 600, margin: 0 }}>{customerName}</p>
        {customerPhone && <p style={{ color: '#A0A0A0', fontSize: 11, margin: '1px 0 0' }}>{customerPhone}</p>}
      </div>
      <p style={{ color: '#A0A0A0', fontSize: 12, margin: '0 0 4px' }}>{[make, model, year].filter(Boolean).join(' ')}</p>
      <p style={{ color: '#A0A0A0', fontSize: 12, margin: '0 0 8px', fontStyle: 'italic' }}>{serviceLabel}</p>

      {elapsed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, backgroundColor: daysInGarage >= 3 ? 'rgba(220,38,38,0.1)' : 'rgba(245,158,11,0.08)', border: `1px solid ${daysInGarage >= 3 ? 'rgba(220,38,38,0.3)' : 'rgba(245,158,11,0.2)'}`, borderRadius: 6, padding: '3px 8px', marginBottom: 8, width: 'fit-content' }}>
          <Clock size={10} color={daysInGarage >= 3 ? '#FCA5A5' : '#FCD34D'} />
          <span style={{ color: daysInGarage >= 3 ? '#FCA5A5' : '#FCD34D', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{elapsed}</span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#555', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', minWidth: 28 }}>FMN</span>
            <span style={{ color: foremanName ? '#A0A0A0' : '#444', fontSize: 11 }}>{foremanName ?? '—'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#555', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', minWidth: 28 }}>MEC</span>
            <span style={{ color: mechanicName ? '#F0F0F0' : '#444', fontSize: 11, fontWeight: mechanicName ? 600 : 400 }}>{mechanicName ?? '—'}</span>
          </div>
        </div>
        <span style={{ color: '#A0A0A0', fontSize: 11, fontFamily: 'monospace' }}>{job.job_number}</span>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {canUserInitiate(job.status, userRole) && (
          <button onClick={() => onUpdateStatus(job)}
            style={{ flex: 1, padding: '5px 0', border: '1px solid #F15A22', borderRadius: 6, backgroundColor: 'transparent', color: '#F15A22', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            Update Status
          </button>
        )}
        <button onClick={() => onAddNote(job)}
          style={{ flex: 1, padding: '5px 0', border: '1px solid #2A2A2A', borderRadius: 6, backgroundColor: 'transparent', color: '#A0A0A0', fontSize: 11, cursor: 'pointer' }}>
          Add Note
        </button>
        <QuickPhotoUpload jobId={job.id} branchId={job.branch_id ?? ''} tenantId={job.tenant_id ?? ''} uploadedBy={userId} currentStatus={job.status} />
        <button onClick={() => onView(job)}
          style={{ flex: 1, padding: '5px 0', border: '1px solid #2A2A2A', borderRadius: 6, backgroundColor: 'transparent', color: '#A0A0A0', fontSize: 11, cursor: 'pointer' }}>
          View
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Kanban column
// ---------------------------------------------------------------------------
function KanbanColumn({ status, jobs, userId, userRole, pendingMap, rejectedMap, onUpdateStatus, onAddNote, onView }: {
  status: JobStatus; jobs: JobRow[]; userId: string; userRole: string
  pendingMap: Map<string, StatusChangeRequest>
  rejectedMap: Map<string, StatusChangeRequest>
  onUpdateStatus: (job: JobRow) => void
  onAddNote: (job: JobRow) => void
  onView: (job: JobRow) => void
}) {
  const cfg = STATUS_CONFIG[status]
  const count = jobs.length

  return (
    <div style={{ minWidth: 280, maxWidth: 300, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: cfg.dot, flexShrink: 0 }} />
        <span style={{ color: '#F0F0F0', fontSize: 13, fontWeight: 600, flex: 1 }}>{cfg.label}</span>
        <span style={{ backgroundColor: count > 0 ? '#F15A22' : '#1E1E1E', color: count > 0 ? '#fff' : '#A0A0A0', borderRadius: 9999, fontSize: 11, fontWeight: 700, padding: '1px 8px', minWidth: 20, textAlign: 'center' }}>
          {count}
        </span>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, paddingRight: 2 }}>
        {jobs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: '#A0A0A0', fontSize: 12, border: '1px dashed #2A2A2A', borderRadius: 8 }}>No vehicles</div>
        ) : (
          jobs.map((job) => (
            <VehicleCard key={job.id} job={job} userId={userId} userRole={userRole}
              pendingRequest={pendingMap.get(job.id) ?? null}
              rejectedRequest={rejectedMap.get(job.id) ?? null}
              onUpdateStatus={onUpdateStatus} onAddNote={onAddNote} onView={onView}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function WorkshopBoardPage() {
  const { user } = useAuthStore()
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vehicleFilter, setVehicleFilter] = useState<'all' | 'car' | 'bike'>('all')
  const [pendingRequests, setPendingRequests] = useState<StatusChangeRequest[]>([])
  const [jobHistory, setJobHistory] = useState<Record<string, StatusChangeRequest[]>>({})
  const [statusModal, setStatusModal] = useState<JobRow | null>(null)
  const [noteModal, setNoteModal] = useState<JobRow | null>(null)
  const [viewJob, setViewJob] = useState<JobRow | null>(null)
  const [showNewJobModal, setShowNewJobModal] = useState(false)
  const [showApprovalQueue, setShowApprovalQueue] = useState(false)

  const branchId = user?.branch_id
  const isSuperAdmin = user?.role === 'super_admin'
  const userRole = user?.role ?? ''
  const userName = user?.full_name ?? ''
  const userId = user?.id ?? ''
  const tenantId = user?.tenant_id ?? ''
  const isForemanUser = canApprove(userRole)

  // Derive pending/rejected maps
  const pendingMap = useMemo(() => {
    const map = new Map<string, StatusChangeRequest>()
    pendingRequests.filter(r => r.request_status === 'pending').forEach(r => map.set(r.job_id, r))
    return map
  }, [pendingRequests])

  const rejectedMap = useMemo(() => {
    const map = new Map<string, StatusChangeRequest>()
    pendingRequests.filter(r => r.request_status === 'rejected').forEach(r => {
      const ex = map.get(r.job_id)
      if (!ex || r.created_at > ex.created_at) map.set(r.job_id, r)
    })
    return map
  }, [pendingRequests])

  const pendingCount = pendingMap.size

  const fetchJobs = useCallback(async () => {
    if (!branchId && !isSuperAdmin) return
    setLoading(true); setError(null)
    try {
      let query = supabase
        .from('jobs')
        .select(`id, job_number, status, service_type, vehicle_type, days_in_garage,
          internal_notes, next_action, checked_in_at, estimated_cost, status_updated_at,
          customer_complaint, diagnosis_summary, branch_id, tenant_id, customer_id, vehicle_id,
          assigned_foreman_id, assigned_mechanic_id, source, arrival_mode, payment_status,
          customers!customer_id(full_name, phone),
          vehicles!vehicle_id(plate_number, make, model, year, vehicle_type),
          assigned_foreman:users!assigned_foreman_id(full_name),
          assigned_mechanic:users!assigned_mechanic_id(full_name)`)
        .not('status', 'eq', 'closed')
      if (branchId) query = query.eq('branch_id', branchId)
      query = query.order('checked_in_at', { ascending: true })
      const { data, error: err } = await query
      if (err) throw err
      const loaded = (data as unknown as JobRow[]) ?? []

      // Auto Long Due: any in_progress job sitting > 3 days → flag as long_due
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      const toLongDue = loaded.filter(j =>
        j.status === 'in_progress' &&
        j.status_updated_at &&
        j.status_updated_at < threeDaysAgo
      )
      if (toLongDue.length > 0) {
        await supabase.from('jobs').update({ status: 'long_due' }).in('id', toLongDue.map(j => j.id))
        toLongDue.forEach(j => { j.status = 'long_due' as JobStatus })
      }

      setJobs(loaded)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs')
    } finally {
      setLoading(false)
    }
  }, [branchId, isSuperAdmin])

  const fetchPendingRequests = useCallback(async () => {
    if (!branchId && !isSuperAdmin) return
    let query = supabase.from('status_change_requests').select('*')
      .in('request_status', ['pending', 'rejected'])
      .order('created_at', { ascending: false })
    if (branchId) query = query.eq('branch_id', branchId)
    const { data } = await query
    setPendingRequests((data ?? []) as StatusChangeRequest[])
  }, [branchId, isSuperAdmin])

  const fetchJobHistory = useCallback(async (jobId: string) => {
    const { data } = await supabase.from('status_change_requests').select('*')
      .eq('job_id', jobId).order('created_at', { ascending: false })
    setJobHistory(prev => ({ ...prev, [jobId]: (data ?? []) as StatusChangeRequest[] }))
  }, [])

  useEffect(() => { fetchJobs(); fetchPendingRequests() }, [fetchJobs, fetchPendingRequests])

  // Status update (non-gated, or foreman direct with checklist)
  const handleConfirmDirect = async (jobId: string, newStatus: JobStatus, nextAction: string, note: string, checklistAnswer?: boolean | null, checklistQuestion?: string) => {
    const existing = jobs.find(j => j.id === jobId)
    const existingNotes = existing?.internal_notes ?? ''
    const timestamp = new Date().toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

    let merged = existingNotes
    if (note.trim()) {
      const newEntry = `[${timestamp}] ${note.trim()}`
      merged = existingNotes ? `${existingNotes}\n${newEntry}` : newEntry
    }

    const { error: err } = await supabase.from('jobs').update({
      status: newStatus,
      next_action: nextAction || null,
      internal_notes: merged || null,
    }).eq('id', jobId)

    if (err) { toast(err.message, 'error'); return }

    // If foreman approved a gated transition, log it
    if (checklistAnswer !== null && checklistAnswer !== undefined && checklistQuestion) {
      await supabase.from('status_change_requests').insert({
        job_id: jobId,
        branch_id: branchId ?? '',
        tenant_id: tenantId || null,
        requested_by: userId || null,
        requested_by_name: userName,
        from_status: existing?.status ?? '',
        to_status: newStatus,
        checklist_question: checklistQuestion,
        checklist_answer: checklistAnswer,
        reviewer_notes: note.trim() || null,
        reviewed_by: userId || null,
        reviewed_by_name: userName,
        reviewed_at: new Date().toISOString(),
        request_status: 'approved',
      })
    }

    toast('Job status updated')
    const _auditJob = jobs.find(j => j.id === jobId)
    logAudit({ action: `status_change:${newStatus}`, module: 'Job', record_id: jobId, record_type: 'job', details: { job_number: _auditJob?.job_number ?? null, plate: _auditJob?.plate_number ?? null, customer: _auditJob?.customer_name ?? null, from_status: _auditJob?.status ?? null, to_status: newStatus }, branch_id: user?.branch_id, user_id: user?.id, tenant_id: user?.tenant_id })
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus, next_action: nextAction || null, internal_notes: merged } : j))
    fetchPendingRequests()
  }

  // Mechanic submits approval request
  const handleRequestApproval = async (jobId: string, toStatus: JobStatus, fromStatus: string, question: string, nextAction: string, note: string) => {
    // Cancel any existing pending request for this job first
    await supabase.from('status_change_requests').update({ request_status: 'cancelled' }).eq('job_id', jobId).eq('request_status', 'pending')

    const { error } = await supabase.from('status_change_requests').insert({
      job_id: jobId,
      branch_id: branchId ?? '',
      tenant_id: tenantId || null,
      requested_by: userId || null,
      requested_by_name: userName,
      from_status: fromStatus,
      to_status: toStatus,
      checklist_question: question,
      request_status: 'pending',
    })

    if (error) { toast(error.message, 'error'); return }

    // Update next_action with mechanic's context if provided
    if (nextAction.trim() || note.trim()) {
      const existing = jobs.find(j => j.id === jobId)
      const existingNotes = existing?.internal_notes ?? ''
      const timestamp = new Date().toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      let merged = existingNotes
      if (note.trim()) {
        const newEntry = `[${timestamp}] [Approval Request] ${note.trim()}`
        merged = existingNotes ? `${existingNotes}\n${newEntry}` : newEntry
      }
      await supabase.from('jobs').update({ next_action: nextAction || null, internal_notes: merged || null }).eq('id', jobId)
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, next_action: nextAction || null, internal_notes: merged } : j))
    }

    toast('Approval request submitted. Awaiting Foreman sign-off.')
    fetchPendingRequests()
  }

  // Foreman approves
  const handleApproveRequest = async (requestId: string, jobId: string, toStatus: JobStatus, checklistAnswer: boolean, notes: string, reviewerName: string, reviewerId: string) => {
    const request = pendingRequests.find(r => r.id === requestId)

    const { error: updateErr } = await supabase.from('status_change_requests').update({
      request_status: 'approved',
      checklist_answer: checklistAnswer,
      reviewer_notes: notes.trim() || null,
      reviewed_by: reviewerId || null,
      reviewed_by_name: reviewerName,
      reviewed_at: new Date().toISOString(),
    }).eq('id', requestId)

    if (updateErr) { toast(updateErr.message, 'error'); return }

    const { error: jobErr } = await supabase.from('jobs').update({ status: toStatus }).eq('id', jobId)
    if (jobErr) { toast(jobErr.message, 'error'); return }

    toast(`Approved — job moved to ${STATUS_CONFIG[toStatus]?.label}`)
    const _approvalJob = jobs.find(j => j.id === jobId)
    logAudit({ action: `approval:${toStatus}`, module: 'Job', record_id: jobId, record_type: 'job', details: { job_number: _approvalJob?.job_number ?? null, plate: _approvalJob?.plate_number ?? null, customer: _approvalJob?.customer_name ?? null, to_status: toStatus, approved_by: user?.full_name ?? null }, branch_id: user?.branch_id, user_id: user?.id, tenant_id: user?.tenant_id })
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: toStatus } : j))
    if (request) setJobHistory(prev => ({ ...prev, [jobId]: [{ ...request, request_status: 'approved', checklist_answer: checklistAnswer, reviewer_notes: notes.trim() || null, reviewed_by: reviewerId, reviewed_by_name: reviewerName, reviewed_at: new Date().toISOString() }, ...(prev[jobId] ?? [])] }))
    fetchPendingRequests()
  }

  // Foreman rejects
  const handleRejectRequest = async (requestId: string, jobId: string, notes: string, reviewerName: string, reviewerId: string) => {
    const request = pendingRequests.find(r => r.id === requestId)

    const { error } = await supabase.from('status_change_requests').update({
      request_status: 'rejected',
      reviewer_notes: notes.trim(),
      reviewed_by: reviewerId || null,
      reviewed_by_name: reviewerName,
      reviewed_at: new Date().toISOString(),
    }).eq('id', requestId)

    if (error) { toast(error.message, 'error'); return }

    toast('Rejected — mechanic has been flagged to re-diagnose.')
    if (request) setJobHistory(prev => ({ ...prev, [jobId]: [{ ...request, request_status: 'rejected', reviewer_notes: notes.trim(), reviewed_by: reviewerId, reviewed_by_name: reviewerName, reviewed_at: new Date().toISOString() }, ...(prev[jobId] ?? [])] }))
    fetchPendingRequests()
  }

  const handleSaveNote = async (jobId: string, note: string) => {
    const existing = jobs.find(j => j.id === jobId)
    const existingNotes = existing?.internal_notes ?? ''
    const timestamp = new Date().toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const newEntry = `[${timestamp}] ${note.trim()}`
    const merged = existingNotes ? `${existingNotes}\n${newEntry}` : newEntry
    const { error: err } = await supabase.from('jobs').update({ internal_notes: merged }).eq('id', jobId)
    if (!err) { toast('Note saved'); setJobs(prev => prev.map(j => j.id === jobId ? { ...j, internal_notes: merged } : j)) }
    else toast(err.message, 'error')
  }

  const handleViewJob = (job: JobRow) => {
    setViewJob(job)
    fetchJobHistory(job.id)
  }

  const filteredJobs = jobs.filter((j) => {
    if (vehicleFilter === 'all') return true
    const vt = (j.vehicles?.vehicle_type ?? j.vehicle_type ?? '').toLowerCase()
    return vt === vehicleFilter
  })

  const grouped = BOARD_COLUMNS.reduce<Record<JobStatus, JobRow[]>>((acc, col) => {
    acc[col] = filteredJobs.filter((j) => j.status === col)
    return acc
  }, {} as Record<JobStatus, JobRow[]>)

  return (
    <div style={{ backgroundColor: '#0E0E0E', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 104px)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#161616', borderBottom: '1px solid #2A2A2A', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 }}>
          <Wrench size={20} color="#F15A22" />
          <span style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 18 }}>Workshop Board</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {(['all', 'car', 'bike'] as const).map((v) => (
            <button key={v} onClick={() => setVehicleFilter(v)}
              style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid', borderColor: vehicleFilter === v ? '#F15A22' : '#2A2A2A', backgroundColor: vehicleFilter === v ? 'rgba(241,90,34,0.15)' : 'transparent', color: vehicleFilter === v ? '#F15A22' : '#A0A0A0', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' as const }}>
              {v === 'all' ? 'All' : v === 'car' ? 'Cars' : 'Bikes'}
            </button>
          ))}
          <button onClick={() => { fetchJobs(); fetchPendingRequests() }} disabled={loading}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <button onClick={() => setShowNewJobModal(true)}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} /> New Job
          </button>
        </div>
      </div>

      {/* Pending approvals banner — foreman only */}
      {isForemanUser && pendingCount > 0 && (
        <button onClick={() => setShowApprovalQueue(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', backgroundColor: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.3)', border: 'none', cursor: 'pointer', textAlign: 'left', flexShrink: 0, width: '100%' }}>
          <AlertTriangle size={15} color="#F59E0B" />
          <span style={{ color: '#FCD34D', fontSize: 13, fontWeight: 700 }}>{pendingCount} job{pendingCount > 1 ? 's' : ''} pending your approval</span>
          <span style={{ color: '#A0A0A0', fontSize: 12 }}>— Tap to review</span>
          <span style={{ marginLeft: 'auto', color: '#F59E0B', fontSize: 12, fontWeight: 600 }}>Review →</span>
        </button>
      )}

      {/* Board */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '16px 20px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 36, height: 36, border: '3px solid #2A2A2A', borderTopColor: '#F15A22', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
              <p style={{ color: '#A0A0A0', fontSize: 13 }}>Loading jobs…</p>
            </div>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: '#FCA5A5', fontSize: 14 }}>{error}</p>
            <button onClick={fetchJobs} style={{ marginTop: 12, padding: '8px 20px', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', cursor: 'pointer' }}>Retry</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, minWidth: 'max-content', height: '100%' }}>
            {BOARD_COLUMNS.map((col) => (
              <KanbanColumn key={col} status={col} jobs={grouped[col] ?? []} userId={userId} userRole={userRole}
                pendingMap={pendingMap} rejectedMap={rejectedMap}
                onUpdateStatus={setStatusModal}
                onAddNote={setNoteModal}
                onView={handleViewJob}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Modals */}
      {statusModal && (
        <StatusUpdateModal
          job={statusModal}
          userRole={userRole}
          userName={userName}
          userId={userId}
          tenantId={tenantId}
          onClose={() => setStatusModal(null)}
          onConfirmDirect={handleConfirmDirect}
          onRequestApproval={handleRequestApproval}
        />
      )}
      {noteModal && (
        <AddNoteModal job={noteModal} onClose={() => setNoteModal(null)} onSave={handleSaveNote} />
      )}
      {viewJob && (
        <JobDetailDrawer
          job={viewJob}
          approvalHistory={jobHistory[viewJob.id] ?? []}
          onClose={() => setViewJob(null)}
          onRefresh={fetchJobs}
        />
      )}
      {showNewJobModal && branchId && (
        <NewJobModal branchId={branchId} onClose={() => setShowNewJobModal(false)} onCreated={fetchJobs} />
      )}
      {showApprovalQueue && isForemanUser && (
        <ApprovalQueueModal
          requests={Array.from(pendingMap.values())}
          jobs={jobs}
          reviewerName={userName}
          reviewerId={userId}
          onClose={() => setShowApprovalQueue(false)}
          onApprove={handleApproveRequest}
          onReject={handleRejectRequest}
        />
      )}
    </div>
  )
}

export default WorkshopBoardPage
