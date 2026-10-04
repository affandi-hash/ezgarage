import { useState } from 'react'
import { Loader2, Sheet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from '@/components/ui/Toast'

// Pushes the latest daily Sales / COGS / OPEX into the Google Sheet now, the
// same job that runs every night. Safe to press at any time: it only rewrites
// the days that changed.
export function SheetSyncButton() {
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('sheet-sync', { body: {} })
    setBusy(false)
    if (error) { toast('Could not reach the sheet sync. Try again in a minute.', 'error'); return }
    if (data?.message) { toast(data.message, 'error'); return }
    const r = data?.results?.[0]
    const sheet = r?.sheet as { ok?: boolean; updated?: number; appended?: number; error?: string; skippedFormulaCells?: string[] } | undefined
    if (r?.error || !sheet?.ok) { toast(`Sheet sync failed: ${r?.error ?? sheet?.error ?? 'unknown error'}`, 'error'); return }
    const skipped = sheet.skippedFormulaCells?.length ? ` ${sheet.skippedFormulaCells.length} formula cells were left alone.` : ''
    toast(`Google Sheet updated: ${sheet.updated ?? 0} rows changed, ${sheet.appended ?? 0} added.${skipped}`)
  }

  return (
    <button onClick={run} disabled={busy}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 700, border: '1px solid #2A2A2A', background: '#1E1E1E', color: '#F0F0F0', cursor: busy ? 'wait' : 'pointer' }}>
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Sheet size={16} />} Sync to Google Sheet
    </button>
  )
}
