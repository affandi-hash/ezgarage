import { X, AlertTriangle } from 'lucide-react'

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}

const C = {
  bg: '#0E0E0E',
  surface: '#1C1C1C',
  border: '#2A2A2A',
  orange: '#F15A22',
  red: '#EF4444',
  textPrimary: '#F0F0F0',
  textSecondary: '#A0A0A0',
}

export function ConfirmModal({ title, message, confirmLabel = 'Confirm', onConfirm, onCancel, danger = false }: ConfirmModalProps) {
  const accentColor = danger ? C.red : C.orange

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        width: 420,
        maxWidth: '92vw',
        padding: 28,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={20} color={accentColor} />
            <span style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary }}>{title}</span>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSecondary, padding: 2 }}>
            <X size={18} />
          </button>
        </div>
        <p style={{ color: C.textSecondary, fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onCancel} style={{
            background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
            color: C.textSecondary, padding: '8px 20px', cursor: 'pointer', fontSize: 14,
          }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{
            background: accentColor, border: 'none', borderRadius: 6,
            color: '#fff', padding: '8px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 700,
          }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
