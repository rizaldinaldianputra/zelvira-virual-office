'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Kanban2D from './Kanban2D'
import SpriteOffice from './SpriteOffice'
import PeekPanel from './PeekPanel'
import TaskPanel from './TaskPanel'
import MeetingPanel from './MeetingPanel'
import AgentSpawnPanel from './AgentSpawnPanel'
import CronPanel from './CronPanel'
import SystemPanel from './SystemPanel'
import BoardPanel from './BoardPanel'
import ChatPanel from './ChatPanel'
import NewTaskDialog from './NewTaskDialog'
import TaskHubModal from './TaskHubModal'
import KanbanModal from './KanbanModal'
import OfficeNameDialog from './OfficeNameDialog'
import WorkflowEnginePanel from './workflow/WorkflowEnginePanel'
import { startPolling, useOffice } from '@/lib/store'
import type { OfficeScene } from '@/lib/office/scene'
import type { AgentDivision } from '@/types/hermes'
import { LOGO_DATA_URI } from '@/lib/office/logoBase64'

/**
 * The 3D scene is the only consumer of three.js, which is the bulk of this app's
 * JavaScript. Loading it lazily means a visitor who stays on Kanban or Sprite
 * never downloads it — measured on the route: 278 kB before, 175 kB after the
 * scene moved out of the initial bundle.
 */
const Scene3D = dynamic(() => import('./Scene3D'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center vp-muted">memuat ruangan…</div>,
})

