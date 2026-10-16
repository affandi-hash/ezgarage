import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { registerDeletionPrompt, type DeletionAnswer, type DeletionAsk } from '@/lib/deletion'

const C = { surface: '#1C1C1C', border: '#2A2A2A', orange: '#F15A22', red: '#EF4444', text: '#F0F0F0', muted: '#A0A0A0' }

// Mounted once (App.tsx). deleteWithApproval() opens it and waits for the answer.
export function DeletionPrompt() {
  const [ask, setAsk] = useState<(DeletionAsk & { resolve: (a: DeletionAnswer) => void }) | null>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    registerDeletionPrompt((a) => new Promise<DeletionAnswer>((resolve) => { setReason(''); setAsk({ ...a, resolve }) }))
    return () => registerDeletionPrompt(null)
  }, [])

  if (!ask) return null
  const close = (ok: boolean) => { const r = ask.resolve; setAsk(null); r({ ok, reason: reason.trim() }) }
  const needReason = ask.needsApproval
  const canGo = !needReason || reason.trim().length >= 3

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
         onKeyDown={(e) => { if (e.key === 'Escape') close(false) }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, width: 440, maxWidth: '92vw', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={20} color={needReason ? C.orange : C.red} />
            <span style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{needReason ? 'Request deletion' : 'Delete'} {ask.label}?</span>
          </div>
          <button onClick={() => close(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 2 }}><X size={18} /></button>
        </div>
        <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, margin: '0 0 12px' }}>
          {needReason
            ? 'This record is not deleted straight away. A super admin must approve the request first, and a full copy is kept either way.'
            : 'The record is deleted and a full copy is kept in the deleted-records log.'}
        </p>
        {ask.warning && <p style={{ color: '#FBBF24', fontSize: 13, lineHeight: 1.5, margin: '0 0 12px' }}>{ask.warning}</p>}
        <label style={{ display: 'block', color: C.muted, fontSize: 12, marginBottom: 6 }}>{needReason ? 'Reason (required)' : 'Reason (optional)'}</label>
        <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why should this be deleted?"
          style={{ width: '100%', boxSizing: 'border-box', background: '#0E0E0E', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: 10, fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button onClick={() => close(false)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, padding: '8px 20px', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
          <button disabled={!canGo} onClick={() => close(true)}
            style={{ background: needReason ? C.orange : C.red, border: 'none', borderRadius: 6, color: '#fff', padding: '8px 22px', cursor: canGo ? 'pointer' : 'not-allowed', opacity: canGo ? 1 : 0.5, fontSize: 14, fontWeight: 700 }}>
            {needReason ? 'Send request' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
