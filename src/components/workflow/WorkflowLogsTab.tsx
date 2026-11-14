'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import type { WorkflowLog } from '@/lib/workflow/types'

export default function WorkflowLogsTab() {
  const [logs, setLogs] = useState<WorkflowLog[]>([])
  const [filterEvent, setFilterEvent] = useState('')
  const [filterExecution, setFilterExecution] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadLogs() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filterEvent) params.append('event', filterEvent)
      if (filterExecution) params.append('executionId', filterExecution)
      params.append('limit', '150')

      const res = await fetchJson<{ logs: WorkflowLog[] }>(`/api/workflow/logs?${params.toString()}`)
      if (res.data?.logs) {
        setLogs(res.data.logs)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadLogs()
  }, [filterEvent, filterExecution])

  const filteredLogs = logs.filter((l) => {
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return (
      l.message.toLowerCase().includes(s) ||
      l.event.toLowerCase().includes(s) ||
      (l.executionId && l.executionId.toLowerCase().includes(s))
    )
  })

  return (
    <div className="vp-pad flex flex-col gap-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, color: '#f8fafc' }}>Workflow Audit Logs</h3>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>
            Catatan peristiwa audit sistem: pembuatan, perubahan, eksekusi step, otorisasi, dan kegagalan.
          </p>
        </div>
        <button className="vp-chip-btn" onClick={loadLogs}>
          ↻ Muat Ulang
        </button>
      </div>

      {error && <div className="vp-err" role="alert">{error}</div>}

      {/* FILTER BAR */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          className="vp-input"
          placeholder="Cari pesan atau ID eksekusi…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: 11 }}
        />

        <select
          className="vp-input"
          value={filterEvent}
          onChange={(e) => setFilterEvent(e.target.value)}
          style={{ fontSize: 11 }}
        >
          <option value="">Semua Jenis Peristiwa</option>
          <option value="workflow_started">workflow_started</option>
          <option value="workflow_completed">workflow_completed</option>
          <option value="workflow_failed">workflow_failed</option>
          <option value="workflow_cancelled">workflow_cancelled</option>
          <option value="step_started">step_started</option>
          <option value="step_completed">step_completed</option>
          <option value="step_retry">step_retry</option>
          <option value="tool_executed">tool_executed</option>
          <option value="approval_requested">approval_requested</option>
          <option value="approval_granted">approval_granted</option>
          <option value="agent_handoff">agent_handoff</option>
        </select>

        <input
          className="vp-input"
          placeholder="Filter ID Eksekusi spesifik…"
          value={filterExecution}
          onChange={(e) => setFilterExecution(e.target.value)}
          style={{ fontSize: 11 }}
        />
      </div>

      {/* LOGS TABLE / FEED */}
      <div
        style={{
          border: '1px solid #1e293b',
          borderRadius: 8,
          background: '#090d14',
          maxHeight: 'calc(100vh - 250px)',
          overflowY: 'auto',
          padding: 8,
          fontSize: 11,
          fontFamily: 'monospace',
        }}
      >
        {loading && logs.length === 0 ? (
          <div className="text-center text-slate-500 py-8">Memuat log…</div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center text-slate-500 py-8">Tidak ada log yang cocok dengan filter.</div>
        ) : (
          filteredLogs.map((l) => (
            <div
              key={l.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '4px 6px',
                borderBottom: '1px solid #141c26',
              }}
            >
              <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>
                {new Date(l.timestamp).toLocaleTimeString('id-ID')}
              </span>
              <span
                style={{
                  color:
                    l.event.includes('completed')
                      ? '#34d399'
                      : l.event.includes('failed')
                        ? '#f43f5e'
                        : l.event.includes('approval')
                          ? '#fbbf24'
                          : '#38bdf8',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                [{l.event}]
              </span>
              {l.executionId && (
                <span style={{ color: '#818cf8', whiteSpace: 'nowrap' }}>
                  ({l.executionId.slice(0, 14)}…)
                </span>
              )}
              <span style={{ color: '#cbd5e1', flex: 1, wordBreak: 'break-word' }}>{l.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
