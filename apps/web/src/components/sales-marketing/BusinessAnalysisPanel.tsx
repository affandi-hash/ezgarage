import { useState, useEffect, useRef } from 'react'
import { X, Send, Loader2, Sparkles, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from '@/components/ui/Toast'

// "Business Analysis" -- a reconciliation between what the real data
// shows and what the owner knows that no file/table can ever capture.
// One evergreen conversation per tenant (sales_marketing_business_analysis,
// migration 141), re-opened rather than restarted -- mirrors the chat
// mechanics already proven in BusinessProfilePage.tsx's "Ask Izzy"
// interview, minus image attachment (not needed for this conversation).

const START_SENTINEL = '__START_ANALYSIS__'
const REFRESH_SENTINEL = '__REFRESH_ANALYSIS__'
const SAVE_SENTINEL = '__SAVE_ANALYSIS__'

interface ConversationTurn { role: string; content: string | { type: string; text?: string }[] }
interface AnalysisRow { id: string; current_analysis: string | null; conversation: ConversationTurn[] }

function extractText(content: ConversationTurn['content']): string {
  if (typeof content === 'string') return content
  return content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n')
}

const inputStyle: React.CSSProperties = {
  background: '#0E0E0E', border: '1px solid #2A2A2A', color: '#F0F0F0',
  borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const,
}

export function BusinessAnalysisPanel({ open, onClose, tenantId }: {
  open: boolean
  onClose: () => void
  tenantId: string
}) {
  const [loading, setLoading] = useState(true)
  const [analysis, setAnalysis] = useState<AnalysisRow | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  function load() {
    setLoading(true)
    supabase.from('sales_marketing_business_analysis').select('*').eq('tenant_id', tenantId).maybeSingle()
      .then(({ data, error }) => {
        if (error) toast.error(error.message)
        setAnalysis(data as AnalysisRow | null)
        setLoading(false)
      })
  }

  useEffect(() => { if (open) load() }, [open, tenantId])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [analysis?.conversation])

  async function callAssistant(message: string) {
    const { data, error } = await supabase.functions.invoke('sales-marketing-analysis-assistant', { body: { message } })
    if (error) { toast.error('The assistant is unavailable right now'); return null }
    if (data?.error) { toast.error(data.error); return null }
    return data as { reply: string; analysis: AnalysisRow }
  }

  async function handleStart() {
    setStarting(true)
    const result = await callAssistant(START_SENTINEL)
    setStarting(false)
    if (result) setAnalysis(result.analysis)
  }

  async function handleRefresh() {
    setRefreshing(true)
    const result = await callAssistant(REFRESH_SENTINEL)
    setRefreshing(false)
    if (result) setAnalysis(result.analysis)
  }

  async function sendMessage() {
    const message = chatInput.trim()
    if (!message || sending) return
    setChatInput('')
    setSending(true)
    const result = await callAssistant(message)
    setSending(false)
    if (result) setAnalysis(result.analysis)
  }

  const visibleTurns = (analysis?.conversation ?? []).filter(turn => {
    if (typeof turn.content === 'string') return turn.content !== START_SENTINEL && turn.content !== REFRESH_SENTINEL && turn.content !== SAVE_SENTINEL
    return extractText(turn.content).trim().length > 0
  })

  if (!open) return null

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'flex-end', zIndex: 200 }} onClick={onClose}>
      <div
        style={{ width: 480, maxWidth: '100%', height: '100%', backgroundColor: '#141414', borderLeft: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #2A2A2A', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={15} color="#F15A22" />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#F0F0F0' }}>Business Analysis</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {analysis && (
              <button onClick={handleRefresh} disabled={refreshing} title="Re-check against the latest data"
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: '1px solid #2A2A2A', borderRadius: 6, color: '#A0A0A0', fontSize: 11, fontWeight: 600, padding: '5px 9px', cursor: refreshing ? 'not-allowed' : 'pointer' }}>
                {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                Refresh
              </button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8A8A8A', cursor: 'pointer' }}><X size={18} /></button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 20, color: '#6A6A6A', fontSize: 13 }}>Loading...</div>
        ) : !analysis ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32, textAlign: 'center' as const }}>
            <Sparkles size={26} color="#F15A22" />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#F0F0F0' }}>Sync with Izzy before you plan</div>
              <p style={{ fontSize: 13, color: '#A0A0A0', maxWidth: 340, margin: '6px 0 0' }}>
                Izzy will read your real numbers and give you its honest take -- including what it's just guessing at. Correct anything it gets wrong before a plan gets built on it.
              </p>
            </div>
            <button onClick={handleStart} disabled={starting}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              {starting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {starting ? 'Analyzing...' : 'Run Business Analysis'}
            </button>
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleTurns.length === 0 && (
                <p style={{ fontSize: 12, color: '#5A5A5A', fontStyle: 'italic' }}>Starting the analysis...</p>
              )}
              {visibleTurns.map((turn, i) => (
                <div key={i} style={{ alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                  <div style={{
                    padding: '9px 13px', borderRadius: 12,
                    backgroundColor: turn.role === 'user' ? '#F15A22' : '#1E1E1E',
                    color: turn.role === 'user' ? '#fff' : '#E0E0E0',
                    fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const,
                  }}>
                    {extractText(turn.content)}
                  </div>
                </div>
              ))}
              {(sending || refreshing) && (
                <div style={{ alignSelf: 'flex-start', color: '#6A6A6A', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Loader2 size={12} className="animate-spin" /> thinking...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={{ padding: '12px 12px 16px', borderTop: '1px solid #2A2A2A', display: 'flex', gap: 8, flexShrink: 0 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="Confirm, correct, or add context..." style={{ ...inputStyle, flex: 1 }} disabled={sending} />
              <button onClick={sendMessage} disabled={sending || !chatInput.trim()}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', cursor: 'pointer', opacity: sending || !chatInput.trim() ? 0.5 : 1, flexShrink: 0 }}>
                <Send size={14} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
