import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

let _show: ((msg: string, type: ToastType) => void) | null = null
let _nextId = 1

export function toast(message: string, type: ToastType = 'success') {
  _show?.(message, type)
}
toast.success = (message: string) => toast(message, 'success')
toast.error   = (message: string) => toast(message, 'error')
toast.info    = (message: string) => toast(message, 'info')

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    _show = (message, type) => {
      const id = _nextId++
      setItems((prev) => [...prev, { id, message, type }])
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id))
      }, 4000)
    }
    return () => { _show = null }
  }, [])

  if (items.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {items.map((item) => {
        const colors = {
          success: { bg: '#161616', border: '#4ADE80', icon: '#4ADE80', IconCmp: CheckCircle },
          error:   { bg: '#161616', border: '#F87171', icon: '#F87171', IconCmp: XCircle },
          info:    { bg: '#161616', border: '#60A5FA', icon: '#60A5FA', IconCmp: Info },
        }
        const { bg, border, icon, IconCmp } = colors[item.type]
        return (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              backgroundColor: bg,
              border: `1px solid ${border}`,
              borderRadius: 10,
              padding: '12px 16px',
              minWidth: 280,
              maxWidth: 400,
              boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px ${border}22`,
              pointerEvents: 'all',
              animation: 'toast-in 0.2s ease',
            }}
          >
            <IconCmp size={16} color={icon} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, color: '#F0F0F0', fontSize: 13, fontWeight: 500 }}>{item.message}</span>
            <button
              onClick={() => setItems((prev) => prev.filter((t) => t.id !== item.id))}
              style={{
                background: 'none', border: 'none', color: '#666',
                cursor: 'pointer', padding: 0, display: 'flex',
              }}
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
