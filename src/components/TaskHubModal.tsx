'use client'

import { useEffect, useMemo, useState } from 'react'
import { useOffice } from '@/lib/store'
import FullPanel from './FullPanel'
import KanbanColumns from './KanbanColumns'
import { fetchJson } from '@/lib/api'
import type { Agent, Task } from '@/types/hermes'
import { DIVISION_LABEL } from '@/types/hermes'

interface RunInfo {
  id: number
  profile: string
  status: string
  outcome?: string | null
  startedAt?: number
  endedAt?: number | null
  summary?: string | null
  error?: string | null
}

export default function TaskHubModal({
  open,
  onClose,
  onNewTask,
  onOpenChat,
}: {
  open: boolean
  onClose: () => void
  onNewTask: (prefillAssignee?: string) => void
  onOpenChat?: (agentName: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'tasks' | 'agents'>('tasks')
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null)
  const [agentSearch, setAgentSearch] = useState('')
  const [divisionFilter, setDivisionFilter] = useState<string>('all')

  const tasks = useOffice((s) => s.tasks)
  const agents = useOffice((s) => s.agents)
  const selectAgentInStore = useOffice((s) => s.select)
  const openTask = useOffice((s) => s.openTask)

  // Status & activity logs state for selected agent
  const [agentTaskLog, setAgentTaskLog] = useState<string>('')
  const [agentRuns, setAgentRuns] = useState<RunInfo[]>([])
  const [logLoading, setLogLoading] = useState(false)

  // Auto-select first agent if none selected
  useEffect(() => {
    if (!selectedAgentName && agents.length > 0) {
      setSelectedAgentName(agents[0].name)
    }
  }, [agents, selectedAgentName])

  const selectedAgent = useMemo(() => {
    return agents.find((a) => a.name === selectedAgentName) || agents[0] || null
  }, [agents, selectedAgentName])

  // Filter tasks assigned to selected agent
  const agentTasks = useMemo(() => {
    if (!selectedAgent) return []
    return tasks.filter((t) => t.assignee?.toLowerCase() === selectedAgent.name.toLowerCase())
  }, [tasks, selectedAgent])

  // Current active task of selected agent
  const activeTask = useMemo(() => {
    if (!selectedAgent) return undefined
    if (selectedAgent.currentTaskId) {
      return tasks.find((t) => t.id === selectedAgent.currentTaskId)
    }
    return agentTasks.find((t) => t.status === 'running') || agentTasks.find((t) => t.status === 'review')
  }, [selectedAgent, agentTasks, tasks])

  // Load task run logs and terminal output when active task changes or agent changes
  useEffect(() => {
    if (!open || activeTab !== 'agents' || !selectedAgent) return

    const targetTaskId = activeTask?.id || agentTasks[0]?.id
    if (!targetTaskId) {
      setAgentTaskLog('')
      setAgentRuns([])
      return
    }

    let alive = true
    setLogLoading(true)

    fetchJson<{ runs?: RunInfo[]; log?: string; task?: Task }>(`/api/hermes/tasks/${targetTaskId}`, {
      cache: 'no-store',
    })
      .then((res) => {
        if (!alive) return
        if (res.ok && res.data) {
          setAgentTaskLog(res.data.log || res.data.task?.body || '')
          setAgentRuns(res.data.runs || [])
        } else {
          setAgentTaskLog(activeTask?.body || 'Belum ada log aktifitas.')
          setAgentRuns([])
        }
      })
      .catch(() => {
        if (alive) {
          setAgentTaskLog(activeTask?.body || 'Log aktifitas tidak dapat dimuat.')
          setAgentRuns([])
        }
      })
      .finally(() => {
        if (alive) setLogLoading(false)
      })

    return () => {
      alive = false
    }
  }, [open, activeTab, selectedAgent, activeTask, agentTasks])

  // Filter agents list
  const filteredAgents = useMemo(() => {
    return agents.filter((a) => {
      const matchSearch =
        !agentSearch ||
        a.displayName.toLowerCase().includes(agentSearch.toLowerCase()) ||
        a.name.toLowerCase().includes(agentSearch.toLowerCase()) ||
        a.role.toLowerCase().includes(agentSearch.toLowerCase())
      const matchDivision = divisionFilter === 'all' || a.division === divisionFilter
      return matchSearch && matchDivision
    })
  }, [agents, agentSearch, divisionFilter])

  if (!open) return null

  const getStatusColor = (status: Agent['status']) => {
    switch (status) {
      case 'working':
        return {
          badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
          dot: 'bg-emerald-400 shadow-[0_0_8px_#34d399]',
          label: 'Sedang Bekerja',
        }
      case 'review':
        return {
          badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
          dot: 'bg-purple-400 shadow-[0_0_8px_#c084fc]',
          label: 'Dalam Review',
        }
      case 'meeting':
        return {
          badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
          dot: 'bg-indigo-400 shadow-[0_0_8px_#818cf8]',
          label: 'Sedang Rapat',
        }
      default:
        return {
          badge: 'bg-slate-700/50 text-slate-300 border-slate-600/50',
          dot: 'bg-slate-400',
          label: 'Siaga / Idle',
        }
    }
  }

  const focusAgentIn3D = (agentName: string) => {
    selectAgentInStore(agentName)
    onClose()
  }

  return (
    <FullPanel
      onClose={onClose}
      label="Pusat Tugas & Agent"
      variant="slate"
      className="max-w-6xl w-full"
      title={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
                <path d="M15 3v18" />
              </svg>
            </span>
            <div>
              <div className="text-sm font-bold text-white leading-tight">Pusat Manajemen Tugas & Agent</div>
              <div className="text-[10px] text-slate-400">Monitoring real-time aktifitas kerja AI Virtual Office</div>
            </div>
          </div>
        </div>
      }
      actions={
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20"
            onClick={() => onNewTask(selectedAgent?.name)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>+ Buat Tugas Baru</span>
          </button>
        </div>
      }
      bodyClassName="flex flex-col p-0 overflow-hidden"
    >
      {/* ------------------------------------------------ Tabbar Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6 py-2.5">
        <div className="flex items-center gap-2">
          <button
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'tasks'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
            onClick={() => setActiveTab('tasks')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <span>📋 Daftar Tugas</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
              {tasks.length}
            </span>
          </button>

          <button
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'agents'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-400/50 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
            onClick={() => setActiveTab('agents')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>👥 List Agent & Log Aktifitas</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/30 text-sky-200 border border-sky-400/40">
              {agents.length}
            </span>
          </button>
        </div>

        <div className="text-xs text-slate-400 hidden sm:block">
          {activeTab === 'tasks' ? (
            <span>Klik kartu tugas untuk melihat log pengerjaan lengkap</span>
          ) : (
            <span>Pilih nama agent untuk melihat status realtime & log terminal</span>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ Tab Content */}
      <div className="flex-1 overflow-y-auto min-h-[480px]">
        {activeTab === 'tasks' ? (
          /* ============================================== TAB 1: KANBAN TASKS */
          <div className="p-6">
            <KanbanColumns search freshness closeAfterOpen={onClose} />
          </div>
        ) : (
          /* ============================================== TAB 2: LIST AGENT */
          <div className="grid grid-cols-1 md:grid-cols-12 h-full min-h-[520px]">
            {/* Left Column: Agent Directory */}
            <div className="md:col-span-5 border-r border-slate-800/80 bg-slate-950/40 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Cari nama / peran agent…"
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  className="vp-input w-full text-xs"
                />
              </div>

              {/* Division filter pills */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
                    divisionFilter === 'all'
                      ? 'bg-slate-700 text-white font-bold'
                      : 'bg-slate-800/50 text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => setDivisionFilter('all')}
                >
                  Semua ({agents.length})
                </button>
                {(['exec', 'tech', 'growth', 'content'] as const).map((div) => {
                  const count = agents.filter((a) => a.division === div).length
                  if (count === 0) return null
                  return (
                    <button
                      key={div}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
                        divisionFilter === div
                          ? 'bg-sky-600/40 text-sky-200 font-bold border border-sky-500/40'
                          : 'bg-slate-800/50 text-slate-400 hover:text-slate-200'
                      }`}
                      onClick={() => setDivisionFilter(div)}
                    >
                      {DIVISION_LABEL[div].split(' ')[0]} ({count})
                    </button>
                  )
                })}
              </div>

              {/* Agent Cards List */}
              <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1 max-h-[500px]">
                {filteredAgents.map((a) => {
                  const isSelected = selectedAgent?.name === a.name
                  const sc = getStatusColor(a.status)
                  const taskCount = tasks.filter((t) => t.assignee?.toLowerCase() === a.name.toLowerCase()).length
                  const activeT = tasks.find((t) => t.id === a.currentTaskId)

                  return (
                    <button
                      key={a.name}
                      onClick={() => setSelectedAgentName(a.name)}
                      className={`text-left p-3 rounded-xl border transition-all flex flex-col gap-2 ${
                        isSelected
                          ? 'bg-slate-800/90 border-sky-400/80 shadow-md shadow-sky-500/10'
                          : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/50 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="relative">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-700 to-slate-800 border border-slate-600 flex items-center justify-center text-xs font-bold text-white uppercase">
                              {a.displayName.slice(0, 2)}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${sc.dot}`} />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-white flex items-center gap-1.5">
                              <span>{a.displayName}</span>
                              <span className="text-[10px] text-slate-400 font-mono font-normal">@{a.name}</span>
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {a.role} · <span className="text-slate-500">{DIVISION_LABEL[a.division || 'tech']?.split(' ')[0]}</span>
                            </div>
                          </div>
                        </div>

                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${sc.badge}`}>
                          {sc.label}
                        </span>
                      </div>

                      {/* Active task preview */}
                      {activeT ? (
                        <div className="text-[11px] bg-slate-950/60 px-2 py-1.5 rounded-lg border border-slate-800/60 text-slate-300 truncate flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="truncate">{activeT.title}</span>
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-500 px-1">
                          {taskCount > 0 ? `${taskCount} riwayat tugas` : 'Belum ada tugas'}
                        </div>
                      )}
                    </button>
                  )
                })}

                {filteredAgents.length === 0 && (
                  <div className="text-center py-8 text-xs text-slate-500">
                    Tidak ada agent yang cocok dengan pencarian
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Selected Agent Detail & Activity Log */}
            <div className="md:col-span-7 p-5 flex flex-col gap-4 overflow-y-auto max-h-[580px] bg-slate-900/30">
              {selectedAgent ? (
                <>
                  {/* Agent Header & Quick Actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-600 to-indigo-700 border border-sky-400/40 flex items-center justify-center text-base font-extrabold text-white uppercase shadow-md">
                          {selectedAgent.displayName.slice(0, 2)}
                        </div>
                        <span className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-slate-900 ${getStatusColor(selectedAgent.status).dot}`} />
                      </div>
                      <div>
                        <div className="text-sm font-extrabold text-white flex items-center gap-2">
                          <span>{selectedAgent.displayName}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getStatusColor(selectedAgent.status).badge}`}>
                            {getStatusColor(selectedAgent.status).label}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 font-medium">
                          Peran: <b className="text-slate-200">{selectedAgent.role}</b> · Divisi: <b className="text-slate-200">{DIVISION_LABEL[selectedAgent.division || 'tech']}</b>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          Model Default: <span className="text-sky-300 font-semibold">{selectedAgent.model || 'hermes-default'}</span>
                        </div>
                        {selectedAgent.description && (
                          <div className="text-[11px] text-slate-300 mt-1.5 bg-slate-800/80 p-2 rounded-lg border border-slate-700/60">
                            <span className="text-slate-400 font-bold block text-[10px] uppercase tracking-wider mb-0.5">Job Desk / Tanggung Jawab:</span>
                            <span className="leading-relaxed">{selectedAgent.description}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quick action buttons */}
                    <div className="flex items-center gap-1.5 self-end sm:self-center">
                      <button
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-500/20 border border-sky-400/40 text-sky-200 hover:bg-sky-500/30 text-xs font-semibold transition-all"
                        onClick={() => focusAgentIn3D(selectedAgent.name)}
                        title="Fokus Kamera & Sorot Avatar Agent di Kantor 3D"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>Fokus 3D</span>
                      </button>

                      <button
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/30 text-xs font-semibold transition-all"
                        onClick={() => {
                          onClose()
                          if (onOpenChat) onOpenChat(selectedAgent.name)
                        }}
                        title="Mulai Live Chat dengan Agent"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        <span>Chat</span>
                      </button>

                      <button
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/30 text-xs font-semibold transition-all"
                        onClick={() => onNewTask(selectedAgent.name)}
                        title="Beri Tugas Baru Langsung ke Agent Ini"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        <span>Tugas</span>
                      </button>
                    </div>
                  </div>

                  {/* ----------------- SECTION 1: Status si Agent Sekarang */}
                  <div className="flex flex-col gap-2.5 p-4 rounded-xl bg-slate-800/30 border border-slate-700/40">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${getStatusColor(selectedAgent.status).dot}`} />
                        Status si Agent Sekarang
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Lokasi: {selectedAgent.deskIndex != null ? `Desk #${selectedAgent.deskIndex} (Lantai Dasar)` : 'Ruang Eksekutif / Selasar'}
                      </span>
                    </div>

                    {activeTask ? (
                      <div className="p-3 rounded-lg bg-slate-900/80 border border-emerald-500/30 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-emerald-400 tracking-wider uppercase">TUGAS AKTIF SEDANG DIKERJAKAN</span>
                          <span className="text-[10px] text-slate-400 font-mono">ID: {activeTask.id}</span>
                        </div>
                        <div className="text-xs font-bold text-white">{activeTask.title}</div>
                        {activeTask.body && (
                          <div className="text-[11px] text-slate-300 line-clamp-2">{activeTask.body}</div>
                        )}
                        <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[10px] text-slate-400">
                          <span>Status: <b className="text-emerald-300 uppercase">{activeTask.status}</b></span>
                          <button
                            className="text-sky-400 hover:text-sky-300 font-bold underline"
                            onClick={() => {
                              onClose()
                              openTask(activeTask.id)
                            }}
                          >
                            Buka Detail Tugas Lengkap →
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
                        Saat ini agent berstatus <b>{getStatusColor(selectedAgent.status).label}</b> dan siap menerima tugas baru.
                      </div>
                    )}

                    {/* Agent capabilities & SOUL summary */}
                    {selectedAgent.domains && selectedAgent.domains.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[10px] text-slate-500 font-semibold">Keahlian:</span>
                        {selectedAgent.domains.map((dom) => (
                          <span key={dom} className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                            {dom}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ----------------- SECTION 2: Informasi Log Aktifitas si Agent */}
                  <div className="flex flex-col gap-2.5 p-4 rounded-xl bg-slate-800/30 border border-slate-700/40">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400">
                          <polyline points="4 17 10 11 4 5" />
                          <line x1="12" y1="19" x2="20" y2="19" />
                        </svg>
                        Informasi Log Aktifitas & Output Eksekusi
                      </span>
                      {logLoading && <span className="text-[10px] text-sky-400 animate-pulse">Memuat log…</span>}
                    </div>

                    {/* Terminal Output Viewer */}
                    <div className="relative rounded-lg bg-[#060b14] border border-slate-800 p-3 font-mono text-[11px] text-emerald-400 min-h-[160px] max-h-[240px] overflow-y-auto">
                      {agentTaskLog ? (
                        <pre className="whitespace-pre-wrap leading-relaxed select-text font-mono">
                          {agentTaskLog}
                        </pre>
                      ) : (
                        <div className="text-slate-500 flex flex-col items-center justify-center h-full min-h-[120px] text-center">
                          <span>Tidak ada log terminal realtime untuk agent ini saat ini.</span>
                          <span className="text-[10px] text-slate-600 mt-1">Log akan otomatis muncul saat agent sedang mengeksekusi perintah.</span>
                        </div>
                      )}
                    </div>

                    {/* Timeline Riwayat Pekerjaan Agent */}
                    <div className="mt-2 flex flex-col gap-2">
                      <div className="text-[11px] font-bold text-slate-300">Riwayat Tugas Ditugaskan ({agentTasks.length})</div>
                      <div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto">
                        {agentTasks.map((t) => (
                          <div
                            key={t.id}
                            className="p-2 rounded bg-slate-900/60 border border-slate-800/60 flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  t.status === 'done'
                                    ? 'bg-emerald-400'
                                    : t.status === 'running'
                                    ? 'bg-sky-400 animate-pulse'
                                    : t.status === 'review'
                                    ? 'bg-purple-400'
                                    : 'bg-slate-500'
                                }`}
                              />
                              <span className="text-slate-200 font-medium truncate">{t.title}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400 shrink-0">
                              <span className="uppercase font-semibold">{t.status}</span>
                              <button
                                className="text-sky-400 hover:text-sky-300 underline"
                                onClick={() => {
                                  onClose()
                                  openTask(t.id)
                                }}
                              >
                                Lihat
                              </button>
                            </div>
                          </div>
                        ))}

                        {agentTasks.length === 0 && (
                          <div className="text-[11px] text-slate-500 p-2">Belum ada riwayat tugas untuk agent ini.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-500 text-xs">
                  Pilih agent di sebelah kiri untuk melihat informasi status dan log aktifitas
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </FullPanel>
  )
}
