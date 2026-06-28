import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, Clock } from 'lucide-react'

// ── helpers ───────────────────────────────────────────────────────────────────

const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function parseDate(val: string): Date | null {
  if (!val) return null
  const d = new Date(val + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

function to12(t: string) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

const DEFAULT_SLOTS = [
  '08:00','08:30','09:00','09:30','10:00','10:30',
  '11:00','11:30','12:00','12:30','14:00','14:30',
  '15:00','15:30','16:00','16:30','17:00','17:30',
]

// ── DatePickerInput ───────────────────────────────────────────────────────────
// value / onChange use "YYYY-MM-DD" strings — compatible with existing form state.

export interface DatePickerInputProps {
  value: string
  onChange: (val: string) => void
  min?: string
  placeholder?: string
  style?: React.CSSProperties
  dark?: boolean
}

export function DatePickerInput({ value, onChange, min, style, dark = true }: DatePickerInputProps) {
  const selectedDate = parseDate(value)
  const [open, setOpen]           = useState(false)
  const [viewYear, setViewYear]   = useState(() => (selectedDate ?? new Date()).getFullYear())
  const [viewMonth, setViewMonth] = useState(() => (selectedDate ?? new Date()).getMonth())
  const [rect, setRect]           = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const minDate = min ? parseDate(min) : null

  function openPicker() {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    const d = selectedDate ?? new Date()
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    setOpen(true)
  }

  function selectDay(year: number, month: number, day: number) {
    onChange(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    setOpen(false)
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  function buildCells() {
    const firstDow = new Date(viewYear, viewMonth, 1).getDay()
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const cells: (number | null)[] = Array(firstDow).fill(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // theme tokens
  const bg      = dark ? '#1C1C1C' : '#fff'
  const border  = dark ? '#333'    : '#ddd'
  const text    = dark ? '#F0F0F0' : '#111'
  const text2   = dark ? '#666'    : '#999'
  const hoverBg = dark ? '#2A2A2A' : '#f5f5f5'
  const accent  = '#F15A22'
  const today   = new Date().toISOString().slice(0, 10)

  const displayVal = selectedDate
    ? selectedDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''

  const popup = open && rect && createPortal(
    <div
      style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 99999,
        background: bg, border: `1px solid ${border}`, borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)', padding: 12, width: 252, userSelect: 'none' }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: text2, cursor: 'pointer', padding: '2px 8px', fontSize: 18, lineHeight: 1 }}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 700, color: text }}>{MONTHS[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: text2, cursor: 'pointer', padding: '2px 8px', fontSize: 18, lineHeight: 1 }}>›</button>
      </div>

      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, color: text2, fontWeight: 700, padding: '2px 0' }}>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
        {buildCells().map((day, i) => {
          if (!day) return <div key={i} />
          const ds = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const isSelected  = value === ds
          const isToday     = ds === today
          const isDisabled  = minDate ? new Date(ds + 'T00:00:00') < minDate : false
          return (
            <button
              key={i}
              onClick={() => !isDisabled && selectDay(viewYear, viewMonth, day)}
              style={{
                background: isSelected ? accent : 'none',
                border: isToday && !isSelected ? `1px solid ${accent}` : '1px solid transparent',
                borderRadius: 6, color: isDisabled ? (dark ? '#3A3A3A' : '#ccc') : isSelected ? '#fff' : text,
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                fontSize: 12, fontWeight: isSelected ? 700 : 400,
                padding: '5px 0', textAlign: 'center',
              }}
              onMouseEnter={e => { if (!isSelected && !isDisabled) (e.currentTarget as HTMLButtonElement).style.background = hoverBg }}
              onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>,
    document.body
  )

  return (
    <div ref={triggerRef} style={{ position: 'relative', width: '100%' }}>
      <div onClick={openPicker} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', ...style }}>
        <span style={{ flex: 1, color: displayVal ? text : text2 }}>{displayVal || 'Select date'}</span>
        <Calendar size={14} color={text2} style={{ flexShrink: 0 }} />
      </div>
      {popup}
    </div>
  )
}

// ── TimePickerInput ───────────────────────────────────────────────────────────
// value / onChange use "HH:MM" 24-hr strings — compatible with existing form state.

export interface TimePickerInputProps {
  value: string
  onChange: (val: string) => void
  slots?: string[]                // "HH:MM" 24-hr strings
  style?: React.CSSProperties
  dark?: boolean
}

export function TimePickerInput({ value, onChange, slots = DEFAULT_SLOTS, style, dark = true }: TimePickerInputProps) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  function openPicker() {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const bg      = dark ? '#1C1C1C' : '#fff'
  const border  = dark ? '#333'    : '#ddd'
  const text    = dark ? '#F0F0F0' : '#111'
  const text2   = dark ? '#666'    : '#999'
  const hoverBg = dark ? '#2A2A2A' : '#f5f5f5'
  const accent  = '#F15A22'

  const popup = open && rect && createPortal(
    <div
      style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 99999,
        background: bg, border: `1px solid ${border}`, borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)', padding: 6,
        width: Math.max(rect.width, 160), maxHeight: 260, overflowY: 'auto', userSelect: 'none' }}
      onMouseDown={e => e.stopPropagation()}
    >
      {slots.map(slot => {
        const isSelected = value === slot
        return (
          <div
            key={slot}
            onClick={() => { onChange(slot); setOpen(false) }}
            style={{
              padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
              fontSize: 13, fontWeight: isSelected ? 700 : 400,
              color: isSelected ? '#fff' : text,
              background: isSelected ? accent : 'none',
            }}
            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = hoverBg }}
            onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'none' }}
          >
            {to12(slot)}
          </div>
        )
      })}
    </div>,
    document.body
  )

  return (
    <div ref={triggerRef} style={{ position: 'relative', width: '100%' }}>
      <div onClick={openPicker} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', ...style }}>
        <span style={{ flex: 1, color: value ? text : text2 }}>{value ? to12(value) : 'Select time'}</span>
        <Clock size={14} color={text2} style={{ flexShrink: 0 }} />
      </div>
      {popup}
    </div>
  )
}
