'use client'

import { useState } from 'react'
import { useOffice } from '@/lib/store'
import { EVIDENCE_MARK_LABEL, STALE_EVIDENCE, markClass, markOf, useEvidenceMarks } from './useEvidenceMarks'
import {
  STALE_VERIFICATION,
  VERIFICATION_MARK_LABEL,
  verificationMarkClass,
  verificationMarkOf,
  useVerificationMarks,
} from './useVerificationMarks'

/**
 * SATU-SATUNYA perender kolom kanban: view "Kanban", papan dinding 3D (KanbanModal), dan
 * panel Papan semuanya memakai ini. Dulu tiap tempat punya salinan sendiri, dan salinan
 * modal diam-diam kehilangan kolom TERHAMBAT — task yang diblokir tidak terlihat di sana.
 * Yang boleh beda antar tempat hanya bingkainya (lewat props), bukan isi kolom/kartunya.
 */

export const KANBAN_COLUMNS = [
  { label: 'TODO', statuses: ['todo', 'triage', 'ready', 'scheduled'], targetStatus: 'todo' },
  { label: 'DIKERJAKAN', statuses: ['running'], targetStatus: 'running' },
  { label: 'REVIEW', statuses: ['review'], targetStatus: 'review' },
  { label: 'SELESAI', statuses: ['done'], targetStatus: 'done' },
  { label: 'TERHAMBAT', statuses: ['blocked'], targetStatus: 'blocked' },
  { label: 'ARSIP', statuses: ['archived'], targetStatus: 'archived' },
]
const KNOWN = KANBAN_COLUMNS.flatMap((column) => column.statuses)

export default function KanbanColumns({
  search = false,
  freshness = false,
  closeAfterOpen,
}: {
  /** Kotak cari judul/assignee di atas kolom. */
  search?: boolean
  /** Catatan umur penanda bukti/verifikasi + "BASI". */
  freshness?: boolean
  /**
   * Dipanggil setelah `openTask`. Wadah yang menutupi panel detail (modal, panel layar
   * penuh) harus menutup diri, kalau tidak klik kartu terlihat seperti tidak terjadi apa-apa.
   */
  closeAfterOpen?: () => void
}) {
  const tasks = useOffice((s) => s.tasks)
  const openTask = useOffice((s) => s.openTask)
  const load = useOffice((s) => s.load)
  const [q, setQ] = useState('')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  // Penanda dibaca dari SEMUA task, bukan hasil cari: mengetik di kotak cari tidak boleh
  // memicu batch baca bukti baru.
  // Kolom SELESAI = klaim worker; penanda bukti (ringkas) dibaca terpisah.
  const marks = useEvidenceMarks(tasks)
  // Klaim ≠ terverifikasi: penanda review independen, hanya untuk done/review.
  const vf = useVerificationMarks(tasks)

  const needle = search ? q.trim().toLowerCase() : ''
  const shown = needle
    ? tasks.filter((t) => t.title.toLowerCase().includes(needle) || (t.assignee ?? '').toLowerCase().includes(needle))
    : tasks
  const columns = [
    ...KANBAN_COLUMNS.map((column) => ({ ...column, items: shown.filter((task) => column.statuses.includes(task.status)) })),
    { label: 'STATUS LAIN', statuses: [], targetStatus: '', items: shown.filter((task) => !KNOWN.includes(task.status)) },
  ]

  const handleDrop = async (targetStatus: string, e: React.DragEvent) => {
    e.preventDefault()
    setDragOverCol(null)
    const taskId = e.dataTransfer.getData('text/plain') || draggedId
    if (!taskId) return
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === targetStatus) return

    // Optimistic update
    const prevTasks = useOffice.getState().tasks
    useOffice.setState({
      tasks: prevTasks.map((t) => (t.id === taskId ? { ...t, status: targetStatus as any } : t)),
    })

    try {
      await fetch(`/api/hermes/tasks/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', status: targetStatus }),
      })
      void load()
    } catch (err) {
      console.error('Gagal memindahkan task:', err)
      useOffice.setState({ tasks: prevTasks })
    }
  }

  return (
    <>
      {(search || freshness) && <KanbanToolbar {...{ search, freshness, q, setQ, marks, vf }} />}
      <div className="vp-k2d-grid grid min-w-[1050px] grid-cols-7 gap-3">
        {columns.map((column) => (
          <section
            key={column.label}
            className={`vp-col transition-all duration-150 ${dragOverCol === column.label ? 'vp-col-dragover' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragOverCol !== column.label) setDragOverCol(column.label)
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return
              setDragOverCol(null)
            }}
            onDrop={(e) => {
              if (column.targetStatus) {
                void handleDrop(column.targetStatus, e)
              }
            }}
          >
            <header className="vp-col-head">
              <span>{column.label}</span>
              <span className="vp-count">{column.items.length}</span>
            </header>
            <div className="flex flex-col gap-2">
              {column.items.map((task) => {
                const mark = markOf(marks, task)
                const vmark = verificationMarkOf(vf, task)
                return (
                <article
                  key={task.id}
                  className={`vp-card ${draggedId === task.id ? 'opacity-40 ring-2 ring-emerald-500' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', task.id)
                    e.dataTransfer.effectAllowed = 'move'
                    setDraggedId(task.id)
                  }}
                  onDragEnd={() => {
                    setDraggedId(null)
                    setDragOverCol(null)
                  }}
                  onClick={() => {
                    openTask(task.id)
                    closeAfterOpen?.()
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="vp-card-title flex-1">{task.title}</div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {task.status !== 'running' && task.status !== 'done' && (
                        <button
                          type="button"
                          className="vp-card-act vp-card-act-run"
                          title="Jalankan tugas ini dengan AI Agent sekarang"
                          onClick={async (e) => {
                            e.stopPropagation()
                            try {
                              await fetch(`/api/hermes/tasks/${task.id}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: 'run' }),
                              })
                              void load()
                            } catch {}
                          }}
                        >
                          ▶
                        </button>
                      )}
                      <button
                        type="button"
                        className="vp-card-act vp-card-act-del"
                        title="Hapus tugas ini bila salah dibuat"
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (!window.confirm(`Hapus tugas "${task.title}"?`)) return
                          try {
                            await fetch(`/api/hermes/tasks/${task.id}`, {
                              method: 'DELETE',
                            })
                            void load()
                          } catch {}
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="vp-card-meta">
                    <span className="vp-chip">{column.label === 'STATUS LAIN' ? task.status : task.assignee || '—'}</span>
                    {task.origin && task.origin.kind !== 'manual' && (
                      <span className={`vp-chip vp-chip-${task.origin.kind}`}>{task.origin.kind}</span>
                    )}
                    <code>{task.id}</code>
                    {mark && <span className={markClass(mark)}>{EVIDENCE_MARK_LABEL[mark]}</span>}
                    {vmark && (
                      <span className={verificationMarkClass(vmark)}>{VERIFICATION_MARK_LABEL[vmark]}</span>
                    )}
                  </div>
                </article>
                )
              })}
              {!column.items.length && <div className="vp-empty">kosong (drag kartu ke sini)</div>}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}

