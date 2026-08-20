import { useState, useEffect, useRef } from 'react'
import { X, Send, Loader2, Sparkles, RefreshCw, Paperclip, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from '@/components/ui/Toast'

// "Business Analysis" -- a reconciliation between what the real data
// shows and what the owner knows that no file/table can ever capture.
// One evergreen conversation per tenant (sales_marketing_business_analysis,
// migration 141), re-opened rather than restarted -- mirrors the chat
// mechanics already proven in BusinessProfilePage.tsx's "Ask Izzy"
// interview, including image/PDF attachment so the owner can hand Izzy
// a file to study mid-conversation.

const START_SENTINEL = '__START_ANALYSIS__'
const REFRESH_SENTINEL = '__REFRESH_ANALYSIS__'
const SAVE_SENTINEL = '__SAVE_ANALYSIS__'
const UPLOADS_BUCKET = 'sales-marketing-uploads'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ACCEPTED_FILE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']

interface ConversationTurn { role: string; content: string | { type: string; text?: string; path?: string; media_type?: string }[]; meta?: { at: string; tokens?: number } }

function fmtMeta(meta?: { at: string; tokens?: number }) {
  if (!meta) return null
  const time = new Date(meta.at).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return meta.tokens != null ? `${meta.tokens.toLocaleString()} tokens · ${time}` : time
}
interface AnalysisRow { id: string; current_analysis: string | null; conversation: ConversationTurn[] }

function extractText(content: ConversationTurn['content']): string {
  if (typeof content === 'string') return content
  return content.filter(b => b.type === 'text' && b.text).map(b => b.text!).join('\n')
}

function extractFileRef(content: ConversationTurn['content']): { path: string; media_type?: string } | null {
  if (typeof content === 'string') return null
  const b = content.find(b => b.type === 'file_ref')
  return b?.path ? { path: b.path, media_type: b.media_type } : null
}

function ChatFile({ path, mediaType }: { path: string; mediaType?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.storage.from(UPLOADS_BUCKET).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data) { setFailed(true); return }
      setUrl(data.signedUrl)
    })
    return () => { cancelled = true }
  }, [path])

  if (failed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 8, borderRadius: 8, backgroundColor: '#1E1E1E', color: '#6A6A6A', fontSize: 11 }}>
        <FileText size={12} /> File unavailable
      </div>
    )
  }
  if (!url) return <div style={{ width: 160, height: 80, borderRadius: 8, backgroundColor: '#1E1E1E' }} />
  if (mediaType === 'application/pdf') {
    return (
      <a href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 8, borderRadius: 8, backgroundColor: '#1E1E1E', color: '#E0E0E0', fontSize: 11, textDecoration: 'none' }}>
        <FileText size={14} color="#F15A22" /> {path.split('/').pop()}
      </a>
    )
  }
  return <img src={url} alt="Attachment" style={{ maxWidth: 200, maxHeight: 160, borderRadius: 8, objectFit: 'cover' as const }} />
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
  const [businessProfileId, setBusinessProfileId] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function load() {
    setLoading(true)
    Promise.all([
      supabase.from('sales_marketing_business_analysis').select('*').eq('tenant_id', tenantId).maybeSingle(),
      supabase.from('sales_marketing_business_profile').select('id').eq('tenant_id', tenantId).maybeSingle(),
    ]).then(([analysisRes, profileRes]) => {
      if (analysisRes.error) toast.error(analysisRes.error.message)
      setAnalysis(analysisRes.data as AnalysisRow | null)
      setBusinessProfileId(profileRes.data?.id ?? null)
      setLoading(false)
    })
  }

  useEffect(() => { if (open) load() }, [open, tenantId])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [analysis?.conversation])
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [chatInput])

  async function callAssistant(message: string, filePath?: string) {
    const { data, error } = await supabase.functions.invoke('sales-marketing-analysis-assistant', { body: { message, filePath } })
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

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ACCEPTED_FILE_TYPES.includes(file.type)) { toast.error('Only JPEG, PNG, WebP images or PDFs are supported'); return }
    if (file.size > MAX_FILE_BYTES) { toast.error('File must be under 10MB'); return }
    setAttachedFile(file)
    setAttachedPreview(file.type === 'application/pdf' ? null : URL.createObjectURL(file))
  }

  function clearAttachment() {
    if (attachedPreview) URL.revokeObjectURL(attachedPreview)
    setAttachedFile(null)
    setAttachedPreview(null)
  }

  async function sendMessage() {
    const message = chatInput.trim() || (attachedFile ? 'Here is a file for you to study.' : '')
    if (!message || sending) return
    setChatInput('')
    const fileToSend = attachedFile
    clearAttachment()

    let filePath: string | undefined
    if (fileToSend && businessProfileId) {
      setUploadingFile(true)
      const ext = fileToSend.name.split('.').pop() || 'jpg'
      const path = `${businessProfileId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadErr } = await supabase.storage.from(UPLOADS_BUCKET).upload(path, fileToSend, { contentType: fileToSend.type })
      setUploadingFile(false)
      if (uploadErr) { toast.error('Could not upload the file'); return }
      filePath = path
    }

    setSending(true)
    const result = await callAssistant(message, filePath)
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
              {visibleTurns.map((turn, i) => {
                const fileRef = extractFileRef(turn.content)
                return (
                  <div key={i} style={{ alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {fileRef && <ChatFile path={fileRef.path} mediaType={fileRef.media_type} />}
                    <div style={{
                      padding: '9px 13px', borderRadius: 12,
                      backgroundColor: turn.role === 'user' ? '#F15A22' : '#1E1E1E',
                      color: turn.role === 'user' ? '#fff' : '#E0E0E0',
                      fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const,
                    }}>
                      {extractText(turn.content)}
                    </div>
                    {turn.meta && (
                      <div style={{ fontSize: 10, color: '#5A5A5A', textAlign: turn.role === 'user' ? 'right' as const : 'left' as const, padding: '0 3px' }}>
                        {fmtMeta(turn.meta)}
                      </div>
                    )}
                  </div>
                )
              })}
              {(sending || refreshing) && (
                <div style={{ alignSelf: 'flex-start', color: '#6A6A6A', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Loader2 size={12} className="animate-spin" /> thinking...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            {attachedFile && (
              <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {attachedPreview
                  ? <img src={attachedPreview} alt="Attachment preview" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' as const }} />
                  : <FileText size={20} color="#F15A22" />}
                <span style={{ fontSize: 11, color: '#A0A0A0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{attachedFile.name}</span>
                <button onClick={clearAttachment} style={{ background: 'none', border: 'none', color: '#6A6A6A', cursor: 'pointer', padding: 2 }}>
                  <X size={13} />
                </button>
              </div>
            )}
            <div style={{ padding: '12px 12px 16px', borderTop: '1px solid #2A2A2A', display: 'flex', gap: 8, flexShrink: 0, alignItems: 'flex-end' }}>
              <input ref={fileInputRef} type="file" accept={ACCEPTED_FILE_TYPES.join(',')} onChange={handleFileSelect} style={{ display: 'none' }} />
              <button onClick={() => fileInputRef.current?.click()} disabled={sending || uploadingFile}
                title="Attach an image or PDF for Izzy to study"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 8, border: '1px solid #2A2A2A', background: 'none', color: '#A0A0A0', cursor: 'pointer', flexShrink: 0 }}>
                <Paperclip size={14} />
              </button>
              <textarea ref={textareaRef} value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="Confirm, correct, or add context... (Shift+Enter for a new line)"
                rows={1}
                style={{ ...inputStyle, flex: 1, resize: 'none' as const, fontFamily: 'inherit', minHeight: 36, maxHeight: 140, overflowY: 'auto' as const }}
                disabled={sending} />
              <button onClick={sendMessage} disabled={sending || uploadingFile || (!chatInput.trim() && !attachedFile)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', cursor: 'pointer', opacity: sending || uploadingFile || (!chatInput.trim() && !attachedFile) ? 0.5 : 1, flexShrink: 0 }}>
                {uploadingFile ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
