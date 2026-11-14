'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import type { WorkflowExecution } from '@/lib/workflow/types'

export default function WorkflowExecutionsTab() {
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [selectedExec, setSelectedExec] = useState<WorkflowExecution | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  async function loadExecutions() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchJson<{ executions: WorkflowExecution[] }>('/api/workflow/executions?limit=50')
      if (res.data?.executions) {
        setExecutions(res.data.executions)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadExecutions()
    const timer = setInterval(() => void loadExecutions(), 5000)
    return () => clearInterval(timer)
  }, [])

  async function viewDetail(id: string) {
    try {
      const res = await fetchJson<{ execution: WorkflowExecution }>(`/api/workflow/executions/${id}`)
      if (res.data?.execution) {
        setSelectedExec(res.data.execution)
      }
    } catch (e) {
      alert((e as Error).message)
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Batalkan eksekusi workflow ini?')) return
    setCancelling(true)
    try {
      const res = await fetchJson(`/api/workflow/executions/${id}/cancel`, {
        method: 'POST',
      })
      if (res.ok) {
        void loadExecutions()
        if (selectedExec?.id === id) {
          void viewDetail(id)
        }
      } else {
        alert(res.error || 'Gagal membatalkan')
      }
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setCancelling(false)
    }
  }

  function statusBadge(status: string) {
    let bg = '#1e293b'
    let color = '#94a3b8'
    let text = status

    if (status === 'completed') {
      bg = 'rgba(52, 211, 153, 0.2)'
      color = '#34d399'
      text = 'COMPLETED'
    } else if (status === 'running') {
      bg = 'rgba(56, 189, 248, 0.2)'
      color = '#38bdf8'
      text = 'RUNNING'
    } else if (status === 'waiting_approval') {
      bg = 'rgba(245, 158, 11, 0.2)'
      color = '#fbbf24'
      text = 'WAITING APPROVAL'
    } else if (status === 'failed') {
      bg = 'rgba(244, 63, 94, 0.2)'
      color = '#f43f5e'
      text = 'FAILED'
    } else if (status === 'cancelled') {
      bg = 'rgba(148, 163, 184, 0.2)'
      color = '#94a3b8'
      text = 'CANCELLED'
    }

    return (
      <span style={{ background: bg, color, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
        {text}
      </span>
    )
  }

  if (loading && executions.length === 0) {
    return <div className="vp-pad text-center text-slate-400 py-12">Memuat riwayat eksekusi…</div>
  }

  return (
    <div className="vp-pad flex flex-col gap-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, color: '#f8fafc' }}>Riwayat Eksekusi Workflow</h3>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>
            Pantau status eksekusi, durasi waktu, step aktif, dan log detail tiap alur kerja.
          </p>
        </div>
        <button className="vp-chip-btn" onClick={loadExecutions}>
          ↻ Muat Ulang
        </button>
      </div>

      {error && <div className="vp-err" role="alert">{error}</div>}

      {/* EXECUTIONS TABLE */}
      <div style={{ border: '1px solid #1e293b', borderRadius: 8, background: '#0e1620', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, textAlign: 'left' }}>
          <thead>
            <tr style={{ background: '#16222f', color: '#94a3b8', borderBottom: '1px solid #1e293b' }}>
              <th style={{ padding: '8px 12px' }}>ID Eksekusi</th>
              <th style={{ padding: '8px 12px' }}>Nama Workflow</th>
              <th style={{ padding: '8px 12px' }}>Status</th>
              <th style={{ padding: '8px 12px' }}>Waktu Mulai</th>
              <th style={{ padding: '8px 12px' }}>Durasi</th>
              <th style={{ padding: '8px 12px' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {executions.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                  Belum ada riwayat eksekusi workflow.
                </td>
              </tr>
            ) : (
              executions.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#38bdf8' }}>{e.id}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 600, color: '#f1f5f9' }}>{e.workflowName}</td>
                  <td style={{ padding: '8px 12px' }}>{statusBadge(e.status)}</td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8' }}>
                    {new Date(e.startedAt).toLocaleString('id-ID')}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                    {e.durationMs ? `${(e.durationMs / 1000).toFixed(2)}s` : '—'}
                  </td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="vp-chip-btn primary" onClick={() => viewDetail(e.id)}>
                        Detail Tracing
                      </button>
                      {(e.status === 'running' || e.status === 'waiting_approval') && (
                        <button
                          className="vp-chip-btn"
                          disabled={cancelling}
                          onClick={() => handleCancel(e.id)}
                          style={{ color: '#f43f5e' }}
                        >
                          Batal
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* DETAIL MODAL */}
      {selectedExec && (
        <div className="vp-modal-backdrop" onClick={() => setSelectedExec(null)}>
          <div
            className="vp-modal"
            style={{ maxWidth: 840, maxHeight: '85vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="vp-panel-head">
              <div>
                <h2>Detail Eksekusi: {selectedExec.workflowName}</h2>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>ID: {selectedExec.id}</div>
              </div>
              <button className="vp-x" onClick={() => setSelectedExec(null)} aria-label="Tutup">
                ×
              </button>
            </header>

            <div className="vp-pad flex flex-col gap-4">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div>Status: {statusBadge(selectedExec.status)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  Waktu: {new Date(selectedExec.startedAt).toLocaleString('id-ID')}
                </div>
                {selectedExec.durationMs != null && (
                  <div style={{ fontSize: 11, color: '#38bdf8' }}>
                    Durasi: {(selectedExec.durationMs / 1000).toFixed(2)} detik
                  </div>
                )}
              </div>

              {selectedExec.errorMessage && (
                <div className="vp-err" role="alert">
                  <b>Pesan Error:</b> {selectedExec.errorMessage}
                </div>
              )}

              {/* STEP TRACE */}
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#38bdf8' }}>Runtutan Langkah (Step Execution Trace)</h4>
                <div className="flex flex-col gap-2">
                  {(selectedExec.steps || []).map((s, idx) => (
                    <div
                      key={s.id || idx}
                      style={{
                        background: '#0d141e',
                        border: '1px solid #1e293b',
                        borderRadius: 6,
                        padding: 10,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: '#f8fafc' }}>
                          #{idx + 1} {s.stepName}
                          <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 8 }}>
                            (Agent: {s.agentName || 'System'})
                          </span>
                        </div>
                        {statusBadge(s.status)}
                      </div>

                      {s.errorMessage && (
                        <div style={{ color: '#f43f5e', fontSize: 11, marginTop: 4 }}>Error: {s.errorMessage}</div>
                      )}

                      {s.outputData && Object.keys(s.outputData).length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontSize: 10, color: '#64748b' }}>Keluaran Langkah:</div>
                          <pre
                            style={{
                              background: '#060a0f',
                              padding: 6,
                              borderRadius: 4,
                              fontSize: 10,
                              color: '#a5f3fc',
                              overflowX: 'auto',
                              margin: '2px 0 0',
                            }}
                          >
                            {JSON.stringify(s.outputData, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* EXECUTION LOGS */}
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#38bdf8' }}>Log Aktivitas Eksekusi</h4>
                <div
                  style={{
                    background: '#080d14',
                    border: '1px solid #1e293b',
                    borderRadius: 6,
                    padding: 8,
                    maxHeight: 180,
                    overflowY: 'auto',
                    fontSize: 10,
                    fontFamily: 'monospace',
                  }}
                >
                  {(selectedExec.logs || []).map((l) => (
                    <div key={l.id} style={{ padding: '2px 0', borderBottom: '1px solid #111a26' }}>
                      <span style={{ color: '#64748b' }}>[{new Date(l.timestamp).toLocaleTimeString('id-ID')}]</span>{' '}
                      <span style={{ color: '#38bdf8' }}>{l.event}:</span>{' '}
                      <span style={{ color: '#cbd5e1' }}>{l.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
