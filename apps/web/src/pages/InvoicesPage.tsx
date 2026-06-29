import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { FileText, Plus, X, Printer, CreditCard, Check, ChevronRight, Search, Send, Ban, Wrench, Edit2, Eye, EyeOff } from 'lucide-react'
import { toast } from '@/components/ui/Toast'

// ─── Interfaces ────────────────────────────────────────────────────────────────

interface LineItem {
  item_type: 'part' | 'labour' | 'custom'
  description: string
  qty: number
  uom: string
  unit_price: number
  cost_price?: number   // purchasing cost — used for COGS in reports
  discount_pct?: number
  amount: number
}

interface Invoice {
  id: string
  branch_id: string
  tenant_id?: string
  job_id: string | null
  invoice_number: string
  customer_id: string | null
  customer_name: string
  customer_phone: string
  customer_email: string
  vehicle_plate: string
  vehicle_info: string
  vehicle_mileage: string
  opened_by: string
  issue_date: string
  due_date: string
  status: 'draft' | 'sent' | 'paid' | 'void' | 'overdue'
  line_items: LineItem[]
  subtotal: number
  discount_pct: number
  discount_amount: number
  tax_pct: number
  tax_amount: number
  total_amount: number
  amount_paid: number
  balance_due: number
  payment_method: string
  payment_date: string
  payment_reference: string
  notes: string
  created_by: string
  created_at: string
  updated_at: string
}

interface Job {
  id: string
  job_number: string
  status: string
  service_type: string
  estimated_cost: number
  final_amount: number
  customer_id: string
  vehicle_id: string
  branch_id: string
  invoice_id: string | null
  customers: { full_name: string; phone: string; email: string } | null
  vehicles: { plate_number: string; make: string; model: string; year: number; vehicle_type?: string; mileage?: number } | null
}

interface LabourCharge {
  id: string
  tenant_id?: string
  branch_id?: string
  labour_code: string
  name: string
  description: string
  category: string
  unit_price: number
  unit: string
  standard_duration: number | null  // minutes
  required_skill_level: string
  bay_required: string
  taxable: boolean
  division: 'car' | 'bike' | 'both'
  is_active: boolean
  created_at: string
}

interface CataloguePart {
  id: string
  name: string
  part_number?: string | null
  category?: string | null
  division: 'car' | 'bike' | 'both'
  unit: string
  selling_price?: number | null
  cost_price?: number | null
  stock_qty: number
}

interface InstalledPart {
  id: string
  part_name: string
  part_number: string
  quantity: number
  ordered_qty: number | null
  selling_price: number | null
  cost_price?: number | null
}

// ─── Theme ─────────────────────────────────────────────────────────────────────

