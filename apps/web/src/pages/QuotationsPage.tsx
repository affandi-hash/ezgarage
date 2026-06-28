import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  FileText, Plus, Search, X, MoreVertical,
  Trash2, Printer,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useOutletContext } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface QuoteItem {
  id?: string
  item_type: 'service' | 'part' | 'labour' | 'other'
  description: string
  qty: number
  unit_price: number
}

interface QuoteRow {
  id: string
  quote_number: string
  status: string
  customer_name: string
  customer_phone: string
  vehicle_plate: string
  vehicle_make: string
  vehicle_model: string
  vehicle_year: number | null
  total_amount: number
  valid_until: string | null
  validity_days: number
  notes: string | null
  created_at: string
  customer_id: string | null
  vehicle_id: string | null
  customer_email: string | null
  converted_to_booking_id: string | null
  branch_id: string
}

interface CustomerResult { id: string; full_name: string; phone: string; email: string | null; ic_number: string | null }
interface VehicleResult  { id: string; plate_number: string; make: string; model: string; year: number | null; customer_id: string | null }

const C = {
  bg: '#0E0E0E', surface: '#161616', surface2: '#1E1E1E', surface3: '#262626',
  border: '#2A2A2A', orange: '#F15A22', text: '#F0F0F0', text2: '#A0A0A0',
  green: '#22C55E', blue: '#3B82F6', yellow: '#EAB308', red: '#EF4444',
}

const STATUS_COLOR: Record<string, string> = {
  draft: '#6B7280', sent: '#3B82F6', accepted: '#22C55E',
  rejected: '#EF4444', expired: '#EAB308',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', accepted: 'Accepted',
  rejected: 'Rejected', expired: 'Expired',
}

const ITEM_TYPES = ['service', 'part', 'labour', 'other'] as const

const inputStyle: React.CSSProperties = {
  width: '100%', background: C.surface2, border: `1px solid ${C.border}`,
  borderRadius: 6, color: C.text, padding: '8px 12px', fontSize: 13,
  outline: 'none', boxSizing: 'border-box',
}

