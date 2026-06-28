import { useState, useEffect, useRef } from 'react'
import { Camera, Upload, X, Loader2, Trash2, Image } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from './Toast'
import { ConfirmModal } from './ConfirmModal'

const STATUS_LABELS: Record<string, string> = {
  checked_in:       'Checked In',
  diagnosing:       'Diagnosing',
  waiting_approval: 'Waiting Approval',
  waiting_parts:    'Waiting Parts',
  in_progress:      'In Progress',
  ready:            'Ready',
  long_due:         'Long Due',
  closed:           'Closed',
}

interface JobPhoto {
  id: string
  job_id: string
  branch_id: string
  storage_path: string
  caption: string | null
  status_at_upload: string | null
  uploaded_by: string | null
  created_at: string
  _url?: string
}

interface PhotoUploaderProps {
  jobId: string
  branchId: string
  tenantId: string
  uploadedBy: string
  currentStatus?: string
}

const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  orange: '#F15A22',
  textPrimary: '#F0F0F0',
  textSecondary: '#A0A0A0',
}

export function PhotoUploader({ jobId, branchId, tenantId, uploadedBy, currentStatus }: PhotoUploaderProps) {
  const [photos, setPhotos] = useState<JobPhoto[]>([])
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<JobPhoto | null>(null)
  const [lightbox, setLightbox] = useState<{ url: string; status: string | null } | null>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  async function fetchPhotos() {
    const { data } = await supabase
      .from('job_photos')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })

    if (!data) { setLoading(false); return }

    const enriched = await Promise.all(
      data.map(async (p: JobPhoto) => {
        const { data: urlData } = await supabase.storage
          .from('job-photos')
          .createSignedUrl(p.storage_path, 3600)
        return { ...p, _url: urlData?.signedUrl }
      })
    )
    setPhotos(enriched)
    setLoading(false)
  }

  useEffect(() => { fetchPhotos() }, [jobId])

  async function uploadFiles(files: File[]) {
    if (!files.length) return
    setUploading(true)

    for (const file of files) {
      const ext = file.name.split('.').pop()
      const path = `${branchId}/${jobId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('job-photos')
        .upload(path, file, { contentType: file.type, upsert: false })

      if (uploadError) {
        toast(`Upload failed: ${uploadError.message}`, 'error')
        continue
      }

      const { error: insertError } = await supabase.from('job_photos').insert({
        job_id: jobId,
        branch_id: branchId,
        tenant_id: tenantId || null,
        category: 'general',
        storage_path: path,
        caption: null,
        uploaded_by: uploadedBy || null,
        status_at_upload: currentStatus ?? null,
      })
      if (insertError) { toast(`Save failed: ${insertError.message}`, 'error'); continue }
    }

    setUploading(false)
    if (galleryRef.current) galleryRef.current.value = ''
    if (cameraRef.current) cameraRef.current.value = ''
    toast(`${files.length} photo${files.length > 1 ? 's' : ''} uploaded`)
    fetchPhotos()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await supabase.storage.from('job-photos').remove([deleteTarget.storage_path])
    await supabase.from('job_photos').delete().eq('id', deleteTarget.id)
    setDeleteTarget(null)
    toast('Photo deleted')
    fetchPhotos()
  }

  return (
    <div>
      {/* Upload buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          onClick={() => cameraRef.current?.click()}
          disabled={uploading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: C.orange, border: 'none', borderRadius: 6,
            color: '#fff', padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700,
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {uploading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Camera size={14} />}
          Take Photo
        </button>
        <button
          onClick={() => galleryRef.current?.click()}
          disabled={uploading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6,
            color: C.textSecondary, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            opacity: uploading ? 0.6 : 1,
          }}
        >
          <Image size={14} />
          Gallery
        </button>
        {currentStatus && (
          <span style={{ fontSize: 11, color: C.orange, backgroundColor: 'rgba(241,90,34,0.1)', border: '1px solid rgba(241,90,34,0.2)', padding: '3px 8px', borderRadius: 9999, fontWeight: 600 }}>
            Tagged: {STATUS_LABELS[currentStatus] ?? currentStatus}
          </span>
        )}
        {/* Hidden inputs */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={e => uploadFiles(Array.from(e.target.files || []))}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => uploadFiles(Array.from(e.target.files || []))}
        />
      </div>

      {/* Photo grid */}
      {loading ? (
        <div style={{ color: C.textSecondary, fontSize: 13, padding: '10px 0' }}>Loading photos…</div>
      ) : photos.length === 0 ? (
        <div style={{
          border: `1px dashed ${C.border}`,
          borderRadius: 8,
          padding: '24px 0',
          textAlign: 'center',
          color: C.textSecondary,
          fontSize: 13,
        }}>
          <Camera size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>No photos yet</div>
          <div style={{ fontSize: 11, marginTop: 4, color: '#555' }}>Photos are tagged with the job status when taken</div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
          gap: 8,
        }}>
          {photos.map(p => (
            <div
              key={p.id}
              style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: `1px solid ${C.border}` }}
              onClick={() => setLightbox({ url: p._url || '', status: p.status_at_upload })}
            >
              <img
                src={p._url}
                alt={p.status_at_upload ?? 'job photo'}
                style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
              />
              {/* Status badge overlay */}
              {p.status_at_upload && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'rgba(0,0,0,0.75)',
                  padding: '3px 5px',
                  fontSize: 9,
                  fontWeight: 700,
                  color: '#F15A22',
                  letterSpacing: '0.04em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {STATUS_LABELS[p.status_at_upload] ?? p.status_at_upload}
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(p) }}
                style={{
                  position: 'absolute', top: 4, right: 4,
                  background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: 4,
                  color: '#fff', cursor: 'pointer', padding: '3px 5px', display: 'flex', alignItems: 'center',
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 3000,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <button onClick={() => setLightbox(null)} style={{
            position: 'absolute', top: 20, right: 20,
            background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 6,
            color: '#fff', cursor: 'pointer', padding: 8,
          }}>
            <X size={20} />
          </button>
          {lightbox.status && (
            <div style={{ marginBottom: 12, padding: '4px 14px', background: 'rgba(241,90,34,0.2)', border: '1px solid rgba(241,90,34,0.4)', borderRadius: 9999, color: '#F15A22', fontSize: 12, fontWeight: 700 }}>
              {STATUS_LABELS[lightbox.status] ?? lightbox.status}
            </div>
          )}
          <img
            src={lightbox.url}
            style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmModal
          title="Delete Photo"
          message={`Delete this photo? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

// Standalone quick-upload button for use on the kanban card
interface QuickPhotoUploadProps {
  jobId: string
  branchId: string
  tenantId: string
  uploadedBy: string
  currentStatus: string
  onUploaded?: () => void
}

export function QuickPhotoUpload({ jobId, branchId, tenantId, uploadedBy, currentStatus, onUploaded }: QuickPhotoUploadProps) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: File[]) {
    if (!files.length) return
    setUploading(true)
    for (const file of files) {
      const ext = file.name.split('.').pop()
      const path = `${branchId}/${jobId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('job-photos')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) { toast(`Upload failed: ${uploadError.message}`, 'error'); continue }
      const { error: insertError } = await supabase.from('job_photos').insert({
        job_id: jobId,
        branch_id: branchId,
        tenant_id: tenantId || null,
        category: 'general',
        storage_path: path,
        caption: null,
        uploaded_by: uploadedBy || null,
        status_at_upload: currentStatus,
      })
      if (insertError) toast(`Save failed: ${insertError.message}`, 'error')
    }
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
    toast(`Photo uploaded — tagged as "${STATUS_LABELS[currentStatus] ?? currentStatus}"`)
    onUploaded?.()
  }

  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        style={{
          flex: 1, padding: '5px 0', border: '1px solid #2A2A2A', borderRadius: 6,
          backgroundColor: 'transparent', color: uploading ? '#555' : '#A0A0A0',
          fontSize: 11, cursor: uploading ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}
      >
        {uploading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Camera size={11} />}
        {uploading ? '...' : 'Photo'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={e => handleFiles(Array.from(e.target.files || []))}
      />
    </>
  )
}