function KanbanToolbar({
  search,
  freshness,
  q,
  setQ,
  marks,
  vf,
}: {
  search: boolean
  freshness: boolean
  q: string
  setQ: (q: string) => void
  marks: ReturnType<typeof useEvidenceMarks>
  vf: ReturnType<typeof useVerificationMarks>
}) {
  const marksAge = marks.readAt ? Math.round((Date.now() - marks.readAt) / 1000) : null
  const vfAge = vf.readAt ? Math.round((Date.now() - vf.readAt) / 1000) : null
  return (
    // sticky-left: di HP grid digeser ke samping, kotak cari dan catatan tetap di layar.
    <div className="vp-kanban-tools">
      {freshness && (
        <div>
          <p className="vp-sub">
            {marks.error ? (
              <span className="vp-err">gagal membaca bukti: {marks.error}</span>
            ) : marksAge == null ? (
              marks.busy ? 'membaca bukti…' : 'bukti belum dibaca'
            ) : (
              <>
                bukti ringkas (ringkasan + run, tanpa log/lampiran) · dibaca {marksAge} dtk lalu
                {marksAge > STALE_EVIDENCE && <span className="vp-warn"> · BASI</span>}
              </>
            )}
          </p>
          <p className="vp-sub">
            {vf.error ? (
              <span className="vp-err">gagal membaca verifikasi: {vf.error}</span>
            ) : vfAge == null ? (
              vf.busy ? 'membaca verifikasi…' : 'verifikasi belum dibaca'
            ) : (
              <>
                verifikasi (klaim vs review) · dibaca {vfAge} dtk lalu
                {vfAge > STALE_VERIFICATION && <span className="vp-warn"> · BASI</span>}
              </>
            )}
          </p>
        </div>
      )}
      {search && (
        <input
          className="vp-kanban-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="cari judul / assignee…"
        />
      )}
    </div>
  )
}