function formatRM(n: number | null | undefined) {
  return 'RM ' + (n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function formatDate(s: string) {
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Actions menu (portal-based)
// ---------------------------------------------------------------------------
function ActionsMenu({ quote, onView, onDuplicate, onMarkSent, onMarkAccepted, onMarkRejected, onConvert, onDelete, onPrint }: {
  quote: QuoteRow
  onView: () => void
  onDuplicate: () => void
  onMarkSent: () => void
  onMarkAccepted: () => void
  onMarkRejected: () => void
  onConvert: () => void
  onDelete: () => void
  onPrint: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  function handleOpen() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setOpen(p => !p)
  }

  const items = [
    { label: 'View / Edit', action: onView, color: C.text, show: true },
    { label: 'Print / Save PDF', action: onPrint, color: C.text2, show: true },
    { label: 'Duplicate', action: onDuplicate, color: C.text2, show: true },
    { label: 'Mark as Sent', action: onMarkSent, color: '#93C5FD', show: quote.status === 'draft' },
    { label: 'Mark as Accepted', action: onMarkAccepted, color: C.green, show: quote.status === 'sent' },
    { label: 'Mark as Rejected', action: onMarkRejected, color: C.red, show: quote.status === 'sent' },
    { label: '→ Convert to Booking', action: onConvert, color: C.orange, show: quote.status === 'accepted' && !quote.converted_to_booking_id },
    { label: 'Delete', action: onDelete, color: C.red, show: quote.status === 'draft' },
  ].filter(m => m.show)

  return (
    <div style={{ position: 'relative' }}>
      <button ref={btnRef} onClick={handleOpen}
        style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text2, cursor: 'pointer', padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
        <MoreVertical size={14} />
      </button>
      {open && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setOpen(false)} />
          <div style={{ position: 'fixed', right: pos.right, top: pos.top, backgroundColor: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, zIndex: 9999, minWidth: 190, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
            {items.map(m => (
              <button key={m.label} onClick={() => { m.action(); setOpen(false) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', background: 'none', border: 'none', color: m.color, fontSize: 13, cursor: 'pointer' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.surface3 }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}>
                {m.label}
              </button>
            ))}
          </div>
        </>, document.body
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// New/Edit Quote Drawer
// ---------------------------------------------------------------------------
interface DrawerProps {
  branchId: string | null
  tenantId: string | null
  userId: string | null
  editQuote?: QuoteRow | null
  onClose: () => void
  onSaved: () => void
}

function QuoteDrawer({ branchId, tenantId, userId, editQuote, onClose, onSaved }: DrawerProps) {
  const isEdit = !!editQuote

  const [custName, setCustName]       = useState(editQuote?.customer_name ?? '')
  const [custPhone, setCustPhone]     = useState(editQuote?.customer_phone ?? '')
  const [custEmail, setCustEmail]     = useState(editQuote?.customer_email ?? '')
  const [custId, setCustId]           = useState<string | null>(editQuote?.customer_id ?? null)
  const [plate, setPlate]             = useState(editQuote?.vehicle_plate ?? '')
  const [make, setMake]               = useState(editQuote?.vehicle_make ?? '')
  const [model, setModel]             = useState(editQuote?.vehicle_model ?? '')
  const [year, setYear]               = useState<string>(editQuote?.vehicle_year?.toString() ?? '')
  const [vehicleId, setVehicleId]     = useState<string | null>(editQuote?.vehicle_id ?? null)
  const [validityDays, setValidityDays] = useState<string>(editQuote?.validity_days?.toString() ?? '7')
  const [notes, setNotes]             = useState(editQuote?.notes ?? '')
  const [saving, setSaving]           = useState(false)

  const [items, setItems] = useState<QuoteItem[]>([
    { item_type: 'service', description: '', qty: 1, unit_price: 0 },
  ])

  const [custSearch, setCustSearch]       = useState('')
  const [custResults, setCustResults]     = useState<CustomerResult[]>([])
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [vehicleResults, setVehicleResults] = useState<VehicleResult[]>([])
  const custInputRef    = useRef<HTMLDivElement>(null)
  const vehicleInputRef = useRef<HTMLDivElement>(null)
  const [custRect, setCustRect]       = useState<DOMRect | null>(null)
  const [vehicleRect, setVehicleRect] = useState<DOMRect | null>(null)

  // Load existing items when editing
  useEffect(() => {
    if (!editQuote) return
    supabase.from('quotation_items').select('*').eq('quotation_id', editQuote.id).order('sort_order').then(({ data }) => {
      if (data && data.length > 0) {
        setItems(data.map(d => ({ id: d.id, item_type: d.item_type, description: d.description, qty: Number(d.qty), unit_price: Number(d.unit_price) })))
      }
    })
  }, [editQuote?.id])

  const total = items.reduce((s, i) => s + i.qty * i.unit_price, 0)

  // Customer search
  useEffect(() => {
    if (!custSearch.trim() || !branchId) { setCustResults([]); setCustRect(null); return }
    const t = setTimeout(async () => {
      const [byName, byPhone] = await Promise.all([
        supabase.from('customers').select('id, full_name, phone, email, ic_number').eq('branch_id', branchId).ilike('full_name', `%${custSearch}%`).limit(8),
        supabase.from('customers').select('id, full_name, phone, email, ic_number').eq('branch_id', branchId).ilike('phone', `%${custSearch}%`).limit(8),
      ])
      const seen = new Set<string>()
      const merged = [...(byName.data || []), ...(byPhone.data || [])].filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true })
      const results = merged
      setCustResults(results)
      if (results.length > 0 && custInputRef.current) {
        setCustRect(custInputRef.current.getBoundingClientRect())
      } else {
        setCustRect(null)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [custSearch, branchId])

  // Vehicle search
  useEffect(() => {
    if (!vehicleSearch.trim() || !branchId) { setVehicleResults([]); setVehicleRect(null); return }
    const t = setTimeout(async () => {
      let query = supabase
        .from('vehicles')
        .select('id, plate_number, make, model, year, customer_id')
        .ilike('plate_number', `%${vehicleSearch}%`)
        .limit(8)
      if (custId) {
        query = query.eq('customer_id', custId)
      } else {
        query = query.eq('branch_id', branchId)
      }
      const { data, error } = await query
      if (error) console.error('Vehicle search error:', error)
      const results = data || []
      setVehicleResults(results)
      if (results.length > 0 && vehicleInputRef.current) {
        setVehicleRect(vehicleInputRef.current.getBoundingClientRect())
      } else {
        setVehicleRect(null)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [vehicleSearch, branchId, custId])

  function selectCustomer(c: CustomerResult) {
    setCustId(c.id); setCustName(c.full_name); setCustPhone(c.phone); setCustEmail(c.email ?? ''); setCustSearch(''); setCustResults([]); setCustRect(null)
  }

  function selectVehicle(v: VehicleResult) {
    setVehicleId(v.id); setPlate(v.plate_number); setMake(v.make); setModel(v.model)
    setYear(v.year?.toString() ?? ''); setVehicleSearch(''); setVehicleResults([]); setVehicleRect(null)
  }

  function addItem() {
    setItems(p => [...p, { item_type: 'service', description: '', qty: 1, unit_price: 0 }])
  }
  function removeItem(i: number) {
    setItems(p => p.filter((_, idx) => idx !== i))
  }
  function updateItem(i: number, field: keyof QuoteItem, value: string | number) {
    setItems(p => p.map((it, idx) => idx === i ? { ...it, [field]: value } : it))
  }

  async function handleSave(status: 'draft' | 'sent' = 'draft') {
    if (!branchId || !tenantId) return
    if (!custName.trim()) { toast.error('Customer name is required'); return }
    if (!plate.trim()) { toast.error('Vehicle plate is required'); return }
    if (items.every(i => !i.description.trim())) { toast.error('Add at least one line item'); return }

    setSaving(true)
    const validUntil = new Date()
    validUntil.setDate(validUntil.getDate() + parseInt(validityDays || '7'))

    try {
      if (isEdit && editQuote) {
        // Update quotation
        const { error } = await supabase.from('quotations').update({
          customer_name: custName.trim(),
          customer_phone: custPhone.trim(),
          customer_email: custEmail.trim() || null,
          customer_id: custId,
          vehicle_plate: plate.toUpperCase().replace(/\s/g, ''),
          vehicle_make: make.trim(),
          vehicle_model: model.trim(),
          vehicle_year: year ? parseInt(year) : null,
          vehicle_id: vehicleId,
          validity_days: parseInt(validityDays || '7'),
          valid_until: validUntil.toISOString().split('T')[0],
          notes: notes.trim() || null,
          total_amount: total,
          status,
          updated_at: new Date().toISOString(),
        }).eq('id', editQuote.id)
        if (error) throw error

        // Replace items
        await supabase.from('quotation_items').delete().eq('quotation_id', editQuote.id)
        const validItems = items.filter(i => i.description.trim())
        if (validItems.length > 0) {
          await supabase.from('quotation_items').insert(validItems.map((it, idx) => ({
            quotation_id: editQuote.id,
            item_type: it.item_type,
            description: it.description,
            qty: it.qty,
            unit_price: it.unit_price,
            sort_order: idx,
          })))
        }
      } else {
        // Generate quote number
        const { data: qnData } = await supabase.rpc('generate_quote_number', { p_branch_id: branchId })
        const quoteNumber = qnData || `QT-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-0001`

        const { data: q, error } = await supabase.from('quotations').insert({
          tenant_id: tenantId,
          branch_id: branchId,
          quote_number: quoteNumber,
          status,
          customer_name: custName.trim(),
          customer_phone: custPhone.trim(),
          customer_email: custEmail.trim() || null,
          customer_id: custId,
          vehicle_plate: plate.toUpperCase().replace(/\s/g, ''),
          vehicle_make: make.trim(),
          vehicle_model: model.trim(),
          vehicle_year: year ? parseInt(year) : null,
          vehicle_id: vehicleId,
          validity_days: parseInt(validityDays || '7'),
          valid_until: validUntil.toISOString().split('T')[0],
          notes: notes.trim() || null,
          total_amount: total,
          created_by: userId,
        }).select('id').single()
        if (error) throw error

        const validItems = items.filter(i => i.description.trim())
        if (validItems.length > 0) {
          await supabase.from('quotation_items').insert(validItems.map((it, idx) => ({
            quotation_id: q!.id,
            item_type: it.item_type,
            description: it.description,
            qty: it.qty,
            unit_price: it.unit_price,
            sort_order: idx,
          })))
        }
      }

      toast.success(isEdit ? 'Quotation updated' : status === 'sent' ? 'Quotation created & marked as Sent' : 'Quotation saved as Draft')
      onSaved()
    } catch (e: any) {
      toast.error('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 680, backgroundColor: C.surface, borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, backgroundColor: C.surface, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileText size={18} color={C.orange} />
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{isEdit ? `Edit ${editQuote?.quote_number}` : 'New Quotation'}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.text2, cursor: 'pointer', padding: 4 }}><X size={18} /></button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Customer */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Customer</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div ref={custInputRef} style={{ gridColumn: '1 / -1', position: 'relative' }}>
                <label style={{ fontSize: 11, color: C.text2, display: 'block', marginBottom: 6 }}>Search existing customer</label>
                <input style={inputStyle} placeholder="Search by name or phone…" value={custSearch} onChange={e => setCustSearch(e.target.value)}
                  onBlur={() => setTimeout(() => { setCustResults([]); setCustRect(null) }, 200)} />
                {custRect && custResults.length > 0 && createPortal(
                  <div style={{
                    position: 'fixed',
                    top: custRect.bottom + 2,
                    left: custRect.left,
                    width: custRect.width,
                    zIndex: 9999, backgroundColor: C.surface2, border: `1px solid ${C.border}`,
                    borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  }}>
                    {custResults.map(c => (
                      <button key={c.id} onClick={() => selectCustomer(c)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: `1px solid ${C.border}`, color: C.text, fontSize: 13 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.surface3 }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}>
                        <strong>{c.full_name}</strong> <span style={{ color: C.text2, fontSize: 12 }}>{c.phone}</span>
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.text2, display: 'block', marginBottom: 6 }}>Name *</label>
                <input style={inputStyle} placeholder="Ahmad bin Abdullah" value={custName} onChange={e => setCustName(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.text2, display: 'block', marginBottom: 6 }}>Phone *</label>
                <input style={inputStyle} placeholder="01X-XXXXXXX" value={custPhone} onChange={e => setCustPhone(e.target.value)} type="tel" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, color: C.text2, display: 'block', marginBottom: 6 }}>Email (optional)</label>
                <input style={inputStyle} placeholder="email@example.com" value={custEmail} onChange={e => setCustEmail(e.target.value)} type="email" />
              </div>
            </div>
          </section>

          {/* Vehicle */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Vehicle</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div ref={vehicleInputRef} style={{ gridColumn: '1 / -1', position: 'relative' }}>
                <label style={{ fontSize: 11, color: C.text2, display: 'block', marginBottom: 6 }}>Search by plate number</label>
                <input style={inputStyle} placeholder="Search plate…" value={vehicleSearch} onChange={e => setVehicleSearch(e.target.value.toUpperCase())}
                  onBlur={() => setTimeout(() => { setVehicleResults([]); setVehicleRect(null) }, 200)} />
                {vehicleRect && vehicleResults.length > 0 && createPortal(
                  <div style={{
                    position: 'fixed',
                    top: vehicleRect.bottom + 2,
                    left: vehicleRect.left,
                    width: vehicleRect.width,
                    zIndex: 9999, backgroundColor: C.surface2, border: `1px solid ${C.border}`,
                    borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  }}>
                    {vehicleResults.map(v => (
                      <button key={v.id} onClick={() => selectVehicle(v)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: `1px solid ${C.border}`, color: C.text, fontSize: 13 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.surface3 }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}>
                        <strong style={{ color: C.orange }}>{v.plate_number}</strong> <span style={{ color: C.text2 }}>{v.make} {v.model}</span>
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.text2, display: 'block', marginBottom: 6 }}>Plate Number *</label>
                <input style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: 2 }} placeholder="WXY1234" value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.text2, display: 'block', marginBottom: 6 }}>Year</label>
                <input style={inputStyle} placeholder="2022" value={year} onChange={e => setYear(e.target.value)} type="number" min={1980} max={2030} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.text2, display: 'block', marginBottom: 6 }}>Make</label>
                <input style={inputStyle} placeholder="Toyota" value={make} onChange={e => setMake(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.text2, display: 'block', marginBottom: 6 }}>Model</label>
                <input style={inputStyle} placeholder="Hilux" value={model} onChange={e => setModel(e.target.value)} />
              </div>
            </div>
          </section>

          {/* Line Items */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Line Items</div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 70px 110px 90px 36px', gap: 8, padding: '8px 12px', backgroundColor: C.surface3, borderBottom: `1px solid ${C.border}` }}>
                {['Type', 'Description', 'Qty', 'Unit Price', 'Total', ''].map(h => (
                  <span key={h} style={{ fontSize: 11, color: C.text2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</span>
                ))}
              </div>
              {items.map((item, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 70px 110px 90px 36px', gap: 8, padding: '8px 12px', borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : 'none', alignItems: 'center' }}>
                  <select value={item.item_type} onChange={e => updateItem(i, 'item_type', e.target.value)}
                    style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}>
                    {ITEM_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                  <input style={{ ...inputStyle, padding: '6px 8px', fontSize: 13 }} placeholder="Description…"
                    value={item.description} onChange={e => updateItem(i, 'description', e.target.value)} />
                  <input style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, textAlign: 'right' }} type="number" min={0.01} step={0.01}
                    value={item.qty} onChange={e => updateItem(i, 'qty', parseFloat(e.target.value) || 0)} />
                  <input style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, textAlign: 'right' }} type="number" min={0} step={0.01}
                    value={item.unit_price} onChange={e => updateItem(i, 'unit_price', parseFloat(e.target.value) || 0)} />
                  <span style={{ fontSize: 13, color: C.text, textAlign: 'right', fontWeight: 600 }}>
                    {formatRM(item.qty * item.unit_price)}
                  </span>
                  <button onClick={() => removeItem(i)} disabled={items.length === 1}
                    style={{ background: 'none', border: 'none', color: items.length === 1 ? C.border : C.red, cursor: items.length === 1 ? 'default' : 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {/* Add row */}
              <div style={{ padding: '8px 12px', borderTop: `1px solid ${C.border}` }}>
                <button onClick={addItem}
                  style={{ background: 'none', border: `1px dashed ${C.border}`, borderRadius: 6, color: C.text2, cursor: 'pointer', padding: '6px 14px', fontSize: 12, width: '100%' }}>
                  + Add Line Item
                </button>
              </div>
            </div>
            {/* Total */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, paddingRight: 4 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: C.text2, marginBottom: 2 }}>TOTAL</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: C.orange }}>{formatRM(total)}</div>
              </div>
            </div>
          </section>

          {/* Notes & Validity */}
          <section>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: C.text2, display: 'block', marginBottom: 6 }}>Valid for (days)</label>
                <input style={inputStyle} type="number" min={1} max={90} value={validityDays} onChange={e => setValidityDays(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.text2, display: 'block', marginBottom: 6 }}>Notes (optional)</label>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} placeholder="e.g. Subject to parts availability…"
                  value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, backgroundColor: C.surface, display: 'flex', gap: 10, justifyContent: 'flex-end', position: 'sticky', bottom: 0 }}>
          <button onClick={onClose} style={{ padding: '0 20px', minHeight: 44, borderRadius: 8, border: `1px solid ${C.border}`, backgroundColor: 'transparent', color: C.text2, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={() => handleSave('draft')} disabled={saving}
            style={{ padding: '0 20px', minHeight: 44, borderRadius: 8, border: `1px solid ${C.border}`, backgroundColor: 'transparent', color: C.text, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
            Save Draft
          </button>
          <button onClick={() => handleSave('sent')} disabled={saving}
            style={{ padding: '0 24px', minHeight: 44, borderRadius: 8, border: 'none', backgroundColor: C.orange, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Save & Mark Sent' : 'Create & Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export function QuotationsPage() {
  const { user } = useAuthStore()
  const tenantId = user?.tenant_id ?? null
  const { selectedBranchId } = useOutletContext<{ selectedBranchId: string | null }>()
  const branchId = user?.role === 'super_admin' ? selectedBranchId : (user?.branch_id ?? null)

  const [quotes, setQuotes]           = useState<QuoteRow[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showDrawer, setShowDrawer]   = useState(false)
  const [editQuote, setEditQuote]     = useState<QuoteRow | null>(null)

  // Print view
  const [showPrintView, setShowPrintView] = useState(false)
  const [printQuote, setPrintQuote]       = useState<QuoteRow | null>(null)
  const [printItems, setPrintItems]       = useState<QuoteItem[]>([])
  const [branchInfo, setBranchInfo]       = useState<{ name: string; address: string | null; phone: string | null; email: string | null; logo_url: string | null; bank_name: string | null; bank_account_number: string | null; bank_account_name: string | null } | null>(null)

  useEffect(() => {
    if (!branchId) return
    supabase.from('branches').select('name,address,phone,email,logo_url,bank_name,bank_account_number,bank_account_name').eq('id', branchId).single()
      .then(({ data }) => { if (data) setBranchInfo(data as typeof branchInfo) })
  }, [branchId])

  async function openPrintView(q: QuoteRow) {
    const { data } = await supabase.from('quotation_items').select('*').eq('quotation_id', q.id).order('sort_order')
    setPrintItems(data || [])
    setPrintQuote(q)
    setShowPrintView(true)
  }

  const fetchQuotes = useCallback(async () => {
    if (!tenantId) { setLoading(false); return }
    setLoading(true)
    let q = supabase.from('quotations').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
    if (branchId) q = q.eq('branch_id', branchId)
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    if (search.trim()) q = q.or(`quote_number.ilike.%${search}%,customer_name.ilike.%${search}%,vehicle_plate.ilike.%${search}%`)
    const { data } = await q.limit(100)
    setQuotes(data || [])
    setLoading(false)
  }, [tenantId, branchId, statusFilter, search])

  useEffect(() => { fetchQuotes() }, [fetchQuotes])

  // Auto-expire quotes past valid_until
  useEffect(() => {
    if (!tenantId) return
    supabase.from('quotations').update({ status: 'expired' })
      .eq('tenant_id', tenantId).eq('status', 'sent')
      .lt('valid_until', new Date().toISOString().split('T')[0])
      .then(() => {})
  }, [tenantId])

  async function updateStatus(id: string, status: string) {
    await supabase.from('quotations').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    toast.success(`Marked as ${STATUS_LABEL[status]}`)
    fetchQuotes()
  }

  async function duplicateQuote(q: QuoteRow) {
    if (!branchId || !tenantId) return
    const { data: items } = await supabase.from('quotation_items').select('*').eq('quotation_id', q.id).order('sort_order')
    const { data: qnData } = await supabase.rpc('generate_quote_number', { p_branch_id: branchId })
    const quoteNumber = qnData || `QT-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-DUP`
    const validUntil = new Date()
    validUntil.setDate(validUntil.getDate() + q.validity_days)
    const { data: newQ } = await supabase.from('quotations').insert({
      tenant_id: tenantId, branch_id: branchId,
      quote_number: quoteNumber, status: 'draft',
      customer_name: q.customer_name, customer_phone: q.customer_phone,
      customer_email: q.customer_email, customer_id: q.customer_id,
      vehicle_plate: q.vehicle_plate, vehicle_make: q.vehicle_make,
      vehicle_model: q.vehicle_model, vehicle_year: q.vehicle_year, vehicle_id: q.vehicle_id,
      validity_days: q.validity_days, valid_until: validUntil.toISOString().split('T')[0],
      notes: q.notes, total_amount: q.total_amount, created_by: user?.id,
    }).select('id').single()
    if (newQ && items && items.length > 0) {
      await supabase.from('quotation_items').insert(items.map(it => ({
        quotation_id: newQ.id, item_type: it.item_type, description: it.description,
        qty: it.qty, unit_price: it.unit_price, sort_order: it.sort_order,
      })))
    }
    toast.success('Quote duplicated')
    fetchQuotes()
  }

  async function convertToBooking(q: QuoteRow) {
    if (!branchId || !tenantId) return
    const today = new Date().toISOString().split('T')[0]
    const { data: b, error } = await supabase.from('bookings').insert({
      tenant_id: tenantId, branch_id: branchId,
      customer_name: q.customer_name, customer_phone: q.customer_phone,
      customer_email: q.customer_email,
      vehicle_plate: q.vehicle_plate,
      service_type: 'Workshop Service',
      scheduled_at: new Date(today + 'T09:00:00').toISOString(),
      arrival_mode: 'drop_off', status: 'confirmed', source: 'staff',
      notes: `Converted from quotation ${q.quote_number}`,
    }).select('id, booking_number').single()
    if (error) { toast.error('Booking failed: ' + error.message); return }
    await supabase.from('quotations').update({ converted_to_booking_id: b!.id, updated_at: new Date().toISOString() }).eq('id', q.id)
    toast.success(`Booking ${b!.booking_number} created from ${q.quote_number}`)
    fetchQuotes()
  }

  async function deleteQuote(id: string) {
    await supabase.from('quotations').delete().eq('id', id)
    toast.success('Quotation deleted')
    fetchQuotes()
  }

  function _whatsappQuote(q: QuoteRow) {
    const num = q.customer_phone.replace(/\D/g, '')
    const wa = num.startsWith('0') ? '6' + num : num
    const msg = encodeURIComponent(
      `Dear ${q.customer_name},\n\nThank you for your enquiry. Please find your quotation below:\n\n` +
      `📋 *Quotation: ${q.quote_number}*\n` +
      `🚗 Vehicle: ${q.vehicle_plate} ${q.vehicle_make} ${q.vehicle_model}\n` +
      `💰 Total: ${formatRM(q.total_amount)}\n` +
      `📅 Valid until: ${q.valid_until ? formatDate(q.valid_until) : 'N/A'}\n\n` +
      (q.notes ? `📝 Notes: ${q.notes}\n\n` : '') +
      `Please confirm your acceptance to proceed with booking.\n\nThank you! 🙏`
    )
    window.open(`https://wa.me/${wa}?text=${msg}`, '_blank')
  }

  const statusCounts = quotes.reduce((acc, q) => { acc[q.status] = (acc[q.status] || 0) + 1; return acc }, {} as Record<string, number>)

  const TABS = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Draft' },
    { key: 'sent', label: 'Sent' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'expired', label: 'Expired' },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <FileText size={22} color={C.orange} />
          <span style={{ fontSize: 20, fontWeight: 800, color: C.text }}>Quotations</span>
          <span style={{ fontSize: 13, color: C.text2, fontWeight: 500 }}>{quotes.length} total</span>
        </div>
        <button
          onClick={() => { setEditQuote(null); setShowDrawer(true) }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, backgroundColor: C.orange, border: 'none', borderRadius: 8, color: '#fff', padding: '10px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          <Plus size={15} /> New Quote
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Status tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          {TABS.map(tab => {
            const count = tab.key === 'all' ? quotes.length : (statusCounts[tab.key] || 0)
            const active = statusFilter === tab.key
            return (
              <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: active ? `1px solid ${C.orange}` : `1px solid ${C.border}`,
                  backgroundColor: active ? C.orange + '22' : 'transparent',
                  color: active ? C.orange : C.text2,
                }}>
                {tab.label}{count > 0 ? ` (${count})` : ''}
              </button>
            )
          })}
        </div>
        {/* Search */}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search size={13} color={C.text2} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            style={{ ...inputStyle, paddingLeft: 30, width: 240 }}
            placeholder="Search quote #, customer, plate…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowX: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
            <div style={{ width: 32, height: 32, border: '3px solid #2A2A2A', borderTopColor: C.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ) : quotes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: C.text2 }}>
            <FileText size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: 15 }}>No quotations found</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Click "+ New Quote" to create one</div>
          </div>
        ) : (
          <div style={{ backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr 100px 110px 80px 48px', padding: '10px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.surface2 }}>
              {['Quote #', 'Customer', 'Vehicle', 'Total', 'Valid Until', 'Status', ''].map(h => (
                <span key={h} style={{ color: C.text2, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
              ))}
            </div>
            {/* Rows */}
            {quotes.map((q, idx) => (
              <div key={q.id}
                style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr 100px 110px 80px 48px', padding: '12px 16px', borderBottom: idx < quotes.length - 1 ? `1px solid ${C.border}` : 'none', alignItems: 'center', cursor: 'pointer' }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = C.surface2 }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent' }}
                onClick={() => { setEditQuote(q); setShowDrawer(true) }}>
                <span style={{ color: C.orange, fontWeight: 700, fontSize: 13 }}>{q.quote_number}</span>
                <div>
                  <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{q.customer_name}</div>
                  <div style={{ color: C.text2, fontSize: 12 }}>{q.customer_phone}</div>
                </div>
                <div>
                  <div style={{ color: C.text, fontSize: 13, fontWeight: 600, letterSpacing: 0.5 }}>{q.vehicle_plate}</div>
                  <div style={{ color: C.text2, fontSize: 12 }}>{[q.vehicle_year, q.vehicle_make, q.vehicle_model].filter(Boolean).join(' ')}</div>
                </div>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{formatRM(q.total_amount)}</span>
                <span style={{ color: q.valid_until && new Date(q.valid_until) < new Date() ? C.red : C.text2, fontSize: 12 }}>
                  {q.valid_until ? formatDate(q.valid_until) : '—'}
                </span>
                <span style={{
                  display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                  background: (STATUS_COLOR[q.status] || C.text2) + '22',
                  color: STATUS_COLOR[q.status] || C.text2,
                  border: `1px solid ${(STATUS_COLOR[q.status] || C.text2)}44`,
                  textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
                }}>{STATUS_LABEL[q.status] || q.status}</span>
                <div onClick={e => e.stopPropagation()}>
                  <ActionsMenu
                    quote={q}
                    onView={() => { setEditQuote(q); setShowDrawer(true) }}
                    onDuplicate={() => duplicateQuote(q)}
                    onMarkSent={() => updateStatus(q.id, 'sent')}
                    onMarkAccepted={() => updateStatus(q.id, 'accepted')}
                    onMarkRejected={() => updateStatus(q.id, 'rejected')}
                    onConvert={() => convertToBooking(q)}
                    onDelete={() => deleteQuote(q.id)}
                    onPrint={() => openPrintView(q)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quote Drawer */}
      {showDrawer && (
        <QuoteDrawer
          branchId={branchId}
          tenantId={tenantId}
          userId={user?.id ?? null}
          editQuote={editQuote}
          onClose={() => { setShowDrawer(false); setEditQuote(null) }}
          onSaved={() => { setShowDrawer(false); setEditQuote(null); fetchQuotes() }}
        />
      )}

      {/* ── PRINT VIEW ──────────────────────────────────────────────────────── */}
      {showPrintView && printQuote && (
        <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 9999, overflowY: 'auto' }}>
          <link rel="stylesheet" href="https://fonts.cdnfonts.com/css/cocogoose" />
          <style>{`
            @media print { .no-print { display: none !important } body { margin: 0 } }
            @page { size: A4; margin: 15mm }
          `}</style>

          {/* Toolbar */}
          <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', background: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
            <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Quotation — {printQuote.quote_number}</span>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowPrintView(false)} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Close</button>
              <button onClick={() => window.print()} style={{ background: '#F15A22', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Printer size={14} /> Print / Save PDF
              </button>
            </div>
          </div>

          {/* A4 body */}
          <div style={{ maxWidth: 794, margin: '24px auto', padding: '32px 40px', background: '#fff', fontFamily: "'Tw Cen MT', 'Century Gothic', sans-serif", color: '#111', fontSize: 12 }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, borderBottom: '2px solid #F15A22', paddingBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {branchInfo?.logo_url && (
                  <img src={branchInfo.logo_url} alt="Logo" style={{ width: 120, height: 120, objectFit: 'contain', flexShrink: 0 }} />
                )}
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#F15A22', letterSpacing: 1, fontFamily: "'Cocogoose', sans-serif", textTransform: 'uppercase' }}>{branchInfo?.name ?? 'MOTOVERSE GARAGE'}</div>
                  {branchInfo?.address && <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{branchInfo.address}</div>}
                  {(branchInfo?.phone || branchInfo?.email) && (
                    <div style={{ fontSize: 12, color: '#555' }}>
                      {[branchInfo?.phone && `Tel: ${branchInfo.phone}`, branchInfo?.email].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3, marginBottom: 4 }}>QUOTATION</div>
                <div style={{ fontSize: 12, color: '#555' }}>No: <span style={{ fontWeight: 700, color: '#111', fontFamily: 'monospace' }}>{printQuote.quote_number}</span></div>
                <div style={{ fontSize: 12, color: '#555' }}>Date: {new Date(printQuote.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                <div style={{ fontSize: 12, color: '#555' }}>Valid Until: <span style={{ fontWeight: 700 }}>{printQuote.valid_until ? new Date(printQuote.valid_until).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span></div>
                <div style={{ marginTop: 6, display: 'inline-block', padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', background: printQuote.status === 'accepted' ? '#dcfce7' : printQuote.status === 'rejected' ? '#fee2e2' : '#fef9c3', color: printQuote.status === 'accepted' ? '#166534' : printQuote.status === 'rejected' ? '#991b1b' : '#854d0e' }}>{printQuote.status.toUpperCase()}</div>
              </div>
            </div>

            {/* Customer / Vehicle */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, marginBottom: 12, border: '1px solid #ccc' }}>
              <div style={{ padding: '8px 12px', borderRight: '1px solid #ccc' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Customer</div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{printQuote.customer_name || '—'}</div>
                {printQuote.customer_phone && <div style={{ fontSize: 12, color: '#444' }}>{printQuote.customer_phone}</div>}
                {printQuote.customer_email && <div style={{ fontSize: 12, color: '#444' }}>{printQuote.customer_email}</div>}
              </div>
              <div style={{ padding: '8px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Vehicle</div>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                  <tbody>
                    <tr>
                      <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2, whiteSpace: 'nowrap' }}>Plate No.</td>
                      <td style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 13 }}>{printQuote.vehicle_plate}</td>
                    </tr>
                    {(printQuote.vehicle_make || printQuote.vehicle_model) && (
                      <tr>
                        <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2, whiteSpace: 'nowrap' }}>Make / Model</td>
                        <td style={{ fontWeight: 600 }}>{[printQuote.vehicle_make, printQuote.vehicle_model].filter(Boolean).join(' ')}</td>
                      </tr>
                    )}
                    {printQuote.vehicle_year && (
                      <tr>
                        <td style={{ color: '#666', paddingRight: 8, whiteSpace: 'nowrap' }}>Year</td>
                        <td>{printQuote.vehicle_year}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Line Items */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
              <thead>
                <tr style={{ background: '#F15A22', color: '#fff' }}>
                  <th style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, fontWeight: 700, width: 32 }}>NO</th>
                  <th style={{ padding: '7px 10px', textAlign: 'left', fontSize: 12, fontWeight: 700, width: 80 }}>TYPE</th>
                  <th style={{ padding: '7px 10px', textAlign: 'left', fontSize: 12, fontWeight: 700 }}>DESCRIPTION</th>
                  <th style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, fontWeight: 700, width: 46 }}>QTY</th>
                  <th style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12, fontWeight: 700, width: 90 }}>UNIT PRICE</th>
                  <th style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12, fontWeight: 700, width: 90 }}>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {printItems.filter(it => it.description.trim()).map((item, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e8e8e8', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, color: '#666' }}>{i + 1}</td>
                    <td style={{ padding: '7px 10px', fontSize: 12, color: '#888', textTransform: 'capitalize' }}>{item.item_type}</td>
                    <td style={{ padding: '7px 10px', fontSize: 12 }}>{item.description}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12 }}>{item.qty}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12 }}>{item.unit_price.toFixed(2)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{(item.qty * item.unit_price).toFixed(2)}</td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 5 - printItems.filter(it => it.description.trim()).length) }).map((_, i) => (
                  <tr key={`blank-${i}`} style={{ borderBottom: '1px solid #e8e8e8' }}>
                    <td style={{ padding: '7px 10px' }}>&nbsp;</td>
                    <td /><td /><td /><td /><td />
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <table style={{ borderCollapse: 'collapse', width: 260, border: '1px solid #ccc' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                    <td style={{ padding: '5px 12px', fontSize: 12, color: '#555' }}>SUBTOTAL ({printItems.filter(it => it.description.trim()).length} items)</td>
                    <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>
                      {printItems.reduce((s, it) => s + it.qty * it.unit_price, 0).toFixed(2)}
                    </td>
                  </tr>
                  <tr style={{ background: '#F15A22', color: '#fff' }}>
                    <td style={{ padding: '7px 12px', fontSize: 13, fontWeight: 800 }}>TOTAL (RM)</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 14, fontWeight: 800 }}>{(printQuote.total_amount ?? 0).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Notes */}
            {printQuote.notes && (
              <div style={{ border: '1px solid #ccc', borderRadius: 4, padding: '8px 12px', marginBottom: 16, background: '#fafafa' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Notes</div>
                <div style={{ fontSize: 12, color: '#444' }}>{printQuote.notes}</div>
              </div>
            )}

            {/* Signature */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div style={{ border: '1px solid #ccc', borderRadius: 4, padding: '10px 12px', background: '#fafafa' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Terms</div>
                <div style={{ fontSize: 12, color: '#555' }}>This quotation is valid for <strong>{printQuote.validity_days} day{printQuote.validity_days !== 1 ? 's' : ''}</strong> from the date of issue.</div>
                <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>Prices are subject to change without prior notice after the validity period.</div>
              </div>
              <div style={{ border: '1px solid #ccc', borderRadius: 4, padding: '10px 12px', minHeight: 70, background: '#fafafa' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Authorised Signature</div>
                <div style={{ marginTop: 28, borderTop: '1px solid #999', fontSize: 12, color: '#888', paddingTop: 4 }}>{branchInfo?.name ?? 'Authorised Signatory'}</div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ textAlign: 'center', fontSize: 12, color: '#aaa', borderTop: '1px solid #eee', paddingTop: 8, marginBottom: 8 }}>
              Thank you for your enquiry! · This quotation is computer-generated and does not require a physical signature.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 6, borderTop: '1px solid #f0f0f0' }}>
              <span style={{ fontSize: 12, color: '#bbb' }}>Powered by:</span>
              <span style={{ fontSize: 12, color: '#aaa', fontWeight: 600 }}>EZ Garage</span>
              <span style={{ fontSize: 12, color: '#ccc' }}>·</span>
              <span style={{ fontSize: 12, color: '#aaa' }}>http://ezgarage.app</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
