'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import type { WorkflowTool } from '@/lib/workflow/types'

type AgentItem = { name: string; displayName: string }

export default function ToolRegistryTab() {
  const [tools, setTools] = useState<WorkflowTool[]>([])
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [permissions, setPermissions] = useState<Map<string, boolean>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingPerm, setSavingPerm] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [resTools, resAgents] = await Promise.all([
        fetchJson<{ tools: WorkflowTool[]; permissions: { toolId: string; agentName: string; allowed: boolean }[] }>('/api/workflow/tools'),
        fetchJson<{ agents: AgentItem[] }>('/api/workflow/agents'),
      ])

      if (resTools.data?.tools) setTools(resTools.data.tools)
      if (resAgents.data?.agents) setAgents(resAgents.data.agents)

      const permMap = new Map<string, boolean>()
      for (const p of resTools.data?.permissions || []) {
        permMap.set(`${p.toolId}::${p.agentName}`, p.allowed)
      }
      setPermissions(permMap)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  async function togglePermission(toolId: string, agentName: string, current: boolean) {
    const key = `${toolId}::${agentName}`
    const nextVal = !current
    setSavingPerm(key)

    try {
      const res = await fetchJson('/api/workflow/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolId,
          agentName,
          allowed: nextVal,
        }),
      })

      if (res.ok) {
        setPermissions((prev) => {
          const m = new Map(prev)
          m.set(key, nextVal)
          return m
        })
      } else {
        alert(res.error || 'Gagal mengubah izin tool')
      }
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setSavingPerm(null)
    }
  }

  function riskBadge(level: string) {
    let bg = '#1e293b'
    let color = '#94a3b8'

    if (level === 'critical' || level === 'high') {
      bg = 'rgba(244, 63, 94, 0.2)'
      color = '#f43f5e'
    } else if (level === 'medium') {
      bg = 'rgba(245, 158, 11, 0.2)'
      color = '#fbbf24'
    } else {
      bg = 'rgba(52, 211, 153, 0.2)'
      color = '#34d399'
    }

    return (
      <span style={{ background: bg, color, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
        {level} RISK
      </span>
    )
  }

  if (loading) {
    return <div className="vp-pad text-center text-slate-400 py-12">Memuat Tool Registry…</div>
  }

  return (
    <div className="vp-pad flex flex-col gap-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, color: '#f8fafc' }}>Tool Registry & Otorisasi Izin</h3>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>
            Kelola alat kemampuan agen dan batasi hak akses operasi berisiko tinggi per-agent.
          </p>
        </div>
        <button className="vp-chip-btn" onClick={loadData}>
          ↻ Muat Ulang
        </button>
      </div>

      {error && <div className="vp-err" role="alert">{error}</div>}

      <div className="flex flex-col gap-3">
        {tools.map((t) => (
          <div
            key={t.id}
            style={{
              background: '#111822',
              border: '1px solid #1e293b',
              borderRadius: 8,
              padding: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <b style={{ fontSize: 14, color: '#f8fafc' }}>{t.displayName}</b>
                  <code style={{ fontSize: 10, color: '#38bdf8', background: '#0a1017', padding: '1px 5px', borderRadius: 3 }}>
                    {t.name}
                  </code>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8' }}>{t.description}</p>
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {riskBadge(t.riskLevel)}
                {t.requiresApproval && (
                  <span style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
                    WAJIB APPROVAL
                  </span>
                )}
              </div>
            </div>

            {/* PERMISSIONS CHECKLIST PER AGENT */}
            <div style={{ marginTop: 10, borderTop: '1px solid #1e293b', paddingTop: 8 }}>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>Izin Akses per Agent:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {agents.map((ag) => {
                  const key = `${t.id}::${ag.name}`
                  const allowed = permissions.has(key) ? permissions.get(key)! : true
                  const isBusy = savingPerm === key

                  return (
                    <label
                      key={ag.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: allowed ? '#1e293b' : '#0a0f16',
                        border: allowed ? '1px solid #38bdf8' : '1px solid #1e293b',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        color: allowed ? '#f8fafc' : '#64748b',
                        cursor: isBusy ? 'wait' : 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={allowed}
                        disabled={isBusy}
                        onChange={() => togglePermission(t.id, ag.name, allowed)}
                      />
                      <span>{ag.displayName}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
