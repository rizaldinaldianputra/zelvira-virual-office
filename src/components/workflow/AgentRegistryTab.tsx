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
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

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
            Daftar agent resmi yang terdaftar di Hermes Virtual Office. Klik agent untuk membuka detail spesialisasi dan alur kerja.
          </p>
        </div>
        <button className="vp-chip-btn" onClick={loadAgents}>
          ↻ Refresh
        </button>
      </div>

      {error && <div className="vp-err" role="alert">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((ag) => {
          const isOpen = selectedAgent === ag.name
          return (
            <div
              key={ag.name}
              style={{
                background: isOpen ? '#141e2e' : '#111822',
                border: isOpen ? '1px solid #38bdf8' : '1px solid #1e293b',
                borderRadius: 8,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                transition: 'all 0.15s ease',
              }}
            >
              {/* COMPACT ROW: HANYA NAMA & SPESIALISASI */}
              <div
                onClick={() => setSelectedAgent(isOpen ? null : ag.name)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                title="Klik untuk membuka detail agent ini"
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 16 }}>🤖</span>
                    <b style={{ fontSize: 14, color: '#f8fafc' }}>{ag.displayName}</b>
                    <span style={{ fontSize: 11, color: '#38bdf8', fontFamily: 'monospace' }}>({ag.name})</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#a5b4fc', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>Spesialisasi:</span>
                    <b style={{ color: '#f1f5f9' }}>{ag.role}</b>
                    <span style={{ color: '#64748b' }}>·</span>
                    <span style={{ color: '#94a3b8' }}>Divisi {ag.division}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                  <span style={{ fontSize: 11, color: '#64748b' }}>{isOpen ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* DETAIL FORM & WORKFLOWS (HANYA KETIKA DIKLIK) */}
              {isOpen && (
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: 10, marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: '#64748b' }}>Status Operasional:</span>
                      <b style={{ color: '#38bdf8' }}>{ag.status}</b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: '#64748b' }}>Task Kanban Aktif:</span>
                      <span style={{ fontFamily: 'monospace', color: '#f8fafc' }}>{ag.currentTaskId || '— (Siap Tugaskan)'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Partisipasi Workflow:</span>
                      <b style={{ color: ag.workflowCount > 0 ? '#fbbf24' : '#94a3b8' }}>{ag.workflowCount} alur</b>
                    </div>
                  </div>

                  {/* ASSIGNED WORKFLOWS LIST */}
                  <div style={{ marginTop: 6, borderTop: '1px solid #1e293b', paddingTop: 8 }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, fontWeight: 600 }}>
                      Langkah Workflow yang Melibatkan Agent Ini:
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
                              padding: '5px 8px',
                              borderRadius: 4,
                              border: '1px solid #1e293b',
                              color: '#94a3b8',
                              cursor: onNavigateToBuilder ? 'pointer' : 'default',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <span>
                              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{aw.name}</span>: {aw.stepName}
                            </span>
                            {onNavigateToBuilder && <span style={{ color: '#38bdf8', fontSize: 10 }}>Buka ➔</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
