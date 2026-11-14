'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'

type AgentRegistryItem = {
  name: string
  displayName: string
  role: string
  division: string
  status: string
  currentTaskId: string | null
  assignedWorkflows: { id: string; name: string; stepName: string }[]
  workflowCount: number
}

export default function AgentRegistryTab({
  onNavigateToBuilder,
}: {
  onNavigateToBuilder?: (wfId: string) => void
}) {
  const [agents, setAgents] = useState<AgentRegistryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadAgents() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchJson<{ agents: AgentRegistryItem[] }>('/api/workflow/agents')
      if (res.data?.agents) {
        setAgents(res.data.agents)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAgents()
  }, [])

  if (loading) {
    return <div className="vp-pad text-center text-slate-400 py-12">Memuat Agent Registry…</div>
  }

  return (
    <div className="vp-pad flex flex-col gap-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, color: '#f8fafc' }}>Integrasi Agent Registry Hermes</h3>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>
            Daftar agent resmi yang terdaftar di Hermes Virtual Office beserta alokasi langkah alur kerja.
          </p>
        </div>
        <button className="vp-chip-btn" onClick={loadAgents}>
          ↻ Refresh
        </button>
      </div>

      {error && <div className="vp-err" role="alert">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((ag) => (
          <div
            key={ag.name}
            style={{
              background: '#111822',
              border: '1px solid #1e293b',
              borderRadius: 8,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <b style={{ fontSize: 14, color: '#f8fafc' }}>{ag.displayName}</b>
                <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 1 }}>{ag.name}</div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: ag.status === 'working' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(52, 211, 153, 0.2)',
                  color: ag.status === 'working' ? '#38bdf8' : '#34d399',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}
              >
                {ag.status}
              </span>
            </div>

            <div style={{ fontSize: 11, color: '#cbd5e1' }}>
              <div>
                <span style={{ color: '#64748b' }}>Peran / Role:</span> {ag.role}
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Divisi:</span> {ag.division}
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Workflow Ditugaskan:</span>{' '}
                <b style={{ color: ag.workflowCount > 0 ? '#fbbf24' : '#94a3b8' }}>{ag.workflowCount} alur</b>
              </div>
            </div>

            {/* ASSIGNED WORKFLOWS LIST */}
            <div style={{ marginTop: 4, borderTop: '1px solid #1e293b', paddingTop: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, fontWeight: 600 }}>
                Partisipasi Langkah Workflow:
              </div>
              {ag.assignedWorkflows.length === 0 ? (
                <div style={{ fontSize: 10, color: '#475569', fontStyle: 'italic' }}>
                  Belum ada langkah workflow yang menugaskan agent ini.
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {ag.assignedWorkflows.map((aw, idx) => (
                    <div
                      key={idx}
                      onClick={() => onNavigateToBuilder?.(aw.id)}
                      style={{
                        fontSize: 10,
                        background: '#0a1017',
                        padding: '4px 6px',
                        borderRadius: 4,
                        border: '1px solid #1e293b',
                        color: '#94a3b8',
                        cursor: onNavigateToBuilder ? 'pointer' : 'default',
                      }}
                    >
                      <span style={{ color: '#38bdf8', fontWeight: 600 }}>{aw.name}</span>: {aw.stepName}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
