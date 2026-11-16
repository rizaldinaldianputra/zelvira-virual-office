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
import KanbanModal from './KanbanModal'
import OfficeNameDialog from './OfficeNameDialog'
import WorkflowEnginePanel from './workflow/WorkflowEnginePanel'
import { startPolling, useOffice } from '@/lib/store'
import type { OfficeScene } from '@/lib/office/scene'
import type { AgentDivision } from '@/types/hermes'

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
            onScene={(s) => (sceneRef.current = s)}
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
        <div className="vp-topbar-brand flex items-center gap-3">
          <span className="vp-logo">Zelvira Office</span>
          <span className={`vp-dot ${backendOnline ? 'ok' : 'bad'}`} />
          <span className="vp-muted vp-topbar-status">
            {backendOnline ? `${agents.length} agent · ${running} jalan · ${pct}% rilis` : 'backend offline'}
          </span>
        </div>

        <nav className="vp-topbar-nav flex items-center gap-2" aria-label="Panel">
          <button className="vp-btn vp-btn-ghost" onClick={() => setNewTaskOpen(true)}>+ Tugas</button>
          <button className="vp-btn vp-btn-ghost" onClick={() => setMeetOpen(true)}>
            Ruang rapat{meeting && meeting.state === 'running' ? ' ●' : ''}
          </button>
          <button className="vp-btn vp-btn-ghost" onClick={() => setAgentOpen(true)}>
            Agent ({agents.length})
          </button>
          <button className="vp-btn vp-btn-ghost" onClick={() => setCronOpen(true)}>
            Cron
          </button>
          <button className="vp-btn vp-btn-ghost" onClick={() => setPanelOpen(true)}>
            Papan
          </button>
          <button className="vp-btn vp-btn-ghost" onClick={() => setSystemOpen(true)}>
            Pengaturan & Sistem
          </button>
          <button className="vp-btn vp-btn-ghost" onClick={() => setChatOpen(true)}>
            Chat
          </button>
          <button
            className="vp-btn vp-btn-ghost"
            style={{
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(99, 102, 241, 0.15))',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              color: '#38bdf8',
              fontWeight: 600,
            }}
            onClick={() => setWorkflowOpen(true)}
          >
            ⚡ AI Workflow Engine
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
