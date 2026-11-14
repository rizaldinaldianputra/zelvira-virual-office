'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import type { WorkflowApproval } from '@/lib/workflow/types'

export default function ApprovalCenterTab({
  onApprovalProcessed,
}: {
  onApprovalProcessed?: () => void
}) {
  const [approvals, setApprovals] = useState<WorkflowApproval[]>([])
  const [viewFilter, setViewFilter] = useState<'pending' | 'all'>('pending')
  const [selectedApproval, setSelectedApproval] = useState<WorkflowApproval | null>(null)
  const [reviewComment, setReviewComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadApprovals() {
    setLoading(true)
    setError(null)
    try {
      const q = viewFilter === 'pending' ? '?status=pending' : ''
      const res = await fetchJson<{ approvals: WorkflowApproval[] }>(`/api/workflow/approvals${q}`)
      if (res.data?.approvals) {
        setApprovals(res.data.approvals)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadApprovals()
    const timer = setInterval(() => void loadApprovals(), 5000)
    return () => clearInterval(timer)
  }, [viewFilter])

  async function handleReview(decision: 'approved' | 'rejected') {
    if (!selectedApproval) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetchJson(`/api/workflow/approvals/${selectedApproval.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          reviewer: 'Administrator Zelvira',
          comment: reviewComment.trim(),
        }),
      })

      if (res.ok) {
        setSelectedApproval(null)
        setReviewComment('')
        void loadApprovals()
        onApprovalProcessed?.()
      } else {
        setError(res.error || 'Gagal memproses approval')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading && approvals.length === 0) {
    return <div className="vp-pad text-center text-slate-400 py-12">Memuat Approval Center…</div>
  }

  return (
    <div className="vp-pad flex flex-col gap-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, color: '#f8fafc' }}>Approval Center Otorisasi</h3>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>
            Tinjau tindakan kritis yang memerlukan persetujuan manual administrator sebelum dilanjutkan.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className={`vp-chip-btn ${viewFilter === 'pending' ? 'primary' : ''}`}
            onClick={() => setViewFilter('pending')}
          >
            Menunggu ({approvals.filter((a) => a.status === 'pending').length})
          </button>
          <button
            className={`vp-chip-btn ${viewFilter === 'all' ? 'primary' : ''}`}
            onClick={() => setViewFilter('all')}
          >
            Semua Riwayat
          </button>
        </div>
      </div>

      {error && <div className="vp-err" role="alert">{error}</div>}

      {/* APPROVALS LIST */}
      <div className="flex flex-col gap-3">
        {approvals.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              background: '#0d1319',
              border: '1px dashed #1e293b',
              borderRadius: 8,
              color: '#64748b',
              fontSize: 12,
            }}
          >
            ✅ Tidak ada permintaan approval yang menunggu tindakan saat ini.
          </div>
        ) : (
          approvals.map((appr) => (
            <div
              key={appr.id}
              style={{
                background: appr.status === 'pending' ? '#141d28' : '#0e1620',
                border: appr.status === 'pending' ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid #1e293b',
                borderRadius: 8,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b style={{ fontSize: 14, color: '#f8fafc' }}>{appr.title}</b>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontWeight: 700,
                        background:
                          appr.status === 'pending'
                            ? 'rgba(245, 158, 11, 0.2)'
                            : appr.status === 'approved'
                              ? 'rgba(52, 211, 153, 0.2)'
                              : 'rgba(244, 63, 94, 0.2)',
                        color:
                          appr.status === 'pending'
                            ? '#fbbf24'
                            : appr.status === 'approved'
                              ? '#34d399'
                              : '#f43f5e',
                      }}
                    >
                      {appr.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    Workflow: <b style={{ color: '#38bdf8' }}>{appr.workflowName || 'Workflow'}</b> · Diminta oleh:{' '}
                    <b>{appr.requestedBy}</b> · {new Date(appr.requestedAt).toLocaleString('id-ID')}
                  </div>
                </div>

                {appr.status === 'pending' && (
                  <button
                    className="vp-btn primary"
                    onClick={() => {
                      setSelectedApproval(appr)
                      setReviewComment('')
                    }}
                    style={{ fontSize: 11, padding: '4px 12px' }}
                  >
                    Tinjau Sekarang
                  </button>
                )}
              </div>

              <p style={{ margin: 0, fontSize: 12, color: '#cbd5e1' }}>{appr.description}</p>

              {appr.reviewedBy && (
                <div style={{ fontSize: 10, color: '#64748b', borderTop: '1px solid #1e293b', paddingTop: 6 }}>
                  Ditinjau oleh <b>{appr.reviewedBy}</b> pada {new Date(appr.reviewedAt!).toLocaleString('id-ID')}
                  {appr.reviewComment ? ` · Catatan: "${appr.reviewComment}"` : ''}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* REVIEW ACTION MODAL */}
      {selectedApproval && (
        <div className="vp-modal-backdrop" onClick={() => setSelectedApproval(null)}>
          <div className="vp-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <header className="vp-panel-head">
              <h2>Otorisasi Langkah: {selectedApproval.title}</h2>
              <button className="vp-x" onClick={() => setSelectedApproval(null)} aria-label="Tutup">
                ×
              </button>
            </header>

            <div className="vp-pad flex flex-col gap-3">
              <div style={{ background: '#0e1620', border: '1px solid #1e293b', borderRadius: 6, padding: 10, fontSize: 11, color: '#cbd5e1' }}>
                <div style={{ color: '#94a3b8' }}>Deskripsi Tindakan:</div>
                <div style={{ marginTop: 2 }}>{selectedApproval.description}</div>
              </div>

              <div>
                <label className="vp-sub">CATATAN PENINJAU (OPSIONAL)</label>
                <textarea
                  className="vp-input"
                  rows={3}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Keterangan persetujuan atau alasan penolakan…"
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="vp-btn primary"
                  disabled={busy}
                  onClick={() => handleReview('approved')}
                  style={{ flex: 1, background: '#10b981', borderColor: '#059669' }}
                >
                  {busy ? 'Memproses…' : '✓ Setujui (Lanjutkan Workflow)'}
                </button>
                <button
                  type="button"
                  className="vp-btn"
                  disabled={busy}
                  onClick={() => handleReview('rejected')}
                  style={{ flex: 1, color: '#f43f5e', borderColor: '#e11d48' }}
                >
                  {busy ? 'Memproses…' : '✕ Tolak (Hentikan Workflow)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
