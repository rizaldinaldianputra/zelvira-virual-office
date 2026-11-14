'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import type { Workflow, WorkflowDashboardStats } from '@/lib/workflow/types'

export default function WorkflowDashboardTab({
  onNavigate,
}: {
  onNavigate: (tab: string, context?: { workflowId?: string }) => void
}) {
  const [stats, setStats] = useState<WorkflowDashboardStats | null>(null)
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [triggering, setTriggering] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [resStats, resWf] = await Promise.all([
        fetchJson<{ stats: WorkflowDashboardStats }>('/api/workflow/dashboard'),
        fetchJson<{ workflows: Workflow[] }>('/api/workflow/workflows'),
      ])
      if (resStats.data?.stats) setStats(resStats.data.stats)
      if (resWf.data?.workflows) setWorkflows(resWf.data.workflows)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  async function handleQuickRun(wfId: string) {
    setTriggering(wfId)
    try {
      const res = await fetchJson<{ execution: { id: string } }>(`/api/workflow/workflows/${wfId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        onNavigate('executions')
      } else {
        alert(res.error || 'Gagal menjalankan workflow')
      }
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setTriggering(null)
    }
  }

  if (loading) {
    return <div className="vp-pad text-center text-slate-400 py-12">Memuat Workflow Dashboard…</div>
  }

  return (
    <div className="vp-pad flex flex-col gap-5">
      {error && <div className="vp-err" role="alert">{error}</div>}

      {/* METRIC CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div style={{ background: '#131b24', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Workflow</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#38bdf8', marginTop: 4 }}>{stats?.totalWorkflows ?? 0}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{stats?.activeWorkflows ?? 0} aktif</div>
        </div>

        <div style={{ background: '#131b24', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Eksekusi</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#f8fafc', marginTop: 4 }}>{stats?.totalExecutions ?? 0}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{stats?.runningExecutions ?? 0} sedang berjalan</div>
        </div>

        <div style={{ background: '#131b24', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Selesai / Berhasil</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#34d399', marginTop: 4 }}>{stats?.completedExecutions ?? 0}</div>
          <div style={{ fontSize: 11, color: '#f43f5e', marginTop: 2 }}>{stats?.failedExecutions ?? 0} gagal</div>
        </div>

        <div
          onClick={() => (stats?.waitingApproval ? onNavigate('approvals') : null)}
          style={{
            background: stats?.waitingApproval ? 'rgba(245, 158, 11, 0.12)' : '#131b24',
            border: stats?.waitingApproval ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid #1e293b',
            borderRadius: 8,
            padding: '12px 16px',
            cursor: stats?.waitingApproval ? 'pointer' : 'default',
          }}
        >
          <div style={{ fontSize: 11, color: stats?.waitingApproval ? '#fbbf24' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Menunggu Approval
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: stats?.waitingApproval ? '#f59e0b' : '#94a3b8', marginTop: 4 }}>
            {stats?.waitingApproval ?? 0}
          </div>
          <div style={{ fontSize: 11, color: stats?.waitingApproval ? '#fbbf24' : '#64748b', marginTop: 2 }}>
            {stats?.waitingApproval ? 'Klik untuk tinjau →' : 'Semua aman'}
          </div>
        </div>
      </div>

      {/* QUICK LAUNCH & WORKFLOW LIST */}
      <div style={{ background: '#131b24', border: '1px solid #1e293b', borderRadius: 8, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, color: '#f8fafc' }}>Workflow Aktif</h3>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>Jalankan atau kelola alur kerja otomatis antar-agent.</p>
          </div>
          <button
            className="vp-btn primary"
            onClick={() => onNavigate('builder')}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            + Buat Workflow Baru
          </button>
        </div>

        {workflows.length === 0 ? (
          <div className="text-center text-slate-500 py-6 text-xs">Belum ada workflow yang dibuat.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {workflows.slice(0, 5).map((wf) => (
              <div
                key={wf.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: '#0d1319',
                  border: '1px solid #1e293b',
                  borderRadius: 6,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>{wf.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    {wf.description || 'Tidak ada deskripsi'} · <span style={{ color: '#38bdf8' }}>{wf.stepCount} Langkah</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className="vp-chip-btn"
                    onClick={() => onNavigate('builder', { workflowId: wf.id })}
                    style={{ fontSize: 11 }}
                  >
                    Edit
                  </button>
                  <button
                    className="vp-btn primary"
                    onClick={() => handleQuickRun(wf.id)}
                    disabled={triggering === wf.id}
                    style={{ fontSize: 11, padding: '4px 10px' }}
                  >
                    {triggering === wf.id ? 'Memulai…' : '▶ Jalankan'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RECENT ACTIVITY LOG STREAM */}
      <div style={{ background: '#131b24', border: '1px solid #1e293b', borderRadius: 8, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, color: '#f8fafc' }}>Aktivitas Workflow Terkini</h3>
          <button className="vp-chip-btn" onClick={() => onNavigate('logs')}>
            Lihat Semua Log →
          </button>
        </div>

        {(!stats?.recentActivities || stats.recentActivities.length === 0) ? (
          <div className="text-center text-slate-500 py-6 text-xs">Belum ada aktivitas workflow tercatat.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {stats.recentActivities.map((act) => (
              <div
                key={act.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  fontSize: 11,
                  padding: '6px 8px',
                  borderBottom: '1px solid #1e293b',
                }}
              >
                <span
                  style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    background:
                      act.event.includes('completed')
                        ? 'rgba(52, 211, 153, 0.2)'
                        : act.event.includes('failed')
                          ? 'rgba(244, 63, 94, 0.2)'
                          : act.event.includes('approval')
                            ? 'rgba(245, 158, 11, 0.2)'
                            : '#1e293b',
                    color:
                      act.event.includes('completed')
                        ? '#34d399'
                        : act.event.includes('failed')
                          ? '#f43f5e'
                          : act.event.includes('approval')
                            ? '#fbbf24'
                            : '#94a3b8',
                  }}
                >
                  {act.event}
                </span>
                <div style={{ flex: 1, color: '#cbd5e1' }}>{act.message}</div>
                <div style={{ color: '#64748b', fontSize: 10 }}>
                  {new Date(act.timestamp).toLocaleTimeString('id-ID')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