const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  orange: '#F15A22',
  text: '#F0F0F0',
  text2: '#A0A0A0',
  green: '#22C55E',
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatRM(n: number | null | undefined): string {
  return 'RM ' + (n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatDate(s: string): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function futureDateStr(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function statusColor(status: string): string {
  switch (status) {
    case 'draft': return '#555'
    case 'sent': return '#1E6BB8'
    case 'issued': return '#1E6BB8'
    case 'paid': return '#1E7B4B'
    case 'void': return '#8B1E1E'
    case 'overdue': return C.orange
    default: return '#555'
  }
}

// Number to words for Malaysian invoice
const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']

function numToWords(n: number): string {
  if (n === 0) return 'ZERO'
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' AND ' + numToWords(n % 100) : '')
  if (n < 1000000) return numToWords(Math.floor(n / 1000)) + ' THOUSAND' + (n % 1000 ? ' ' + numToWords(n % 1000) : '')
  return numToWords(Math.floor(n / 1000000)) + ' MILLION' + (n % 1000000 ? ' ' + numToWords(n % 1000000) : '')
}

function amountInWords(amount: number): string {
  const ringgit = Math.floor(amount)
  const sen = Math.round((amount - ringgit) * 100)
  let words = numToWords(ringgit) + ' RINGGIT'
  if (sen > 0) words += ' AND ' + numToWords(sen) + ' SEN'
  return words + ' ONLY'
}

// ─── Print helpers (open in new tab via blob URL, no routing needed) ──────────

type BranchPrintInfo = { name: string; address: string | null; phone: string | null; email: string | null; logo_url: string | null; bank_name: string | null; bank_account_number: string | null; bank_account_name: string | null }

function buildInvoiceHtml(inv: Invoice, branch: BranchPrintInfo | null): string {
  const fd = (s: string) => { if (!s) return ''; const d = new Date(s); return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  const rows = inv.line_items.map((item, i) => `
    <tr style="border-bottom:1px solid #e8e8e8;background:${i%2===0?'#fff':'#fafafa'}">
      <td style="padding:7px 10px;text-align:center;font-size:12px;color:#666">${i+1}</td>
      <td style="padding:7px 10px;font-size:12px">${item.description}</td>
      <td style="padding:7px 10px;text-align:center;font-size:12px">${item.qty}</td>
      <td style="padding:7px 10px;text-align:center;font-size:12px;color:#666">${item.uom||'unit'}</td>
      <td style="padding:7px 10px;text-align:right;font-size:12px">${item.unit_price.toFixed(2)}</td>
      <td style="padding:7px 10px;text-align:right;font-size:12px;font-weight:600">${item.amount.toFixed(2)}</td>
    </tr>`).join('')
  const blanks = Array.from({length:Math.max(0,5-inv.line_items.length)}).map((_,i)=>`<tr key="b${i}" style="border-bottom:1px solid #e8e8e8"><td style="padding:7px 10px">&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')
  const logoHtml = branch?.logo_url ? `<img src="${branch.logo_url}" alt="Logo" style="width:144px;height:144px;object-fit:contain;flex-shrink:0"/>` : ''
  const bankHtml = (branch?.bank_name || branch?.bank_account_number || branch?.bank_account_name)
    ? `${branch.bank_name?`<div style="font-size:12px"><strong>${branch.bank_name}</strong></div>`:''}${branch.bank_account_number?`<div style="font-size:12px;font-family:monospace;font-weight:700">${branch.bank_account_number}</div>`:''}${branch.bank_account_name?`<div style="font-size:12px;color:#666;margin-top:2px">${branch.bank_account_name}</div>`:''}`
    : `<div style="font-size:12px;color:#aaa;font-style:italic">No bank details set</div>`
  const paidStamp = inv.status==='paid' ? `<div style="position:absolute;top:12px;right:12px;border:3px solid #1a7b4b;border-radius:6px;padding:4px 12px;color:#1a7b4b;font-weight:900;font-size:18px;letter-spacing:2px;transform:rotate(-8deg);opacity:0.8">PAID</div>` : ''
  const branchContact = [branch?.phone&&`Tel: ${branch.phone}`, branch?.email].filter(Boolean).join(' · ')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${inv.invoice_number}</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:'Tw Cen MT','Century Gothic',sans-serif;color:#111;font-size:12px}@media print{.no-print{display:none!important}body{margin:0}}@page{size:A4;margin:15mm}</style>
</head><body>
<div class="no-print" style="display:flex;justify-content:flex-end;gap:10px;padding:12px 24px;background:#f5f5f5;border-bottom:1px solid #ddd">
  <button onclick="window.close()" style="background:#fff;border:1px solid #ccc;border-radius:6px;padding:7px 16px;font-size:13px;cursor:pointer">Close</button>
  <button onclick="window.print()" style="background:#F15A22;color:#fff;border:none;border-radius:6px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer">Print / Save PDF</button>
</div>
<div style="max-width:794px;margin:24px auto;padding:32px 40px;background:#fff">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;border-bottom:2px solid #F15A22;padding-bottom:12px">
    <div style="display:flex;align-items:center;gap:16px">${logoHtml}<div>
      <div style="font-size:22px;font-weight:700;color:#F15A22;letter-spacing:1px;text-transform:uppercase">${branch?.name??'MOTOVERSE GARAGE'}</div>
      ${branch?.address?`<div style="font-size:12px;color:#555;margin-top:2px">${branch.address}</div>`:''}
      ${branchContact?`<div style="font-size:12px;color:#555">${branchContact}</div>`:''}
    </div></div>
    <div style="text-align:right">
      <div style="font-size:22px;font-weight:800;letter-spacing:3px;margin-bottom:4px">INVOICE</div>
      <div style="font-size:12px;color:#555">No: <span style="font-weight:700;color:#111;font-family:monospace">${inv.invoice_number}</span></div>
      <div style="font-size:12px;color:#555">Date: ${fd(inv.issue_date)}</div>
      ${inv.opened_by?`<div style="font-size:12px;color:#555">Opened By: ${inv.opened_by}</div>`:''}
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;margin-bottom:12px;border:1px solid #ccc">
    <div style="padding:8px 12px;border-right:1px solid #ccc">
      <div style="font-size:12px;font-weight:700;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px">Customer</div>
      <div style="font-weight:700;font-size:13px;margin-bottom:2px">${inv.customer_name||'—'}</div>
      <div style="font-size:12px;color:#444">${inv.customer_phone}</div>
      <div style="font-size:12px;color:#444">${inv.customer_email}</div>
    </div>
    <div style="padding:8px 12px">
      <div style="font-size:12px;font-weight:700;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px">Vehicle</div>
      <table style="border-collapse:collapse;font-size:12px;width:100%"><tbody>
        <tr><td style="color:#666;padding-right:8px;padding-bottom:2px;white-space:nowrap">Plate No.</td><td style="font-weight:700;font-family:monospace">${inv.vehicle_plate}</td></tr>
        <tr><td style="color:#666;padding-right:8px;padding-bottom:2px;white-space:nowrap">Manufacturer / Model</td><td style="font-weight:600">${inv.vehicle_info}</td></tr>
        ${inv.vehicle_mileage?`<tr><td style="color:#666;padding-right:8px;white-space:nowrap">Mileage</td><td>${inv.vehicle_mileage} km</td></tr>`:''}
      </tbody></table>
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
    <thead><tr style="background:#F15A22;color:#fff">
      <th style="padding:7px 10px;text-align:center;font-size:12px;width:36px">NO</th>
      <th style="padding:7px 10px;text-align:left;font-size:12px">ITEM</th>
      <th style="padding:7px 10px;text-align:center;font-size:12px;width:50px">QTY</th>
      <th style="padding:7px 10px;text-align:center;font-size:12px;width:50px">UOM</th>
      <th style="padding:7px 10px;text-align:right;font-size:12px;width:90px">UNIT PRICE</th>
      <th style="padding:7px 10px;text-align:right;font-size:12px;width:90px">AMOUNT</th>
    </tr></thead>
    <tbody>${rows}${blanks}</tbody>
  </table>
  <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
    <table style="border-collapse:collapse;width:280px;border:1px solid #ccc"><tbody>
      <tr style="border-bottom:1px solid #e0e0e0"><td style="padding:5px 12px;font-size:12px;color:#555">TOTAL ITEM (${inv.line_items.length})</td><td style="padding:5px 12px;text-align:right;font-size:12px;font-weight:600">${inv.subtotal?.toFixed(2)}</td></tr>
      <tr style="border-bottom:1px solid #e0e0e0"><td style="padding:5px 12px;font-size:12px;color:#555">EXTRA DISCOUNT</td><td style="padding:5px 12px;text-align:right;font-size:12px">${(inv.discount_amount??0).toFixed(2)}</td></tr>
      <tr style="border-bottom:1px solid #e0e0e0"><td style="padding:5px 12px;font-size:12px;color:#555">BEF. ROUNDING</td><td style="padding:5px 12px;text-align:right;font-size:12px">${((inv.subtotal??0)-(inv.discount_amount??0)).toFixed(2)}</td></tr>
      <tr style="border-bottom:1px solid #e0e0e0"><td style="padding:5px 12px;font-size:12px;color:#555">ROUNDING</td><td style="padding:5px 12px;text-align:right;font-size:12px">0.00</td></tr>
      <tr style="background:#F15A22;color:#fff"><td style="padding:7px 12px;font-size:13px;font-weight:800">TOTAL</td><td style="padding:7px 12px;text-align:right;font-size:14px;font-weight:800">RM ${inv.total_amount?.toFixed(2)}</td></tr>
      <tr style="border-bottom:1px solid #e0e0e0"><td style="padding:5px 12px;font-size:12px;color:#555">PAID (${inv.payment_method?inv.payment_method.replace('_',' ').toUpperCase():'—'})</td><td style="padding:5px 12px;text-align:right;font-size:12px">${(inv.amount_paid??0).toFixed(2)}</td></tr>
      <tr><td style="padding:5px 12px;font-size:12px;font-weight:700">DUE</td><td style="padding:5px 12px;text-align:right;font-size:13px;font-weight:700;color:${(inv.balance_due??0)>0?'#c0392b':'#1a7b4b'}">RM ${(inv.balance_due??0).toFixed(2)}</td></tr>
    </tbody></table>
  </div>
  <div style="border:1px solid #ccc;border-radius:4px;padding:8px 12px;margin-bottom:12px;background:#fafafa">
    <span style="font-size:12px;color:#888;margin-right:6px">Amount in words:</span>
    <span style="font-size:12px;font-weight:700;text-transform:uppercase">RINGGIT MALAYSIA ${amountInWords(inv.total_amount??0)}</span>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div style="border:1px solid #ccc;border-radius:4px;padding:10px 12px;background:#fafafa">
      <div style="font-size:12px;font-weight:700;color:#888;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Bank Details</div>${bankHtml}
    </div>
    <div style="border:1px solid #ccc;border-radius:4px;padding:10px 12px;min-height:70px;background:#fafafa;position:relative">
      <div style="font-size:12px;font-weight:700;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px">Authorised Signature</div>
      ${paidStamp}
      <div style="margin-top:28px;border-top:1px solid #999;font-size:12px;color:#888;padding-top:4px">${branch?.name??'Authorised Signatory'}</div>
    </div>
  </div>
  <div style="text-align:center;font-size:12px;color:#aaa;border-top:1px solid #eee;padding-top:8px;margin-bottom:12px">Thank you for your business! · This is a computer-generated invoice.</div>
  <div style="display:flex;align-items:center;justify-content:center;gap:6px;padding-top:8px;border-top:1px solid #f0f0f0">
    <span style="font-size:12px;color:#bbb">Powered by:</span><span style="font-size:12px;color:#aaa;font-weight:600">EZ Garage</span><span style="font-size:12px;color:#ccc">·</span><span style="font-size:12px;color:#aaa">http://ezgarage.app</span>
  </div>
</div></body></html>`
}

function buildReceiptHtml(inv: Invoice, branch: BranchPrintInfo | null): string {
  const fd = (s: string) => { if (!s) return ''; const d = new Date(s); return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  const logoHtml = branch?.logo_url ? `<img src="${branch.logo_url}" alt="Logo" style="height:56px;object-fit:contain;margin-bottom:6px"/>` : ''
  const branchContact = [branch?.phone&&`Tel: ${branch.phone}`, branch?.email].filter(Boolean).join(' · ')
  const discountRows = (inv.discount_amount??0)>0 ? `
    <tr style="border-bottom:1px solid #f0f0f0"><td style="padding:8px 14px;font-size:12px;color:#555">Subtotal</td><td style="padding:8px 14px;text-align:right;font-size:12px">RM ${(inv.subtotal??0).toFixed(2)}</td></tr>
    <tr style="border-bottom:1px solid #f0f0f0"><td style="padding:8px 14px;font-size:12px;color:#555">Discount</td><td style="padding:8px 14px;text-align:right;font-size:12px;color:#e05">- RM ${(inv.discount_amount??0).toFixed(2)}</td></tr>` : ''
  const payDate = inv.payment_date ? new Date(inv.payment_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : fd(inv.issue_date)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${inv.invoice_number}</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:'Tw Cen MT','Century Gothic',sans-serif;color:#111;font-size:12px}@media print{.no-print{display:none!important}body{margin:0}}@page{size:A5;margin:12mm}</style>
</head><body>
<div class="no-print" style="display:flex;align-items:center;justify-content:space-between;padding:10px 24px;background:#f5f5f5;border-bottom:1px solid #ddd">
  <span style="font-size:13px;color:#555;font-weight:600">Receipt — ${inv.invoice_number}</span>
  <div style="display:flex;gap:10px">
    <button onclick="window.close()" style="background:#fff;border:1px solid #ccc;border-radius:6px;padding:7px 16px;font-size:13px;cursor:pointer">Close</button>
    <button onclick="window.print()" style="background:#F15A22;color:#fff;border:none;border-radius:6px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer">Print / Save PDF</button>
  </div>
</div>
<div style="max-width:560px;margin:24px auto;padding:28px 32px;background:#fff">
  <div style="text-align:center;border-bottom:2px solid #F15A22;padding-bottom:12px;margin-bottom:14px">
    ${logoHtml}
    <div style="font-size:20px;font-weight:700;color:#F15A22;letter-spacing:1px;text-transform:uppercase">${branch?.name??'MOTOVERSE GARAGE'}</div>
    ${branch?.address?`<div style="font-size:11px;color:#666;margin-top:2px">${branch.address}</div>`:''}
    ${branchContact?`<div style="font-size:11px;color:#666">${branchContact}</div>`:''}
    <div style="margin-top:10px;font-size:18px;font-weight:900;letter-spacing:4px;color:#111">RECEIPT</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:14px;font-size:12px">
    <div><span style="color:#888">Receipt No:</span> <strong style="font-family:monospace">${inv.invoice_number}</strong></div>
    <div style="text-align:right"><span style="color:#888">Date:</span> <strong>${payDate}</strong></div>
    <div><span style="color:#888">Customer:</span> <strong>${inv.customer_name}</strong></div>
    <div style="text-align:right"><span style="color:#888">Vehicle:</span> <strong style="font-family:monospace">${inv.vehicle_plate}</strong></div>
  </div>
  <div style="border:1px solid #eee;border-radius:8px;overflow:hidden;margin-bottom:14px">
    <div style="background:#F15A22;color:#fff;padding:7px 14px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Payment Summary</div>
    <table style="width:100%;border-collapse:collapse"><tbody>
      <tr style="border-bottom:1px solid #f0f0f0"><td style="padding:8px 14px;font-size:12px;color:#555">Invoice Reference</td><td style="padding:8px 14px;text-align:right;font-size:12px;font-family:monospace;font-weight:700">${inv.invoice_number}</td></tr>
      ${discountRows}
      <tr style="background:#fafafa"><td style="padding:10px 14px;font-size:13px;font-weight:800">Total Amount</td><td style="padding:10px 14px;text-align:right;font-size:15px;font-weight:800">RM ${(inv.total_amount??0).toFixed(2)}</td></tr>
    </tbody></table>
  </div>
  <div style="border:2px solid #1a7b4b;border-radius:8px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;background:#f0fff6;position:relative">
    <div>
      <div style="font-size:11px;color:#666;margin-bottom:2px;text-transform:uppercase;letter-spacing:1px">Payment Received</div>
      <div style="font-size:15px;font-weight:800;color:#111">RM ${(inv.amount_paid??0).toFixed(2)}</div>
      <div style="font-size:12px;color:#555;margin-top:2px">${inv.payment_method?inv.payment_method.replace('_',' ').toUpperCase():'CASH'}${inv.payment_reference?` · Ref: ${inv.payment_reference}`:''}</div>
    </div>
    <div style="font-size:28px;font-weight:900;color:#1a7b4b;border:3px solid #1a7b4b;border-radius:6px;padding:4px 14px;letter-spacing:3px;transform:rotate(-8deg);opacity:0.85">PAID</div>
  </div>
  <div style="text-align:center;font-size:12px;color:#aaa;border-top:1px solid #eee;padding-top:8px;margin-bottom:6px">Thank you for your payment! Please keep this receipt for your records.</div>
  <div style="display:flex;align-items:center;justify-content:center;gap:6px">
    <span style="font-size:11px;color:#ccc">Powered by:</span><span style="font-size:11px;color:#bbb;font-weight:600">EZ Garage</span><span style="font-size:11px;color:#ccc">·</span><span style="font-size:11px;color:#bbb">http://ezgarage.app</span>
  </div>
</div></body></html>`
}

function openPrintTab(html: string) {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const tab = window.open(url, '_blank')
  if (!tab) {
    // fallback: same tab (popup was blocked)
    window.location.href = url
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

function recalcTotals(inv: Partial<Invoice>, sstRate = 0): Partial<Invoice> {
  const items = (inv.line_items ?? []).filter(i => i.item_type !== 'custom' || true)
  const subtotal = items.reduce((s, i) => s + (i.amount ?? 0), 0)
  const discount_amount = inv.discount_amount ?? 0
  const taxable = Math.max(0, subtotal - discount_amount)
  const tax_amount = sstRate > 0 ? parseFloat((taxable * sstRate / 100).toFixed(2)) : 0
  const total_amount = Math.max(0, taxable + tax_amount)
  const amount_paid = inv.amount_paid ?? 0
  const balance_due = total_amount - amount_paid
  return { ...inv, subtotal, tax_amount, total_amount, balance_due }
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{ background: statusColor(status), color: '#fff', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase' as const, letterSpacing: 1 }}>
      {status}
    </span>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

const INV_PAGE_SIZE = 50

export function InvoicesPage() {
  const { user } = useAuthStore()
  const location = useLocation()

  // Tab — auto-select labour_charges if ?tab=labour in URL
  const [mainTab, setMainTab] = useState<'invoices' | 'labour_charges'>(() =>
    new URLSearchParams(location.search).get('tab') === 'labour' ? 'labour_charges' : 'invoices'
  )

  // SST rate from tenant settings
  const [sstRate, setSstRate] = useState(0)
  useEffect(() => {
    if (!user?.tenant_id) return
    supabase.from('tenants').select('sst_rate').eq('id', user.tenant_id).single()
      .then(({ data }) => { if (data?.sst_rate != null) setSstRate(Number(data.sst_rate)) })
  }, [user?.tenant_id])

  // Branch info (for invoice header)
  const [branchInfo, setBranchInfo] = useState<{ name: string; address: string | null; phone: string | null; email: string | null; logo_url: string | null; bank_name: string | null; bank_account_number: string | null; bank_account_name: string | null } | null>(null)
  useEffect(() => {
    if (!user?.branch_id) return
    supabase.from('branches').select('name,address,phone,email,logo_url,bank_name,bank_account_number,bank_account_name').eq('id', user.branch_id).single()
      .then(({ data }) => { if (data) setBranchInfo(data as any) })
  }, [user?.branch_id])

  // Invoice list
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [invPage, setInvPage] = useState(0)
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [saving, setSaving] = useState(false)

  // Modals
  const [showNewModal, setShowNewModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)

  const [showLabourPicker, setShowLabourPicker] = useState(false)
  const [labourPickerSearch, setLabourPickerSearch] = useState('')
  const [pickerVehicleType, setPickerVehicleType] = useState<string | null>(null)
  const [showLabourChargeModal, setShowLabourChargeModal] = useState(false)
  const [editingLabourCharge, setEditingLabourCharge] = useState<LabourCharge | null>(null)

  // New Invoice
  const [invoiceError, setInvoiceError] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobSearch, setJobSearch] = useState('')
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [newInvoiceStep, setNewInvoiceStep] = useState<1 | 2>(1)
  const [newInvoiceForm, setNewInvoiceForm] = useState<Partial<Invoice>>({})
  const [newInvoiceItems, setNewInvoiceItems] = useState<LineItem[]>([])
  const [addPartRow, setAddPartRow] = useState<{ description: string; qty: string; unit_price: string } | null>(null)
  const [showPartPicker, setShowPartPicker] = useState(false)
  const [partPickerSearch, setPartPickerSearch] = useState('')
  const [catalogueParts, setCatalogueParts] = useState<CataloguePart[]>([])
  const [_installedParts, setInstalledParts] = useState<InstalledPart[]>([])
  const [loadingParts, setLoadingParts] = useState(false)
  const [autoLoadedCount, setAutoLoadedCount] = useState(0)
  const [jobsLoading, setJobsLoading] = useState(false)

  // Payment
  const [payment, setPayment] = useState({ payment_method: 'cash', amount_paid: 0, payment_date: todayStr(), payment_reference: '' })

  // Labour Charges tab
  const [labourCharges, setLabourCharges] = useState<LabourCharge[]>([])
  const [labourLoading, setLabourLoading] = useState(false)
  const [labourForm, setLabourForm] = useState({
    labour_code: '', name: '', description: '', category: '',
    unit_price: '', unit: 'job', standard_duration: '',
    required_skill_level: '', bay_required: '',
    taxable: false, division: 'both' as 'car' | 'bike' | 'both', is_active: true,
  })
  const [labourSaving, setLabourSaving] = useState(false)

  // ─── Load data ────────────────────────────────────────────────────────────────

  const loadInvoices = useCallback(async () => {
    setLoading(true)
    setInvPage(0)
    let q = supabase.from('invoices').select('*').order('created_at', { ascending: false }).range(0, INV_PAGE_SIZE - 1)
    if (user?.role !== 'super_admin' && user?.branch_id) q = q.eq('branch_id', user.branch_id)
    const { data } = await q
    const rows = (data as Invoice[]) ?? []
    setInvoices(rows)
    setHasMore(rows.length === INV_PAGE_SIZE)
    setLoading(false)
  }, [user])

  async function loadMoreInvoices() {
    if (loadingMore) return
    setLoadingMore(true)
    const nextPage = invPage + 1
    let q = supabase.from('invoices').select('*').order('created_at', { ascending: false }).range(nextPage * INV_PAGE_SIZE, (nextPage + 1) * INV_PAGE_SIZE - 1)
    if (user?.role !== 'super_admin' && user?.branch_id) q = q.eq('branch_id', user.branch_id)
    const { data } = await q
    const rows = (data as Invoice[]) ?? []
    setInvoices(inv => [...inv, ...rows])
    setInvPage(nextPage)
    setHasMore(rows.length === INV_PAGE_SIZE)
    setLoadingMore(false)
  }

  const loadJobs = useCallback(async () => {
    setJobsLoading(true)
    let q = supabase
      .from('jobs')
      .select('*, customers(full_name, phone, email), vehicles(plate_number, make, model, year, vehicle_type)')
      .not('status', 'in', '("cancelled")')
    if (user?.role !== 'super_admin' && user?.branch_id) q = q.eq('branch_id', user.branch_id)
    const { data, error } = await q
    console.log('[loadJobs] data:', data, 'error:', error, 'user branch:', user?.branch_id, 'role:', user?.role)
    setJobs((data as Job[]) ?? [])
    setJobsLoading(false)
  }, [user])

  const loadLabourCharges = useCallback(async () => {
    setLabourLoading(true)
    let q = supabase.from('labour_charges').select('*').order('category').order('name')
    if (user?.role !== 'super_admin' && user?.branch_id)
      q = q.or(`branch_id.is.null,branch_id.eq.${user.branch_id}`)
    const { data } = await q
    setLabourCharges((data as LabourCharge[]) ?? [])
    setLabourLoading(false)
  }, [user])

  const loadCatalogueParts = useCallback(async () => {
    const tenantId = user?.tenant_id
    let q = supabase.from('parts_catalogue').select('id,name,part_number,category,division,unit,selling_price,cost_price,stock_qty').eq('is_active', true).order('name')
    if (tenantId) q = q.eq('tenant_id', tenantId)
    const { data } = await q
    setCatalogueParts((data as CataloguePart[]) ?? [])
  }, [user])

  async function loadInstalledParts(jobId: string) {
    setLoadingParts(true)
    const { data } = await supabase
      .from('parts_requests')
      .select('id, part_name, part_number, quantity, ordered_qty, selling_price, parts_catalogue(selling_price, cost_price)')
      .eq('job_id', jobId)
      .eq('status', 'installed')
    const parts: InstalledPart[] = (data ?? []).map((p: any) => ({
      ...p,
      selling_price: p.selling_price ?? p.parts_catalogue?.selling_price ?? null,
      cost_price: p.parts_catalogue?.cost_price ?? null,
    }))
    setInstalledParts(parts)
    // Auto-populate invoice items from installed parts
    if (parts.length > 0) {
      const autoItems: LineItem[] = parts.map(p => {
        const qty = p.ordered_qty ?? p.quantity
        const unit_price = p.selling_price ?? 0
        return {
          item_type: 'part',
          description: p.part_name + (p.part_number ? ` [${p.part_number}]` : ''),
          qty,
          uom: 'unit',
          cost_price: p.cost_price ?? undefined,
          unit_price,
          discount_pct: 0,
          amount: parseFloat((qty * unit_price).toFixed(2)),
        }
      })
      setNewInvoiceItems(autoItems)
      setAutoLoadedCount(parts.length)
    } else {
      setNewInvoiceItems([])
      setAutoLoadedCount(0)
    }
    setLoadingParts(false)
  }

  useEffect(() => { loadInvoices() }, [loadInvoices])
  useEffect(() => { if (mainTab === 'labour_charges') loadLabourCharges() }, [mainTab, loadLabourCharges])

  useEffect(() => {
    if (selected) setEditInvoice(JSON.parse(JSON.stringify(selected)))
    else setEditInvoice(null)
  }, [selected])

  // ─── Invoice editing ─────────────────────────────────────────────────────────

  function handleLineItemChange(index: number, field: keyof LineItem, value: string | number) {
    if (!editInvoice) return
    const items = editInvoice.line_items.map((item, i) => {
      if (i !== index) return item
      const updated = { ...item, [field]: (field === 'description' || field === 'uom' || field === 'item_type') ? value : Number(value) }
      if (field === 'qty' || field === 'unit_price') updated.amount = updated.qty * updated.unit_price
      return updated
    })
    setEditInvoice(recalcTotals({ ...editInvoice, line_items: items }, sstRate) as Invoice)
  }

  function addCustomItem() {
    if (!editInvoice) return
    const items = [...editInvoice.line_items, { item_type: 'custom' as const, description: '', qty: 1, uom: 'unit', unit_price: 0, amount: 0 }]
    setEditInvoice(recalcTotals({ ...editInvoice, line_items: items }, sstRate) as Invoice)
  }

  function removeLineItem(index: number) {
    if (!editInvoice) return
    const items = editInvoice.line_items.filter((_, i) => i !== index)
    setEditInvoice(recalcTotals({ ...editInvoice, line_items: items }, sstRate) as Invoice)
  }

  function addLabourToInvoice(lc: LabourCharge) {
    if (!editInvoice) return
    const newItem: LineItem = {
      item_type: 'labour',
      description: lc.name + (lc.description ? ' – ' + lc.description : ''),
      qty: 1,
      uom: lc.unit,
      unit_price: lc.unit_price,
      amount: lc.unit_price,
    }
    const items = [...editInvoice.line_items, newItem]
    setEditInvoice(recalcTotals({ ...editInvoice, line_items: items }, sstRate) as Invoice)
    setShowLabourPicker(false)
  }

  // ─── Save / actions ────────────────────────────────────────────────────────────

  async function saveInvoice() {
    if (!editInvoice) return
    setSaving(true)
    const { id, ...rest } = editInvoice
    await supabase.from('invoices').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id)
    await loadInvoices()
    setSaving(false)
  }

  async function issueInvoice() {
    if (!editInvoice) return
    setSaving(true)
    await supabase.from('invoices').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', editInvoice.id)
    await loadInvoices()
    const { data } = await supabase.from('invoices').select('*').eq('id', editInvoice.id).single()
    if (data) setSelected(data as Invoice)
    setSaving(false)
  }

  async function recordPayment() {
    if (!editInvoice) return
    setSaving(true)
    try {
      const balance_due = editInvoice.total_amount - payment.amount_paid
      const status: Invoice['status'] = balance_due <= 0 ? 'paid' : 'sent'
      const { error } = await supabase.from('invoices').update({
        payment_method: payment.payment_method,
        amount_paid: payment.amount_paid,
        payment_date: payment.payment_date,
        payment_reference: payment.payment_reference,
        status,
        updated_at: new Date().toISOString(),
      }).eq('id', editInvoice.id)
      if (error) throw error
      await loadInvoices()
      const { data } = await supabase.from('invoices').select('*').eq('id', editInvoice.id).single()
      if (data) setSelected(data as Invoice)
      setShowPaymentModal(false)
      toast.success(status === 'paid' ? 'Payment recorded — invoice marked as Paid' : 'Partial payment recorded')
    } catch (e: any) {
      toast.error('Payment failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function voidInvoice() {
    if (!editInvoice) return
    if (!window.confirm('Void this invoice? This cannot be undone.')) return
    setSaving(true)
    await supabase.from('invoices').update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', editInvoice.id)
    await loadInvoices()
    const { data } = await supabase.from('invoices').select('*').eq('id', editInvoice.id).single()
    if (data) setSelected(data as Invoice)
    setSaving(false)
  }

  // ─── Create Invoice ────────────────────────────────────────────────────────────

  async function createInvoice() {
    if (!newInvoiceForm.customer_name) { setInvoiceError('Customer name is missing — go back and re-select the job'); return }
    if (!user?.branch_id) { setInvoiceError('No branch assigned to your account'); return }
    setInvoiceError('')
    setSaving(true)
    try {
      const allItems = newInvoiceItems
      const subtotal = allItems.reduce((s, i) => s + i.amount, 0)
      const discount_amount = newInvoiceForm.discount_amount ?? 0
      const total_amount = Math.max(0, subtotal - discount_amount)

      const payload: Record<string, unknown> = {
        ...newInvoiceForm,
        line_items: allItems,
        subtotal,
        discount_amount,
        total_amount,
        amount_paid: 0,
        branch_id: user.branch_id,
        tenant_id: user.tenant_id ?? null,
        created_by: user.id,
        status: 'draft',
      }
      // Remove undefined/null fields that would break typed UUID columns
      delete payload.discount_pct
      delete payload.tax_pct
      delete payload.tax_amount
      delete payload.created_at
      delete payload.updated_at

      const { data: inserted, error: insertErr } = await supabase.from('invoices').insert(payload).select().single()
      if (insertErr) throw insertErr

      if (inserted && newInvoiceForm.job_id) {
        await supabase.from('jobs').update({ invoice_id: (inserted as Invoice).id }).eq('id', newInvoiceForm.job_id)
      }
      await loadInvoices()
      setShowNewModal(false)
      setNewInvoiceStep(1)
      setSelectedJob(null)
      setNewInvoiceForm({})
      setNewInvoiceItems([])
      setJobSearch('')
      if (inserted) setSelected(inserted as Invoice)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err as any)?.message ?? 'Failed to create invoice'
      setInvoiceError(msg)
    } finally {
      setSaving(false)
    }
  }

  // ─── Labour Charges CRUD ──────────────────────────────────────────────────────

  function openAddLabourCharge() {
    setEditingLabourCharge(null)
    setLabourForm({ labour_code: '', name: '', description: '', category: '', unit_price: '', unit: 'job', standard_duration: '', required_skill_level: '', bay_required: '', taxable: false, division: 'both', is_active: true })
    setShowLabourChargeModal(true)
  }

  function openEditLabourCharge(lc: LabourCharge) {
    setEditingLabourCharge(lc)
    setLabourForm({
      labour_code: lc.labour_code ?? '',
      name: lc.name,
      description: lc.description ?? '',
      category: lc.category ?? '',
      unit_price: String(lc.unit_price),
      unit: lc.unit,
      standard_duration: lc.standard_duration != null ? String(lc.standard_duration) : '',
      required_skill_level: lc.required_skill_level ?? '',
      bay_required: lc.bay_required ?? '',
      taxable: lc.taxable ?? false,
      division: lc.division ?? 'both',
      is_active: lc.is_active,
    })
    setShowLabourChargeModal(true)
  }

  async function saveLabourCharge() {
    if (!labourForm.name || !labourForm.unit_price) return
    setLabourSaving(true)
    const payload = {
      labour_code: labourForm.labour_code || null,
      name: labourForm.name,
      description: labourForm.description || null,
      category: labourForm.category || null,
      unit_price: parseFloat(labourForm.unit_price),
      unit: labourForm.unit,
      standard_duration: labourForm.standard_duration ? parseInt(labourForm.standard_duration) : null,
      required_skill_level: labourForm.required_skill_level || null,
      bay_required: labourForm.bay_required || null,
      taxable: labourForm.taxable,
      division: labourForm.division,
      is_active: labourForm.is_active,
      tenant_id: user?.tenant_id,
      branch_id: user?.branch_id,
    }
    if (editingLabourCharge) {
      await supabase.from('labour_charges').update(payload).eq('id', editingLabourCharge.id)
    } else {
      await supabase.from('labour_charges').insert(payload)
    }
    await loadLabourCharges()
    setShowLabourChargeModal(false)
    setLabourSaving(false)
  }

  async function toggleLabourActive(lc: LabourCharge) {
    await supabase.from('labour_charges').update({ is_active: !lc.is_active }).eq('id', lc.id)
    setLabourCharges(prev => prev.map(l => l.id === lc.id ? { ...l, is_active: !l.is_active } : l))
  }

  // ─── Filtered lists ────────────────────────────────────────────────────────────

  const filtered = invoices.filter(inv => {
    const matchSearch = !searchTerm || inv.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) || (inv.customer_name ?? '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchStatus = statusFilter === 'all' || inv.status === statusFilter
    return matchSearch && matchStatus
  })

  const filteredJobs = jobs.filter(j =>
    !jobSearch ||
    j.job_number.toLowerCase().includes(jobSearch.toLowerCase()) ||
    (j.customers?.full_name ?? '').toLowerCase().includes(jobSearch.toLowerCase()) ||
    (j.vehicles?.plate_number ?? '').toLowerCase().includes(jobSearch.toLowerCase())
  )

  // ─── Style constants ─────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '8px 12px', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' }
  const btnOrange: React.CSSProperties = { background: C.orange, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }
  const btnOutline: React.CSSProperties = { background: 'transparent', color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }
  const btnGreen: React.CSSProperties = { background: '#1E7B4B', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }

  // ─── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100vh', background: C.bg, color: C.text, fontFamily: 'Inter, sans-serif', overflow: 'hidden', flexDirection: 'column' }}>

      {/* Top tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
        {(['invoices', 'labour_charges'] as const).map(tab => (
          <button key={tab} onClick={() => setMainTab(tab)} style={{ background: 'none', border: 'none', borderBottom: mainTab === tab ? `2px solid ${C.orange}` : '2px solid transparent', color: mainTab === tab ? C.text : C.text2, padding: '14px 24px', fontSize: 14, fontWeight: mainTab === tab ? 700 : 400, cursor: 'pointer', textTransform: 'capitalize' as const, display: 'flex', alignItems: 'center', gap: 8, marginBottom: -1 }}>
            {tab === 'invoices' ? <><FileText size={15} /> Invoices</> : <><Wrench size={15} /> Labour Charges</>}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── INVOICES TAB ─────────────────────────────────────────────────────── */}
        {mainTab === 'invoices' && (<>

          {/* Left: list */}
          <div style={{ width: 380, minWidth: 380, background: C.surface, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div style={{ padding: '20px 16px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Invoices</h2>
                  <span style={{ background: C.orange, color: '#fff', borderRadius: 10, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{invoices.length}</span>
                </div>
                <button style={btnOrange} onClick={() => { loadJobs(); setShowNewModal(true); setNewInvoiceStep(1); setSelectedJob(null); setNewInvoiceForm({}); setNewInvoiceItems([]); setJobSearch(''); setAddPartRow(null); setShowPartPicker(false) }}>
                  <Plus size={15} /> New Invoice
                </button>
              </div>
              <div style={{ position: 'relative', marginBottom: 12 }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.text2 }} />
                <input style={{ ...inputStyle, paddingLeft: 32 }} placeholder="Search invoice # or customer..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                {['all', 'draft', 'sent', 'paid', 'void'].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)} style={{ flexShrink: 0, background: statusFilter === s ? C.orange : C.bg, color: statusFilter === s ? '#fff' : C.text2, border: `1px solid ${statusFilter === s ? C.orange : C.border}`, borderRadius: 16, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' as const }}>
                    {s === 'all' ? 'All' : s}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 32, textAlign: 'center', color: C.text2 }}>Loading...</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: C.text2 }}>No invoices found</div>
              ) : filtered.map(inv => (
                <div key={inv.id} onClick={() => setSelected(inv)} style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', borderLeft: selected?.id === inv.id ? `3px solid ${C.orange}` : '3px solid transparent', background: selected?.id === inv.id ? '#1E1E1E' : 'transparent' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <span style={{ color: C.orange, fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{inv.invoice_number}</span>
                    <StatusBadge status={inv.status} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{inv.customer_name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: C.text2, fontFamily: 'monospace' }}>{inv.vehicle_plate}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{formatRM(inv.total_amount)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.text2, marginTop: 4 }}>{formatDate(inv.issue_date)}</div>
                </div>
              ))}
              {!loading && hasMore && searchTerm === '' && statusFilter === 'all' && (
                <div style={{ padding: '12px 16px', textAlign: 'center' }}>
                  <button onClick={loadMoreInvoices} disabled={loadingMore} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text2, padding: '6px 20px', cursor: 'pointer', fontSize: 12, opacity: loadingMore ? 0.6 : 1 }}>
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div style={{ flex: 1, overflowY: 'auto', background: C.bg, height: '100%' }}>
            {!selected || !editInvoice ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.text2 }}>
                <FileText size={64} color={C.border} />
                <div style={{ marginTop: 16, fontSize: 16 }}>Select an invoice</div>
              </div>
            ) : (
              <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 26, fontWeight: 700, color: C.orange, marginBottom: 6 }}>{editInvoice.invoice_number}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <StatusBadge status={editInvoice.status} />
                      <span style={{ fontSize: 13, color: C.text2 }}>{formatDate(editInvoice.issue_date)}</span>
                      {editInvoice.opened_by && <span style={{ fontSize: 13, color: C.text2 }}>Opened by: {editInvoice.opened_by}</span>}
                    </div>
                  </div>
                </div>

                {/* Customer + Vehicle */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' as const }}>Customer</div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{editInvoice.customer_name}</div>
                    <div style={{ fontSize: 13, color: C.text2, marginBottom: 2 }}>{editInvoice.customer_phone}</div>
                    <div style={{ fontSize: 13, color: C.text2 }}>{editInvoice.customer_email}</div>
                  </div>
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' as const }}>Vehicle</div>
                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', marginBottom: 4 }}>{editInvoice.vehicle_plate}</div>
                    <div style={{ fontSize: 13, color: C.text2, marginBottom: 2 }}>{editInvoice.vehicle_info}</div>
                    {editInvoice.vehicle_mileage && <div style={{ fontSize: 13, color: C.text2 }}>Mileage: {editInvoice.vehicle_mileage} km</div>}
                  </div>
                </div>

                {/* Line Items */}
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, letterSpacing: 1, textTransform: 'uppercase' as const }}>Line Items</div>
                    {editInvoice.status === 'draft' && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => { loadLabourCharges(); setPickerVehicleType(null); setShowLabourPicker(true) }} style={{ ...btnOutline, fontSize: 12, padding: '5px 10px' }}>
                          <Wrench size={13} /> Add Labour
                        </button>
                        <button onClick={addCustomItem} style={{ ...btnOutline, fontSize: 12, padding: '5px 10px' }}>
                          <Plus size={13} /> Add Item
                        </button>
                      </div>
                    )}
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const }}>Item</th>
                        <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: 11, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 60 }}>Qty</th>
                        <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: 11, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 70 }}>UOM</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: 11, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 110 }}>Unit Price</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: 11, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 110 }}>Amount</th>
                        {editInvoice.status === 'draft' && <th style={{ width: 36 }}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {editInvoice.line_items.map((item, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '6px 8px' }}>
                            {editInvoice.status === 'draft' ? (
                              <input style={{ ...inputStyle, padding: '4px 8px' }} value={item.description} onChange={e => handleLineItemChange(i, 'description', e.target.value)} />
                            ) : <span style={{ fontSize: 13 }}>{item.description}</span>}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            {editInvoice.status === 'draft' ? (
                              <input type="number" style={{ ...inputStyle, padding: '4px 6px', textAlign: 'center' }} value={item.qty} onChange={e => handleLineItemChange(i, 'qty', e.target.value)} />
                            ) : <span style={{ fontSize: 13 }}>{item.qty}</span>}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            {editInvoice.status === 'draft' ? (
                              <input style={{ ...inputStyle, padding: '4px 6px', textAlign: 'center' }} value={item.uom} onChange={e => handleLineItemChange(i, 'uom', e.target.value)} />
                            ) : <span style={{ fontSize: 13, color: C.text2 }}>{item.uom}</span>}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            {editInvoice.status === 'draft' ? (
                              <input type="number" style={{ ...inputStyle, padding: '4px 8px', textAlign: 'right' }} value={item.unit_price} onChange={e => handleLineItemChange(i, 'unit_price', e.target.value)} />
                            ) : <span style={{ fontSize: 13 }}>{formatRM(item.unit_price)}</span>}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{formatRM(item.amount)}</td>
                          {editInvoice.status === 'draft' && (
                            <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                              <button onClick={() => removeLineItem(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E05555', padding: 4 }}><X size={14} /></button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, minWidth: 300 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
                      <span style={{ color: C.text2 }}>Subtotal</span>
                      <span>{formatRM(editInvoice.subtotal)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 14 }}>
                      <span style={{ color: C.text2 }}>Extra Discount (RM)</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {editInvoice.status === 'draft' ? (
                          <input type="number" style={{ ...inputStyle, width: 90, padding: '4px 8px', textAlign: 'right' }} value={editInvoice.discount_amount ?? 0} onChange={e => setEditInvoice(recalcTotals({ ...editInvoice, discount_amount: Number(e.target.value) }, sstRate) as Invoice)} />
                        ) : <span>{formatRM(editInvoice.discount_amount)}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                      <span style={{ color: C.text2 }}>Bef. Rounding</span>
                      <span>{formatRM((editInvoice.subtotal ?? 0) - (editInvoice.discount_amount ?? 0))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 18, fontWeight: 700, color: C.orange }}>
                      <span>TOTAL</span>
                      <span>{formatRM(editInvoice.total_amount)}</span>
                    </div>
                    {editInvoice.amount_paid > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 14 }}>
                        <span style={{ color: C.text2 }}>Paid ({editInvoice.payment_method?.replace('_', ' ').toUpperCase()})</span>
                        <span>{formatRM(editInvoice.amount_paid)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, color: (editInvoice.balance_due ?? 0) > 0 ? C.orange : C.green }}>
                      <span>Due</span>
                      <span>{formatRM(editInvoice.balance_due)}</span>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: C.text2, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Notes</div>
                  {editInvoice.status === 'draft' ? (
                    <textarea rows={2} style={{ ...inputStyle, resize: 'vertical' as const }} value={editInvoice.notes ?? ''} onChange={e => setEditInvoice({ ...editInvoice, notes: e.target.value })} />
                  ) : (
                    <div style={{ fontSize: 14, color: C.text2 }}>{editInvoice.notes || '—'}</div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
                  {editInvoice.status === 'draft' && <>
                    <button style={btnOutline} onClick={saveInvoice} disabled={saving}><Check size={15} /> {saving ? 'Saving...' : 'Save Draft'}</button>
                    <button style={btnOrange} onClick={issueInvoice} disabled={saving}><Send size={15} /> Issue Invoice</button>
                  </>}
                  {(editInvoice.status === 'sent') && (
                    <button style={btnGreen} onClick={() => { setPayment({ payment_method: 'cash', amount_paid: editInvoice.total_amount, payment_date: todayStr(), payment_reference: '' }); setShowPaymentModal(true) }}>
                      <CreditCard size={15} /> Record Payment
                    </button>
                  )}
                  <button style={btnOutline} onClick={() => openPrintTab(buildInvoiceHtml(editInvoice, branchInfo))}><Printer size={15} /> Print Invoice</button>
                  {editInvoice.status === 'paid' && (
                    <button style={btnOutline} onClick={() => openPrintTab(buildReceiptHtml(editInvoice, branchInfo))}><Printer size={15} /> Print Receipt</button>
                  )}
                  {editInvoice.status !== 'void' && editInvoice.status !== 'paid' && (
                    <button onClick={voidInvoice} disabled={saving} style={{ background: '#1A0E0E', border: '1px solid #3D1515', color: '#F87171', borderRadius: 6, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Ban size={15} /> Void
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </>)}

        {/* ── LABOUR CHARGES TAB ────────────────────────────────────────────────── */}
        {mainTab === 'labour_charges' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
            <div style={{ maxWidth: 860, margin: '0 auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Labour Charges</h2>
                  <div style={{ fontSize: 13, color: C.text2, marginTop: 4 }}>Price list for labour — pick these when generating invoices</div>
                </div>
                <button style={btnOrange} onClick={openAddLabourCharge}><Plus size={15} /> Add Labour Charge</button>
              </div>

              {labourLoading ? (
                <div style={{ textAlign: 'center', color: C.text2, padding: 40 }}>Loading...</div>
              ) : labourCharges.length === 0 ? (
                <div style={{ textAlign: 'center', color: C.text2, padding: 60 }}>
                  <Wrench size={48} color={C.border} />
                  <div style={{ marginTop: 12, fontSize: 15 }}>No labour charges yet</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>Add services like "Engine Oil Change", "Tyre Rotation", etc.</div>
                </div>
              ) : (
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.border}`, background: C.bg }}>
                        <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 120 }}>Code</th>
                        <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const }}>Name</th>
                        <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 140 }}>Category</th>
                        <th style={{ textAlign: 'center', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 90 }}>Division</th>
                        <th style={{ textAlign: 'center', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 80 }}>Duration</th>
                        <th style={{ textAlign: 'right', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 110 }}>Charge (RM)</th>
                        <th style={{ textAlign: 'center', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 70 }}>Tax</th>
                        <th style={{ textAlign: 'center', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 70 }}>Active</th>
                        <th style={{ width: 50 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {labourCharges.map(lc => (
                        <tr key={lc.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: lc.is_active ? 1 : 0.45 }}>
                          <td style={{ padding: '12px 16px', fontSize: 12, fontFamily: 'monospace', color: C.text2 }}>{lc.labour_code || '—'}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{lc.name}</div>
                            {lc.description && <div style={{ fontSize: 12, color: C.text2, marginTop: 2 }}>{lc.description}</div>}
                            {lc.required_skill_level && <div style={{ fontSize: 11, color: C.text2 }}>{lc.required_skill_level}{lc.bay_required ? ` · ${lc.bay_required}` : ''}</div>}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: C.text2 }}>{lc.category || '—'}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase' as const, background: lc.division === 'car' ? '#1E3A5F' : lc.division === 'bike' ? '#3A1E1E' : '#2A2A2A', color: lc.division === 'car' ? '#60A5FA' : lc.division === 'bike' ? '#F87171' : C.text2 }}>
                              {lc.division ?? 'both'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'center', color: C.text2 }}>{lc.standard_duration ? `${lc.standard_duration}m` : '—'}</td>
                          <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{formatRM(lc.unit_price)}<div style={{ fontSize: 11, color: C.text2, fontWeight: 400 }}>per {lc.unit}</div></td>
                          <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 12 }}>{lc.taxable ? <span style={{ color: C.orange }}>Yes</span> : <span style={{ color: C.text2 }}>No</span>}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <button onClick={() => toggleLabourActive(lc)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: lc.is_active ? C.green : C.text2 }}>
                              {lc.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                          </td>
                          <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                            <button onClick={() => openEditLabourCharge(lc)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text2 }}><Edit2 size={15} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── GENERATE INVOICE MODAL ────────────────────────────────────────────────── */}
      {showNewModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, width: '92%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{newInvoiceStep === 1 ? 'Select a Job' : 'Build Invoice'}</h3>
                <div style={{ fontSize: 12, color: C.text2, marginTop: 4 }}>Step {newInvoiceStep} of 2{newInvoiceStep === 2 && selectedJob && ` · ${selectedJob.job_number}`}</div>
              </div>
              <button onClick={() => setShowNewModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text2 }}><X size={20} /></button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              {/* STEP 1: Job select */}
              {newInvoiceStep === 1 && (
                <>
                  <div style={{ position: 'relative', marginBottom: 16 }}>
                    <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.text2 }} />
                    <input style={{ ...inputStyle, paddingLeft: 32 }} placeholder="Search job #, customer, plate..." value={jobSearch} onChange={e => setJobSearch(e.target.value)} />
                  </div>
                  {jobsLoading ? (
                    <div style={{ textAlign: 'center', color: C.text2, padding: 40 }}>Loading jobs…</div>
                  ) : filteredJobs.length === 0 ? (
                    <div style={{ textAlign: 'center', color: C.text2, padding: 40, fontSize: 14 }}>
                      No eligible jobs found. {jobSearch ? 'Try clearing the search.' : ''}
                    </div>
                  ) : filteredJobs.map(job => (
                    <div key={job.id} onClick={async () => {
                      setSelectedJob(job)
                      const veh = job.vehicles
                      const cus = job.customers
                      const form: Partial<Invoice> = {
                        job_id: job.id,
                        customer_id: job.customer_id,
                        customer_name: cus?.full_name ?? '',
                        customer_phone: cus?.phone ?? '',
                        customer_email: cus?.email ?? '',
                        vehicle_plate: veh?.plate_number ?? '',
                        vehicle_info: veh ? `${veh.year ?? ''} ${veh.make ?? ''} ${veh.model ?? ''}`.trim() : '',
                        vehicle_mileage: veh?.mileage ? String(veh.mileage) : '',
                        opened_by: user?.full_name ?? user?.email ?? '',
                        issue_date: todayStr(),
                        due_date: futureDateStr(30),
                        discount_amount: 0,
                        notes: '',
                        branch_id: job.branch_id,
                      }
                      setNewInvoiceForm(form)
                      await loadInstalledParts(job.id)
                      setNewInvoiceStep(2)
                    }} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontFamily: 'monospace', color: C.orange, fontWeight: 700, fontSize: 13 }}>{job.job_number}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{job.customers?.full_name ?? '—'}</div>
                        <div style={{ fontSize: 12, color: C.text2 }}>{job.vehicles?.plate_number ?? '—'} · {job.service_type}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700 }}>{formatRM(job.estimated_cost)}</span>
                        <ChevronRight size={16} color={C.text2} />
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* STEP 2: Build invoice */}
              {newInvoiceStep === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Customer/vehicle summary */}
                  <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                    <div>
                      <div style={{ color: C.text2, marginBottom: 2 }}>Customer</div>
                      <div style={{ fontWeight: 600 }}>{newInvoiceForm.customer_name}</div>
                      <div style={{ color: C.text2 }}>{newInvoiceForm.customer_phone}</div>
                    </div>
                    <div>
                      <div style={{ color: C.text2, marginBottom: 2 }}>Vehicle</div>
                      <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{newInvoiceForm.vehicle_plate}</div>
                      <div style={{ color: C.text2 }}>{newInvoiceForm.vehicle_info}</div>
                    </div>
                  </div>

                  {/* Mileage + Opened By */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Mileage (km)</label>
                      <input style={inputStyle} value={newInvoiceForm.vehicle_mileage ?? ''} onChange={e => setNewInvoiceForm({ ...newInvoiceForm, vehicle_mileage: e.target.value })} placeholder="e.g. 45000" />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Opened By</label>
                      <input style={inputStyle} value={newInvoiceForm.opened_by ?? ''} onChange={e => setNewInvoiceForm({ ...newInvoiceForm, opened_by: e.target.value })} />
                    </div>
                  </div>

                  {/* ── PARTS ─────────────────────────────────────────── */}
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text2, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Parts {loadingParts && '(loading…)'}</div>
                      <button onClick={() => { loadCatalogueParts(); setPartPickerSearch(''); setPickerVehicleType(selectedJob?.vehicles?.vehicle_type ?? null); setShowPartPicker(true) }} style={{ ...btnOutline, fontSize: 11, padding: '4px 10px' }}>
                        <Plus size={12} /> Add Part
                      </button>
                    </div>

                    {/* Auto-loaded banner */}
                    {autoLoadedCount > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'rgba(34,197,94,0.08)', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 11, color: '#22C55E', fontWeight: 700 }}>✓ {autoLoadedCount} installed part{autoLoadedCount !== 1 ? 's' : ''} auto-loaded</span>
                        <span style={{ fontSize: 11, color: C.text2 }}>— edit qty/price/disc as needed, or remove any you don't want to bill</span>
                      </div>
                    )}

                    {/* Parts list (auto-loaded + manually added) */}
                    {newInvoiceItems.filter(it => it.item_type === 'part').map((item) => {
                      const discPct = item.discount_pct ?? 0
                      const missingPrice = item.unit_price === 0
                      return (
                        <div key={item.description + item.unit_price} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: `1px solid ${C.border}`, background: missingPrice ? 'rgba(245,158,11,0.06)' : undefined }}>
                          <div style={{ flex: 1, fontSize: 13, fontWeight: 600, minWidth: 0 }}>
                            {item.description}
                            {missingPrice && <span style={{ marginLeft: 6, fontSize: 10, color: '#F59E0B', fontWeight: 700, background: 'rgba(245,158,11,0.15)', padding: '1px 5px', borderRadius: 4 }}>SET PRICE</span>}
                          </div>
                          <div style={{ fontSize: 11, color: missingPrice ? '#F59E0B' : C.text2, whiteSpace: 'nowrap' as const }}>{formatRM(item.unit_price)}</div>
                          {/* Qty */}
                          <input
                            type="number" min="1" step="1" placeholder="1"
                            style={{ ...inputStyle, width: 48, padding: '3px 6px', fontSize: 12, textAlign: 'center' as const }}
                            value={item.qty}
                            onChange={e => {
                              const qty = Math.max(1, Number(e.target.value) || 1)
                              setNewInvoiceItems(prev => prev.map(it => it !== item ? it : { ...it, qty, amount: parseFloat((qty * it.unit_price * (1 - (it.discount_pct ?? 0) / 100)).toFixed(2)) }))
                            }}
                          />
                          {/* Disc % */}
                          <div style={{ position: 'relative' as const, display: 'flex', alignItems: 'center' }}>
                            <input
                              type="number" min="0" max="100" step="1" placeholder="0"
                              style={{ ...inputStyle, width: 52, padding: '3px 18px 3px 6px', fontSize: 12, textAlign: 'right' as const }}
                              value={discPct > 0 ? discPct : ''}
                              onChange={e => {
                                const pct = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                                setNewInvoiceItems(prev => prev.map(it => it !== item ? it : { ...it, discount_pct: pct, amount: parseFloat((it.qty * it.unit_price * (1 - pct / 100)).toFixed(2)) }))
                              }}
                            />
                            <span style={{ position: 'absolute' as const, right: 5, fontSize: 11, color: C.text2, pointerEvents: 'none' as const }}>%</span>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, minWidth: 76, textAlign: 'right' as const, color: discPct > 0 ? '#22C55E' : C.text }}>
                            {formatRM(item.amount)}
                          </div>
                          <button onClick={() => setNewInvoiceItems(prev => prev.filter(it => it !== item))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E05555', padding: 2 }}><X size={13} /></button>
                        </div>
                      )
                    })}

                    {newInvoiceItems.filter(it => it.item_type === 'part').length === 0 && !loadingParts && !addPartRow && (
                      <div style={{ fontSize: 13, color: C.text2, padding: '12px 14px' }}>No parts yet — click "+ Add Part" to add from catalogue.</div>
                    )}

                    {/* Custom Part inline form (triggered from picker) */}
                    {addPartRow && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px auto', gap: 8, padding: '10px 14px', background: 'rgba(241,90,34,0.05)', borderTop: `1px solid ${C.border}` }}>
                        <input style={{ ...inputStyle, fontSize: 13 }} placeholder="Part description" value={addPartRow.description} onChange={e => setAddPartRow({ ...addPartRow, description: e.target.value })} autoFocus />
                        <input style={{ ...inputStyle, fontSize: 13, textAlign: 'center' as const }} placeholder="Qty" type="number" min="1" value={addPartRow.qty} onChange={e => setAddPartRow({ ...addPartRow, qty: e.target.value })} />
                        <input style={{ ...inputStyle, fontSize: 13, textAlign: 'right' as const }} placeholder="Unit price" type="number" min="0" value={addPartRow.unit_price} onChange={e => setAddPartRow({ ...addPartRow, unit_price: e.target.value })} />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={{ ...btnOrange, padding: '6px 12px', fontSize: 12 }} onClick={() => {
                            const qty = Math.max(1, Number(addPartRow.qty) || 1)
                            const up = Number(addPartRow.unit_price) || 0
                            if (!addPartRow.description.trim()) return
                            const item: LineItem = { item_type: 'part', description: addPartRow.description.trim(), qty, uom: 'unit', unit_price: up, amount: qty * up }
                            setNewInvoiceItems(prev => [...prev, item])
                            setAddPartRow(null)
                          }}>Add</button>
                          <button style={{ ...btnOutline, padding: '6px 10px', fontSize: 12 }} onClick={() => setAddPartRow(null)}>✕</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── LABOUR ────────────────────────────────────────── */}
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text2, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Labour</div>
                      <button onClick={() => { loadLabourCharges(); setPickerVehicleType(selectedJob?.vehicles?.vehicle_type ?? null); setShowLabourPicker(true) }} style={{ ...btnOutline, fontSize: 11, padding: '4px 10px' }}>
                        <Wrench size={12} /> Add Labour
                      </button>
                    </div>

                    {newInvoiceItems.filter(it => it.item_type === 'labour').length === 0 ? (
                      <div style={{ fontSize: 13, color: C.text2, padding: '12px 14px' }}>No labour charges yet.</div>
                    ) : newInvoiceItems.filter(it => it.item_type === 'labour').map((item) => {
                      const gross = item.qty * item.unit_price
                      const discPct = item.discount_pct ?? 0
                      return (
                        <div key={item.description + item.unit_price} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: `1px solid ${C.border}` }}>
                          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{item.description}</div>
                          <div style={{ fontSize: 11, color: C.text2, whiteSpace: 'nowrap' as const }}>×{item.qty} {item.uom} · {formatRM(item.unit_price)}</div>
                          <div style={{ position: 'relative' as const, display: 'flex', alignItems: 'center' }}>
                            <input
                              type="number" min="0" max="100" step="1" placeholder="0"
                              style={{ ...inputStyle, width: 52, padding: '3px 18px 3px 6px', fontSize: 12, textAlign: 'right' as const }}
                              value={discPct > 0 ? discPct : ''}
                              onChange={e => {
                                const pct = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                                setNewInvoiceItems(prev => prev.map(it => it !== item ? it : { ...it, discount_pct: pct, amount: parseFloat((gross * (1 - pct / 100)).toFixed(2)) }))
                              }}
                            />
                            <span style={{ position: 'absolute' as const, right: 5, fontSize: 11, color: C.text2, pointerEvents: 'none' as const }}>%</span>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, minWidth: 76, textAlign: 'right' as const, color: discPct > 0 ? '#22C55E' : C.text }}>
                            {formatRM(item.amount)}
                          </div>
                          <button onClick={() => setNewInvoiceItems(prev => prev.filter(it => it !== item))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E05555', padding: 2 }}><X size={13} /></button>
                        </div>
                      )
                    })}
                  </div>

                  {/* Discount + Total */}
                  {(() => {
                    const subtotal = newInvoiceItems.reduce((s, i) => s + i.amount, 0)
                    const discAmt = newInvoiceForm.discount_amount ?? 0
                    const discPct = subtotal > 0 ? (discAmt / subtotal * 100) : 0
                    const total = Math.max(0, subtotal - discAmt)
                    return (
                      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 14 }}>
                          <span style={{ color: C.text2 }}>Subtotal</span>
                          <span>{formatRM(subtotal)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 14 }}>
                          <span style={{ color: C.text2, flexShrink: 0 }}>Discount</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ position: 'relative' as const, display: 'flex', alignItems: 'center' }}>
                              <input
                                type="number" min="0" max="100" step="0.5"
                                placeholder="0"
                                style={{ ...inputStyle, width: 70, padding: '4px 24px 4px 8px', textAlign: 'right' as const }}
                                value={discPct > 0 ? parseFloat(discPct.toFixed(2)) : ''}
                                onChange={e => {
                                  const pct = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                                  setNewInvoiceForm({ ...newInvoiceForm, discount_amount: parseFloat((subtotal * pct / 100).toFixed(2)) })
                                }}
                              />
                              <span style={{ position: 'absolute' as const, right: 7, fontSize: 12, color: C.text2, pointerEvents: 'none' as const }}>%</span>
                            </div>
                            <span style={{ color: C.text2, fontSize: 13 }}>=</span>
                            <input
                              type="number" min="0" step="0.01"
                              placeholder="0.00"
                              style={{ ...inputStyle, width: 90, padding: '4px 8px', textAlign: 'right' as const }}
                              value={discAmt > 0 ? discAmt : ''}
                              onChange={e => setNewInvoiceForm({ ...newInvoiceForm, discount_amount: Math.max(0, Number(e.target.value) || 0) })}
                            />
                          </div>
                        </div>
                        {discAmt > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13, color: C.text2 }}>
                            <span>After Discount</span>
                            <span style={{ color: '#22C55E' }}>− {formatRM(discAmt)}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 17, fontWeight: 700, color: C.orange, paddingTop: discAmt > 0 ? 8 : 0, borderTop: discAmt > 0 ? `1px solid ${C.border}` : 'none' }}>
                          <span>TOTAL</span>
                          <span>{formatRM(total)}</span>
                        </div>
                      </div>
                    )
                  })()}

                  {invoiceError && (
                    <div style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#F87171', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 8 }}>
                      {invoiceError}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button style={btnOutline} onClick={() => { setNewInvoiceStep(1); setNewInvoiceItems([]); setAutoLoadedCount(0); setInvoiceError('') }}>Back</button>
                    <button style={btnOrange} onClick={createInvoice} disabled={saving || newInvoiceItems.length === 0}>
                      {saving ? 'Creating...' : 'Create Invoice'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── LABOUR PICKER MODAL (for both new invoice modal and detail panel) ─── */}
      {/* ── PART PICKER ──────────────────────────────────────────────────────────── */}
      {showPartPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, width: '90%', maxWidth: 540, maxHeight: '75vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Add Part</h3>
              <button onClick={() => setShowPartPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text2 }}><X size={18} /></button>
            </div>
            {/* Search */}
            <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
              {pickerVehicleType && (
                <div style={{ marginBottom: 8, padding: '5px 10px', background: 'rgba(241,90,34,0.1)', borderRadius: 6, fontSize: 12, color: C.orange }}>
                  Showing {pickerVehicleType === 'bike' ? 'Bike' : 'Car'} Division parts only
                </div>
              )}
              <input
                style={{ ...inputStyle, fontSize: 13 }}
                placeholder="Search by name or part number…"
                value={partPickerSearch}
                onChange={e => setPartPickerSearch(e.target.value)}
                autoFocus
              />
            </div>
            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {(() => {
                const term = partPickerSearch.toLowerCase()
                const visible = catalogueParts.filter(p =>
                  (!pickerVehicleType || p.division === pickerVehicleType || p.division === 'both') &&
                  (!term || p.name.toLowerCase().includes(term) || (p.part_number ?? '').toLowerCase().includes(term))
                )
                if (visible.length === 0) return (
                  <div style={{ textAlign: 'center', color: C.text2, padding: 24, fontSize: 13 }}>
                    {catalogueParts.length === 0 ? 'No parts in catalogue yet.' : 'No parts match your search.'}
                  </div>
                )
                return visible.map(p => (
                  <div key={p.id} onClick={() => {
                    const item: LineItem = { item_type: 'part', description: p.name + (p.part_number ? ` [${p.part_number}]` : ''), qty: 1, uom: p.unit || 'unit', unit_price: p.selling_price ?? 0, cost_price: p.cost_price ?? undefined, amount: p.selling_price ?? 0 }
                    setNewInvoiceItems(prev => [...prev, item])
                    setShowPartPicker(false)
                  }} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', marginBottom: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: C.text2 }}>
                        {p.part_number && <span style={{ fontFamily: 'monospace' }}>{p.part_number}</span>}
                        {p.part_number && p.category && ' · '}
                        {p.category && <span>{p.category}</span>}
                        {' · '}
                        <span style={{ color: p.stock_qty > 0 ? '#22C55E' : '#EF4444' }}>{p.stock_qty} in stock</span>
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, color: C.orange, whiteSpace: 'nowrap', marginLeft: 12 }}>
                      {p.selling_price != null ? `RM ${p.selling_price.toFixed(2)}` : 'No price'}
                    </div>
                  </div>
                ))
              })()}
            </div>
            {/* Footer — custom part fallback */}
            <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}` }}>
              <button onClick={() => { setShowPartPicker(false); setAddPartRow({ description: '', qty: '1', unit_price: '' }) }} style={{ ...btnOutline, width: '100%', justifyContent: 'center', fontSize: 13 }}>
                <Plus size={13} /> Add Unlisted / Custom Part
              </button>
            </div>
          </div>
        </div>
      )}

      {showLabourPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, width: '90%', maxWidth: 500, maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Pick Labour Charge</h3>
                <button onClick={() => { setShowLabourPicker(false); setLabourPickerSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text2 }}><X size={18} /></button>
              </div>
              <input
                autoFocus
                type="text"
                placeholder="Search by name…"
                value={labourPickerSearch}
                onChange={e => setLabourPickerSearch(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, padding: '9px 12px', outline: 'none' }}
                onFocus={e => (e.target.style.borderColor = C.orange)}
                onBlur={e => (e.target.style.borderColor = C.border)}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {pickerVehicleType && (
                <div style={{ marginBottom: 12, padding: '6px 10px', background: 'rgba(241,90,34,0.1)', borderRadius: 6, fontSize: 12, color: C.orange }}>
                  Showing {pickerVehicleType === 'bike' ? 'Bike' : 'Car'} Division charges only
                </div>
              )}
              {labourCharges.filter(lc => {
                if (!lc.is_active) return false
                if (pickerVehicleType && lc.division !== pickerVehicleType && lc.division !== 'both') return false
                if (labourPickerSearch.trim()) {
                  const q = labourPickerSearch.toLowerCase()
                  return lc.name.toLowerCase().includes(q) || (lc.description ?? '').toLowerCase().includes(q) || (lc.labour_code ?? '').toLowerCase().includes(q)
                }
                return true
              }).length === 0 ? (
                <div style={{ textAlign: 'center', color: C.text2, padding: 24, fontSize: 13 }}>{labourPickerSearch ? `No results for "${labourPickerSearch}"` : 'No active labour charges. Add some in the Labour Charges tab.'}</div>
              ) : labourCharges.filter(lc => {
                if (!lc.is_active) return false
                if (pickerVehicleType && lc.division !== pickerVehicleType && lc.division !== 'both') return false
                if (labourPickerSearch.trim()) {
                  const q = labourPickerSearch.toLowerCase()
                  return lc.name.toLowerCase().includes(q) || (lc.description ?? '').toLowerCase().includes(q) || (lc.labour_code ?? '').toLowerCase().includes(q)
                }
                return true
              }).map(lc => (
                <div key={lc.id} onClick={() => {
                  if (showNewModal) {
                    const item: LineItem = { item_type: 'labour', description: lc.name + (lc.description ? ' – ' + lc.description : ''), qty: 1, uom: lc.unit, unit_price: lc.unit_price, amount: lc.unit_price }
                    setNewInvoiceItems(prev => [...prev, item])
                    setShowLabourPicker(false); setLabourPickerSearch('')
                  } else {
                    addLabourToInvoice(lc); setLabourPickerSearch('')
                  }
                }} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{lc.name}</div>
                    {lc.description && <div style={{ fontSize: 12, color: C.text2 }}>{lc.description}</div>}
                    <div style={{ fontSize: 12, color: C.text2 }}>per {lc.unit}</div>
                  </div>
                  <div style={{ fontWeight: 700, color: C.orange }}>{formatRM(lc.unit_price)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ADD / EDIT LABOUR CHARGE MODAL ────────────────────────────────────────── */}
      {showLabourChargeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, width: '92%', maxWidth: 640, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: `1px solid ${C.border}` }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{editingLabourCharge ? 'Edit Labour Charge' : 'Add Labour Charge'}</h3>
              <button onClick={() => setShowLabourChargeModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text2 }}><X size={20} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: 'calc(85vh - 80px)' }}>
              {/* Row 1: Code + Name */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Labour Code</label>
                  <input style={inputStyle} value={labourForm.labour_code} onChange={e => setLabourForm({ ...labourForm, labour_code: e.target.value })} placeholder="LAB-ENG-001" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Labour Name *</label>
                  <input style={inputStyle} value={labourForm.name} onChange={e => setLabourForm({ ...labourForm, name: e.target.value })} placeholder="e.g. Engine Oil Service" />
                </div>
              </div>

              {/* Row 2: Category + Duration */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Category</label>
                  <select style={inputStyle} value={labourForm.category} onChange={e => setLabourForm({ ...labourForm, category: e.target.value })}>
                    <option value="">— Select —</option>
                    <option value="Routine Maintenance">Routine Maintenance</option>
                    <option value="Diagnostics">Diagnostics</option>
                    <option value="Inspection">Inspection</option>
                    <option value="Brake System">Brake System</option>
                    <option value="Suspension">Suspension</option>
                    <option value="Steering">Steering</option>
                    <option value="Tyres">Tyres</option>
                    <option value="Alignment">Alignment</option>
                    <option value="Air Conditioning">Air Conditioning</option>
                    <option value="Engine">Engine</option>
                    <option value="Transmission">Transmission</option>
                    <option value="Electrical">Electrical</option>
                    <option value="Final Drive">Final Drive</option>
                    <option value="Harley Upgrade">Harley Upgrade</option>
                    <option value="Performance">Performance</option>
                    <option value="Detailing">Detailing</option>
                    <option value="Mobile Service">Mobile Service</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Standard Duration (mins)</label>
                  <input type="number" style={inputStyle} value={labourForm.standard_duration} onChange={e => setLabourForm({ ...labourForm, standard_duration: e.target.value })} placeholder="e.g. 60" />
                </div>
              </div>

              {/* Row 3: Description */}
              <div>
                <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Description</label>
                <input style={inputStyle} value={labourForm.description} onChange={e => setLabourForm({ ...labourForm, description: e.target.value })} placeholder="Optional details" />
              </div>

              {/* Row 4: Skill Level + Bay */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Required Skill Level</label>
                  <select style={inputStyle} value={labourForm.required_skill_level} onChange={e => setLabourForm({ ...labourForm, required_skill_level: e.target.value })}>
                    <option value="">— Any —</option>
                    <option value="Junior Mechanic">Junior Mechanic</option>
                    <option value="Mechanic">Mechanic</option>
                    <option value="Senior Mechanic">Senior Mechanic</option>
                    <option value="Master Technician">Master Technician</option>
                    <option value="Diagnostic Technician">Diagnostic Technician</option>
                    <option value="Electrical Technician">Electrical Technician</option>
                    <option value="AC Specialist">AC Specialist</option>
                    <option value="Suspension Specialist">Suspension Specialist</option>
                    <option value="Tyre Technician">Tyre Technician</option>
                    <option value="Alignment Technician">Alignment Technician</option>
                    <option value="Harley Specialist">Harley Specialist</option>
                    <option value="Harley Master Technician">Harley Master Technician</option>
                    <option value="Detailer">Detailer</option>
                    <option value="Senior Detailer">Senior Detailer</option>
                    <option value="Master Detailer">Master Detailer</option>
                    <option value="Foreman">Foreman</option>
                    <option value="Driver">Driver</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Bay Required</label>
                  <select style={inputStyle} value={labourForm.bay_required} onChange={e => setLabourForm({ ...labourForm, bay_required: e.target.value })}>
                    <option value="">— Any Bay —</option>
                    <option value="General Service Bay">General Service Bay</option>
                    <option value="Bike Service Bay">Bike Service Bay</option>
                    <option value="Premium Bike Bay">Premium Bike Bay</option>
                    <option value="Harley Bay">Harley Bay</option>
                    <option value="Dyno/Harley Bay">Dyno/Harley Bay</option>
                    <option value="Diagnostic Bay">Diagnostic Bay</option>
                    <option value="Brake Bay">Brake Bay</option>
                    <option value="Suspension Bay">Suspension Bay</option>
                    <option value="Alignment Bay">Alignment Bay</option>
                    <option value="Tyre Bay">Tyre Bay</option>
                    <option value="AC Bay">AC Bay</option>
                    <option value="Engine Bay">Engine Bay</option>
                    <option value="Transmission Bay">Transmission Bay</option>
                    <option value="Electrical Bay">Electrical Bay</option>
                    <option value="Detailing Bay">Detailing Bay</option>
                    <option value="Wash Bay">Wash Bay</option>
                    <option value="Coating Bay">Coating Bay</option>
                    <option value="Inspection Bay">Inspection Bay</option>
                    <option value="Road Test">Road Test</option>
                    <option value="Mobile Service">Mobile Service</option>
                    <option value="Transport">Transport</option>
                  </select>
                </div>
              </div>

              {/* Row 5: Division */}
              <div>
                <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 8 }}>Division</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([['car', 'Car'], ['bike', 'Bike'], ['both', 'Both']] as const).map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setLabourForm({ ...labourForm, division: val })} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `1px solid ${labourForm.division === val ? (val === 'car' ? '#3B82F6' : val === 'bike' ? '#EF4444' : C.orange) : C.border}`, background: labourForm.division === val ? (val === 'car' ? '#1E3A5F' : val === 'bike' ? '#3A1E1E' : '#3A1E0A') : C.bg, color: labourForm.division === val ? '#fff' : C.text2, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 6: Charge + Unit + Taxable */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Labour Charge (RM) *</label>
                  <input type="number" style={inputStyle} value={labourForm.unit_price} onChange={e => setLabourForm({ ...labourForm, unit_price: e.target.value })} placeholder="0.00" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Per Unit</label>
                  <select style={inputStyle} value={labourForm.unit} onChange={e => setLabourForm({ ...labourForm, unit: e.target.value })}>
                    <option value="job">job</option>
                    <option value="hr">hr</option>
                    <option value="unit">unit</option>
                    <option value="set">set</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Taxable</label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                    {[['Yes', true], ['No', false]].map(([label, val]) => (
                      <button key={String(label)} type="button" onClick={() => setLabourForm({ ...labourForm, taxable: val as boolean })} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${labourForm.taxable === val ? C.orange : C.border}`, background: labourForm.taxable === val ? '#3A1E0A' : C.bg, color: labourForm.taxable === val ? C.orange : C.text2, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                        {label as string}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button style={btnOutline} onClick={() => setShowLabourChargeModal(false)}>Cancel</button>
                <button style={btnOrange} onClick={saveLabourCharge} disabled={labourSaving || !labourForm.name || !labourForm.unit_price}>
                  {labourSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RECORD PAYMENT MODAL ─────────────────────────────────────────────────── */}
      {showPaymentModal && editInvoice && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, width: '90%', maxWidth: 440, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: `1px solid ${C.border}` }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Record Payment</h3>
              <button onClick={() => setShowPaymentModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text2 }}><X size={20} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Payment method tiles */}
              <div>
                <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 8 }}>Payment Method</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { value: 'qr', label: 'QR Pay' },
                    { value: 'cash', label: 'Cash' },
                    { value: 'bank_transfer', label: 'Bank Transfer' },
                    { value: 'card', label: 'Card' },
                  ].map(opt => (
                    <button key={opt.value} onClick={() => setPayment({ ...payment, payment_method: opt.value })} style={{ background: payment.payment_method === opt.value ? C.orange : C.bg, color: payment.payment_method === opt.value ? '#fff' : C.text, border: `1px solid ${payment.payment_method === opt.value ? C.orange : C.border}`, borderRadius: 8, padding: '12px 8px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Amount Paid (RM)</label>
                <input type="number" style={inputStyle} value={payment.amount_paid} onChange={e => setPayment({ ...payment, amount_paid: Number(e.target.value) })} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Payment Date</label>
                <input type="date" style={inputStyle} value={payment.payment_date} onChange={e => setPayment({ ...payment, payment_date: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Reference / Receipt No.</label>
                <input style={inputStyle} value={payment.payment_reference} onChange={e => setPayment({ ...payment, payment_reference: e.target.value })} />
              </div>
              <div style={{ background: C.bg, borderRadius: 6, padding: 10, fontSize: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: C.text2 }}>Invoice Total</span>
                  <span>{formatRM(editInvoice.total_amount)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: editInvoice.total_amount - payment.amount_paid <= 0 ? C.green : C.orange }}>
                  <span>Balance After</span>
                  <span>{formatRM(Math.max(0, editInvoice.total_amount - payment.amount_paid))}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button style={btnOutline} onClick={() => setShowPaymentModal(false)}>Cancel</button>
                <button style={btnGreen} onClick={recordPayment} disabled={saving}>{saving ? 'Saving...' : 'Confirm Payment'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PRINT VIEW (DCU 7216 format) — now opens in new tab via /print/invoice/:id ── */}
      {false && editInvoice && (
        <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 9999, overflowY: 'auto' }}>
          <link rel="stylesheet" href="https://fonts.cdnfonts.com/css/cocogoose" />
          <style>{`
            @media print {
              .no-print { display: none !important }
              body { margin: 0 }
            }
            @page { size: A4; margin: 15mm }
          `}</style>
          <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 24px', background: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
            <button onClick={() => setShowPrintView(false)} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Close</button>
            <button onClick={() => window.print()} style={{ background: C.orange, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Print / Save PDF</button>
          </div>

          {/* A4 Invoice body */}
          <div style={{ maxWidth: 794, margin: '24px auto', padding: '32px 40px', background: '#fff', fontFamily: "'Tw Cen MT', 'Century Gothic', sans-serif", color: '#111', fontSize: 12 }}>

            {/* ── Header ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, borderBottom: '2px solid #F15A22', paddingBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {branchInfo?.logo_url && (
                  <img src={branchInfo.logo_url} alt="Logo" style={{ width: 144, height: 144, objectFit: 'contain', flexShrink: 0 }} />
                )}
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#F15A22', letterSpacing: 1, fontFamily: "'Cocogoose', sans-serif", textTransform: 'uppercase' as const }}>{branchInfo?.name ?? 'MOTOVERSE GARAGE'}</div>
                  {branchInfo?.address && <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{branchInfo.address}</div>}
                  {(branchInfo?.phone || branchInfo?.email) && (
                    <div style={{ fontSize: 12, color: '#555' }}>
                      {[branchInfo.phone && `Tel: ${branchInfo.phone}`, branchInfo.email].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
                <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3, marginBottom: 4 }}>INVOICE</div>
                <div style={{ fontSize: 12, color: '#555' }}>No: <span style={{ fontWeight: 700, color: '#111', fontFamily: 'monospace' }}>{editInvoice.invoice_number}</span></div>
                <div style={{ fontSize: 12, color: '#555' }}>Date: {formatDate(editInvoice.issue_date)}</div>
                {editInvoice.opened_by && <div style={{ fontSize: 12, color: '#555' }}>Opened By: {editInvoice.opened_by}</div>}
              </div>
            </div>

            {/* ── Customer / Vehicle block ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, marginBottom: 12, border: '1px solid #ccc' }}>
              <div style={{ padding: '8px 12px', borderRight: '1px solid #ccc' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Customer</div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{editInvoice.customer_name || '—'}</div>
                <div style={{ fontSize: 12, color: '#444' }}>{editInvoice.customer_phone}</div>
                <div style={{ fontSize: 12, color: '#444' }}>{editInvoice.customer_email}</div>
              </div>
              <div style={{ padding: '8px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Vehicle</div>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                  <tbody>
                    <tr>
                      <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2, whiteSpace: 'nowrap' as const }}>Plate No.</td>
                      <td style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{editInvoice.vehicle_plate}</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2, whiteSpace: 'nowrap' as const }}>Manufacturer / Model</td>
                      <td style={{ fontWeight: 600 }}>{editInvoice.vehicle_info}</td>
                    </tr>
                    {editInvoice.vehicle_mileage && (
                      <tr>
                        <td style={{ color: '#666', paddingRight: 8, whiteSpace: 'nowrap' as const }}>Mileage</td>
                        <td>{editInvoice.vehicle_mileage} km</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Line Items Table ── */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
              <thead>
                <tr style={{ background: '#F15A22', color: '#fff' }}>
                  <th style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, fontWeight: 700, width: 36 }}>NO</th>
                  <th style={{ padding: '7px 10px', textAlign: 'left', fontSize: 12, fontWeight: 700 }}>ITEM</th>
                  <th style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, fontWeight: 700, width: 50 }}>QTY</th>
                  <th style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, fontWeight: 700, width: 50 }}>UOM</th>
                  <th style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12, fontWeight: 700, width: 90 }}>UNIT PRICE</th>
                  <th style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12, fontWeight: 700, width: 90 }}>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {editInvoice.line_items.map((item, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e8e8e8', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, color: '#666' }}>{i + 1}</td>
                    <td style={{ padding: '7px 10px', fontSize: 12 }}>{item.description}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12 }}>{item.qty}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, color: '#666' }}>{item.uom || 'unit'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12 }}>{item.unit_price.toFixed(2)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{item.amount.toFixed(2)}</td>
                  </tr>
                ))}
                {/* Blank filler rows (min 5 rows) */}
                {Array.from({ length: Math.max(0, 5 - editInvoice.line_items.length) }).map((_, i) => (
                  <tr key={`blank-${i}`} style={{ borderBottom: '1px solid #e8e8e8' }}>
                    <td style={{ padding: '7px 10px' }}>&nbsp;</td>
                    <td style={{ padding: '7px 10px' }}></td>
                    <td></td><td></td><td></td><td></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ── Totals block ── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <table style={{ borderCollapse: 'collapse', width: 280, border: '1px solid #ccc' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                    <td style={{ padding: '5px 12px', fontSize: 12, color: '#555' }}>TOTAL ITEM ({editInvoice.line_items.length})</td>
                    <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{editInvoice.subtotal?.toFixed(2)}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                    <td style={{ padding: '5px 12px', fontSize: 12, color: '#555' }}>EXTRA DISCOUNT</td>
                    <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12 }}>{(editInvoice.discount_amount ?? 0).toFixed(2)}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                    <td style={{ padding: '5px 12px', fontSize: 12, color: '#555' }}>BEF. ROUNDING</td>
                    <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12 }}>{((editInvoice.subtotal ?? 0) - (editInvoice.discount_amount ?? 0)).toFixed(2)}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                    <td style={{ padding: '5px 12px', fontSize: 12, color: '#555' }}>ROUNDING</td>
                    <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12 }}>0.00</td>
                  </tr>
                  <tr style={{ background: '#F15A22', color: '#fff' }}>
                    <td style={{ padding: '7px 12px', fontSize: 13, fontWeight: 800 }}>TOTAL</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 14, fontWeight: 800 }}>RM {editInvoice.total_amount?.toFixed(2)}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                    <td style={{ padding: '5px 12px', fontSize: 12, color: '#555' }}>
                      PAID ({editInvoice.payment_method ? editInvoice.payment_method.replace('_', ' ').toUpperCase() : '—'})
                    </td>
                    <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12 }}>{(editInvoice.amount_paid ?? 0).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>DUE</td>
                    <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: (editInvoice.balance_due ?? 0) > 0 ? '#c0392b' : '#1a7b4b' }}>
                      RM {(editInvoice.balance_due ?? 0).toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Amount in words ── */}
            <div style={{ border: '1px solid #ccc', borderRadius: 4, padding: '8px 12px', marginBottom: 12, background: '#fafafa' }}>
              <span style={{ fontSize: 12, color: '#888', marginRight: 6 }}>Amount in words:</span>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const }}>RINGGIT MALAYSIA {amountInWords(editInvoice.total_amount ?? 0)}</span>
            </div>

            {/* ── Bank + Signature ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div style={{ border: '1px solid #ccc', borderRadius: 4, padding: '10px 12px', background: '#fafafa' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Bank Details</div>
                {branchInfo?.bank_name || branchInfo?.bank_account_number || branchInfo?.bank_account_name ? (
                  <>
                    {branchInfo.bank_name && <div style={{ fontSize: 12 }}><strong>{branchInfo.bank_name}</strong></div>}
                    {branchInfo.bank_account_number && <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }}>{branchInfo.bank_account_number}</div>}
                    {branchInfo.bank_account_name && <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{branchInfo.bank_account_name}</div>}
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: '#aaa', fontStyle: 'italic' }}>No bank details set</div>
                )}
              </div>
              <div style={{ border: '1px solid #ccc', borderRadius: 4, padding: '10px 12px', minHeight: 70, background: '#fafafa', position: 'relative' as const }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Authorised Signature</div>
                {editInvoice.status === 'paid' && (
                  <div style={{ position: 'absolute' as const, top: 12, right: 12, border: '3px solid #1a7b4b', borderRadius: 6, padding: '4px 12px', color: '#1a7b4b', fontWeight: 900, fontSize: 18, letterSpacing: 2, transform: 'rotate(-8deg)', opacity: 0.8 }}>
                    PAID
                  </div>
                )}
                <div style={{ marginTop: 28, borderTop: '1px solid #999', fontSize: 12, color: '#888', paddingTop: 4 }}>{branchInfo?.name ?? 'Authorised Signatory'}</div>
              </div>
            </div>

            {/* Footer note */}
            <div style={{ textAlign: 'center', fontSize: 12, color: '#aaa', borderTop: '1px solid #eee', paddingTop: 8, marginBottom: 12 }}>
              Thank you for your business! · This is a computer-generated invoice.
            </div>

            {/* Powered by EZGarage */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
              <span style={{ fontSize: 12, color: '#bbb', letterSpacing: 0.5 }}>Powered by:</span>
              <span style={{ fontSize: 12, color: '#aaa', fontWeight: 600 }}>EZ Garage</span>
              <span style={{ fontSize: 12, color: '#ccc' }}>·</span>
              <span style={{ fontSize: 12, color: '#aaa' }}>http://ezgarage.app</span>
            </div>
          </div>
        </div>
      )}

      {/* ── RECEIPT PRINT VIEW — now opens in new tab via /print/receipt/:id ── */}
      {false && editInvoice && (
        <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 9999, overflowY: 'auto' }}>
          <link rel="stylesheet" href="https://fonts.cdnfonts.com/css/cocogoose" />
          <style>{`
            @media print { .no-print { display: none !important } body { margin: 0 } }
            @page { size: A5; margin: 12mm }
          `}</style>

          {/* Toolbar */}
          <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', background: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
            <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Receipt — {editInvoice.invoice_number}</span>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowReceiptView(false)} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Close</button>
              <button onClick={() => window.print()} style={{ background: '#F15A22', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Printer size={14} /> Print / Save PDF
              </button>
            </div>
          </div>

          {/* Receipt body — A5 width */}
          <div style={{ maxWidth: 560, margin: '24px auto', padding: '28px 32px', background: '#fff', fontFamily: "'Tw Cen MT', 'Century Gothic', sans-serif", color: '#111', fontSize: 12 }}>

            {/* Header */}
            <div style={{ textAlign: 'center', borderBottom: '2px solid #F15A22', paddingBottom: 12, marginBottom: 14 }}>
              {branchInfo?.logo_url && (
                <img src={branchInfo.logo_url} alt="Logo" style={{ height: 56, objectFit: 'contain', marginBottom: 6 }} />
              )}
              <div style={{ fontSize: 20, fontWeight: 700, color: '#F15A22', letterSpacing: 1, fontFamily: "'Cocogoose', sans-serif", textTransform: 'uppercase' }}>{branchInfo?.name ?? 'MOTOVERSE GARAGE'}</div>
              {branchInfo?.address && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{branchInfo.address}</div>}
              {(branchInfo?.phone || branchInfo?.email) && (
                <div style={{ fontSize: 11, color: '#666' }}>
                  {[branchInfo?.phone && `Tel: ${branchInfo.phone}`, branchInfo?.email].filter(Boolean).join(' · ')}
                </div>
              )}
              <div style={{ marginTop: 10, fontSize: 18, fontWeight: 900, letterSpacing: 4, color: '#111' }}>RECEIPT</div>
            </div>

            {/* Receipt meta */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 14, fontSize: 12 }}>
              <div><span style={{ color: '#888' }}>Receipt No:</span> <strong style={{ fontFamily: 'monospace' }}>{editInvoice.invoice_number}</strong></div>
              <div style={{ textAlign: 'right' }}><span style={{ color: '#888' }}>Date:</span> <strong>{editInvoice.payment_date ? new Date(editInvoice.payment_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : formatDate(editInvoice.issue_date)}</strong></div>
              <div><span style={{ color: '#888' }}>Customer:</span> <strong>{editInvoice.customer_name}</strong></div>
              <div style={{ textAlign: 'right' }}><span style={{ color: '#888' }}>Vehicle:</span> <strong style={{ fontFamily: 'monospace' }}>{editInvoice.vehicle_plate}</strong></div>
            </div>

            {/* Payment summary — no line items, invoice is the reference */}
            <div style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ background: '#F15A22', color: '#fff', padding: '7px 14px', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Payment Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: '#555' }}>Invoice Reference</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }}>{editInvoice.invoice_number}</td>
                  </tr>
                  {(editInvoice.discount_amount ?? 0) > 0 && (
                    <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: '#555' }}>Subtotal</td>
                      <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12 }}>RM {(editInvoice.subtotal ?? 0).toFixed(2)}</td>
                    </tr>
                  )}
                  {(editInvoice.discount_amount ?? 0) > 0 && (
                    <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: '#555' }}>Discount</td>
                      <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, color: '#e05' }}>- RM {(editInvoice.discount_amount ?? 0).toFixed(2)}</td>
                    </tr>
                  )}
                  <tr style={{ background: '#fafafa' }}>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 800 }}>Total Amount</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 15, fontWeight: 800 }}>RM {(editInvoice.total_amount ?? 0).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Payment confirmation box */}
            <div style={{ border: '2px solid #1a7b4b', borderRadius: 8, padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f0fff6', position: 'relative' }}>
              <div>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 1 }}>Payment Received</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>RM {(editInvoice.amount_paid ?? 0).toFixed(2)}</div>
                <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                  {editInvoice.payment_method ? editInvoice.payment_method.replace('_', ' ').toUpperCase() : 'CASH'}
                  {editInvoice.payment_reference ? ` · Ref: ${editInvoice.payment_reference}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#1a7b4b', border: '3px solid #1a7b4b', borderRadius: 6, padding: '4px 14px', letterSpacing: 3, transform: 'rotate(-8deg)', opacity: 0.85 }}>
                PAID
              </div>
            </div>

            {/* Footer */}
            <div style={{ textAlign: 'center', fontSize: 12, color: '#aaa', borderTop: '1px solid #eee', paddingTop: 8, marginBottom: 6 }}>
              Thank you for your payment! Please keep this receipt for your records.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#ccc' }}>Powered by:</span>
              <span style={{ fontSize: 11, color: '#bbb', fontWeight: 600 }}>EZ Garage</span>
              <span style={{ fontSize: 11, color: '#ccc' }}>·</span>
              <span style={{ fontSize: 11, color: '#bbb' }}>http://ezgarage.app</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