export default function OfficeApp() {
  const view = useOffice((s) => s.view)
  const setView = useOffice((s) => s.setView)
  const setNewTaskOpen = useOffice((s) => s.setNewTaskOpen)
  const tasks = useOffice((s) => s.tasks)
  const agents = useOffice((s) => s.agents)
  const error = useOffice((s) => s.error)
  const meeting = useOffice((s) => s.meeting)
  const select = useOffice((s) => s.select)
  const selected = useOffice((s) => s.selectedAgent)
  const loadTasks = useOffice((s) => s.load)

  const sceneRef = useRef<OfficeScene | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLElement>(null)
  const [meetOpen, setMeetOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [cronOpen, setCronOpen] = useState(false)
  const [systemOpen, setSystemOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [boardOpen, setBoardOpen] = useState(false)
  const [nameOpen, setNameOpen] = useState(false)
  const [taskHubOpen, setTaskHubOpen] = useState(false)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  const toggleFullscreen = () => {
    if (typeof document === 'undefined') return
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }
  const loadOffice = useOffice((s) => s.loadOffice)

  useEffect(() => startPolling(), [])

  // Tinggi top bar TIDAK tetap: di layar sempit tombolnya pindah ke baris kedua, dan
  // angka status berubah panjang. Diukur langsung lalu diberikan ke CSS, supaya
  // kanvas dan panel samping mulai tepat di bawahnya alih-alih menebak 58px.
  useEffect(() => {
    const bar = barRef.current
    const root = rootRef.current
    if (!bar || !root) return
    const ro = new ResizeObserver(() => root.style.setProperty('--vp-topbar-h', `${bar.offsetHeight}px`))
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  // request browser notification permission once, then alert on review/blocked
  const seen = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    for (const t of tasks) {
      const prev = seen.current.get(t.id)
      if (prev && prev !== t.status && (t.status === 'review' || t.status === 'blocked')) {
        new Notification(`Kanban · ${t.status}`, { body: t.title })
      }
      seen.current.set(t.id, t.status)
    }
  }, [tasks])

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (e.key === 'm' || e.key === 'M') setMeetOpen((v) => !v)
      if (e.key === 'n' || e.key === 'N') setNewTaskOpen(true)
      if (e.key === 'c' || e.key === 'C') setChatOpen((v) => !v)
      if (e.key === 'w' || e.key === 'W') setWorkflowOpen((v) => !v)
      if (e.key === '3') setView('3d')
      if (e.key === '2') setView('2d')
      if (e.key === '1') setView('sprite')
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [setView, setNewTaskOpen])

  const backendOnline = !error
  // Archived tasks are on the board (the 2D view has an ARSIP column) but they
  // are not progress: counting them would deflate the release figure.
  const live = tasks.filter((t) => t.status !== 'archived')
  const running = live.filter((t) => t.status === 'running').length
  const done = live.filter((t) => t.status === 'done').length
  const pct = live.length ? Math.round((done / live.length) * 100) : 0

  return (
    <div ref={rootRef} className="relative h-dvh w-full overflow-hidden bg-[#0f1418]">
      <main className="vp-stage">
        {view === '3d' ? (
          <Scene3D
            onScene={(s) => {
              sceneRef.current = s
            }}
            onDummy={() => setAgentOpen(true)}
            onBoard={() => setBoardOpen(true)}
            onName={() => setNameOpen(true)}
          />
        ) : view === 'sprite' ? (
          <SpriteOffice onSelect={select} />
        ) : (
          <Kanban2D />
        )}
      </main>

      {/* ------------------------------------------------------- top bar */}
      <header ref={barRef} className="vp-topbar">
        {/* Brand logo & Live status */}
        <div className="vp-topbar-brand flex items-center gap-3">
          
          <div className="hidden sm:block h-5 w-px bg-slate-700/60" />

          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 shadow-inner">
            <span className="relative flex h-2 w-2">
              {backendOnline && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${backendOnline ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-rose-500 shadow-[0_0_6px_#f43f5e]'}`} />
            </span>
            <span className="text-[11px] font-bold text-slate-200">
              {backendOnline ? 'Online' : 'Offline'}
            </span>
            <span className="text-slate-500 text-[10px]">·</span>
            <span className="text-[11px] font-medium text-slate-400 vp-topbar-status">
              {backendOnline ? `${agents.length} agent · ${running} jalan · ${pct}% rilis` : 'backend offline'}
            </span>
          </div>
        </div>

        {/* Tabbar Navigation */}
        <nav className="vp-topbar-nav flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5" aria-label="Panel">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 hover:border-emerald-400 transition-all shadow-sm"
            onClick={() => setTaskHubOpen(true)}
            title="Buka Pusat Manajemen Tugas & List Agent"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Tugas</span>
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800/70 border border-slate-700/70 text-slate-200 hover:bg-slate-700/80 hover:text-white transition-all shadow-sm"
            onClick={() => setMeetOpen(true)}
            title="Ruang Rapat Virtual (M)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            <span>Ruang Rapat</span>
            {meeting && meeting.state === 'running' && (
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800/70 border border-slate-700/70 text-slate-200 hover:bg-slate-700/80 hover:text-white transition-all shadow-sm"
            onClick={() => setAgentOpen(true)}
            title="Daftar & Manajemen AI Agent"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>Agent</span>
            <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
              {agents.length}
            </span>
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800/70 border border-slate-700/70 text-slate-200 hover:bg-slate-700/80 hover:text-white transition-all shadow-sm"
            onClick={() => setCronOpen(true)}
            title="Jadwal Otomasi & Cron Jobs"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>Cron</span>
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800/70 border border-slate-700/70 text-slate-200 hover:bg-slate-700/80 hover:text-white transition-all shadow-sm"
            onClick={() => setPanelOpen(true)}
            title="Papan Kanban Tasks"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
              <path d="M15 3v18" />
            </svg>
            <span>Papan</span>
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800/70 border border-slate-700/70 text-slate-200 hover:bg-slate-700/80 hover:text-white transition-all shadow-sm"
            onClick={() => setSystemOpen(true)}
            title="Pengaturan Model & Sistem"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Sistem</span>
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800/70 border border-slate-700/70 text-slate-200 hover:bg-slate-700/80 hover:text-white transition-all shadow-sm"
            onClick={() => setChatOpen(true)}
            title="Live Chat Agent (C)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>Chat</span>
          </button>

          <button
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-sky-500/20 via-indigo-500/20 to-purple-500/20 border border-sky-400/50 text-sky-300 hover:border-sky-300 hover:from-sky-500/30 hover:to-purple-500/30 transition-all shadow-sm"
            onClick={() => setWorkflowOpen(true)}
            title="Buka AI Workflow Engine (W)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span>Workflow Engine</span>
          </button>
        </nav>
        {/* Saklar tampilan sengaja di luar <nav>: di HP baris tombol bisa digeser ke
            samping, dan pilihan 3D/Kanban/Sprite tidak boleh ikut hilang dari layar. */}
        <div className="flex items-center gap-2">
          <div className={`vp-seg vp-topbar-view ${view === 'sprite' ? 'vp-sprite-toggle' : ''}`}>
            <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>3D</button>
            <button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>Kanban</button>
            <button className={view === 'sprite' ? 'on' : ''} onClick={() => setView('sprite')}>Sprite</button>
          </div>
          <button
            className="vp-btn vp-btn-ghost flex h-8 w-8 items-center justify-center p-0 text-slate-300 hover:text-white"
            title={isFullscreen ? 'Keluar Layar Penuh (Esc)' : 'Layar Penuh (Full Screen)'}
            aria-label="Layar Penuh"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------- agent card */}
      {selected && (() => {
        const a = agents.find((x) => x.name === selected)
        const t = tasks.find((x) => x.id === a?.currentTaskId)
        if (!a) return null
        return (
          <aside className="vp-card-float">
            <div className="flex items-center justify-between">
              <b>{a.displayName}</b>
              <button className="vp-x" onClick={() => select(null)} aria-label="Tutup">×</button>
            </div>
            <div className="vp-kv"><span>peran</span><b>{a.role}</b></div>
            <div className="vp-kv"><span>status</span><b>{a.status}</b></div>
            <div className="vp-kv"><span>tugas</span><b>{t?.title || '—'}</b></div>
          </aside>
        )
      })()}


      <TaskPanel />
      <PeekPanel />
      <MeetingPanel open={meetOpen} onClose={() => setMeetOpen(false)} />
      <AgentSpawnPanel
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        onChanged={() => void loadTasks()}
      />
      <CronPanel open={cronOpen} onClose={() => setCronOpen(false)} />
      <BoardPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
      <SystemPanel open={systemOpen} onClose={() => setSystemOpen(false)} />
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onAgentCreated={() => void loadTasks()}
      />
      <TaskHubModal
        open={taskHubOpen}
        onClose={() => setTaskHubOpen(false)}
        onNewTask={() => setNewTaskOpen(true)}
        onOpenChat={(agentName) => {
          select(agentName)
          setChatOpen(true)
        }}
      />
      <NewTaskDialog />
      <WorkflowEnginePanel open={workflowOpen} onClose={() => setWorkflowOpen(false)} />
      {boardOpen && <KanbanModal onClose={() => setBoardOpen(false)} />}
      {nameOpen && <OfficeNameDialog onClose={() => setNameOpen(false)} />}

      {error && (
        <div className="vp-banner" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
