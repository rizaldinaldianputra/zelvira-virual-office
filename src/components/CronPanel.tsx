'use client'

import { useEffect, useState } from 'react'
import Collapsible from './Collapsible'
import ActionItems from './ActionItems'
import FullPanel from './FullPanel'
import type { Candidate } from '@/types/hermes'
import { fetchJson } from '@/lib/api'

/**
 * Cron job management.
 *
 * Two safety rules, both deliberate:
 *
 *   1. A new job is created PAUSED. A job created live can fire before anyone has
 *      read it back, and the schedule syntax is easy to get wrong. There is an
 *      explicit "langsung aktif" checkbox for when that is what you want.
 *   2. Every action that changes a schedule needs a SECOND click. The button
 *      turns into "Yakin?" in place, and clicking elsewhere cancels. A single
 *      stray click must not pause the job that keeps something alive.
 */

type Job = {
  id: string
  name: string
  prompt: string
  schedule: string
  scheduleKind: string
  enabled: boolean
  state: string
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  failureStreak: number
  deliver: string
  noAgent: boolean
  script: string | null
  skills: string[]
  repeatTimes: number | null
  repeatCompleted: number
}

type ScheduleType = 'daily' | 'workdays' | 'weekly' | 'hourly' | 'monthly' | 'custom'

const DAY_LABELS = [
  { val: 1, label: 'Sen' },
  { val: 2, label: 'Sel' },
  { val: 3, label: 'Rab' },
  { val: 4, label: 'Kam' },
  { val: 5, label: 'Jum' },
  { val: 6, label: 'Sab' },
  { val: 0, label: 'Min' },
]

function buildCronExpr(
  type: ScheduleType,
  time: string,
  days: number[],
  interval: string,
  dayOfMonth: string,
): string {
  const [hhStr, mmStr] = (time || '09:00').split(':')
  const hh = Number(hhStr) || 0
  const mm = Number(mmStr) || 0
  switch (type) {
    case 'daily':
      return `${mm} ${hh} * * *`
    case 'workdays':
      return `${mm} ${hh} * * 1-5`
    case 'weekly': {
      const d = days.length ? [...days].sort((a, b) => a - b).join(',') : '*'
      return `${mm} ${hh} * * ${d}`
    }
    case 'hourly': {
      const n = Math.max(1, Math.min(23, Number(interval) || 1))
      return `0 */${n} * * *`
    }
    case 'monthly': {
      const d = Math.max(1, Math.min(31, Number(dayOfMonth) || 1))
      return `${mm} ${hh} ${d} * *`
    }
    case 'custom':
    default:
      return ''
  }
}

function describeCron(
  type: ScheduleType,
  time: string,
  days: number[],
  interval: string,
  dayOfMonth: string,
  rawExpr: string,
): string {
  const dayNames: Record<number, string> = { 1: 'Senin', 2: 'Selasa', 3: 'Rabu', 4: 'Kamis', 5: 'Jumat', 6: 'Sabtu', 0: 'Minggu' }
  switch (type) {
    case 'daily':
      return `Setiap hari pukul ${time || '09:00'}`
    case 'workdays':
      return `Setiap hari kerja (Senin - Jumat) pukul ${time || '09:00'}`
    case 'weekly': {
      const dStr = days.map((d) => dayNames[d]).join(', ') || 'Semua hari'
      return `Setiap ${dStr} pukul ${time || '09:00'}`
    }
    case 'hourly':
      return `Setiap ${interval || '1'} jam sekali (di menit ke-00)`
    case 'monthly':
      return `Setiap tanggal ${dayOfMonth || '1'} bulanan pukul ${time || '09:00'}`
    case 'custom':
      return rawExpr ? `Kustom: ${rawExpr}` : 'Masukkan ekspresi cron'
  }
}

type Run = {
  id: string
  jobId: string
  status: string
  source: string
  startedAt: string | null
  finishedAt: string | null
}

/** Human-readable relative time, or the raw value if it cannot be parsed. */
function when(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diff = t - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60_000)
  const label =
    abs < 60_000
      ? 'sekarang'
      : mins < 60
        ? `${mins} mnt`
        : abs < 86_400_000
          ? `${Math.round(mins / 60)} jam`
          : `${Math.round(abs / 86_400_000)} hari`
  return diff >= 0 ? `dalam ${label}` : `${label} lalu`
}

export default function CronPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  /** jobs.json gagal dibaca/parse — tampilkan "tak terbaca", BUKAN "tidak ada job". */
  const [jobsFailure, setJobsFailure] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [screen, setScreen] = useState<'list' | 'new'>('list')
  /**
   * Follow-up candidates per job id. Loaded lazily when the user asks for them —
   * most jobs are healthy and have nothing to hand over, so this is not fetched
   * for every row on every poll.
   */
  const [items, setItems] = useState<Record<string, Candidate[]>>({})
  const [roster, setRoster] = useState<string[]>([])
  const [itemsBusy, setItemsBusy] = useState<string | null>(null)

  /** id + action awaiting the second click. */
  const [confirm, setConfirm] = useState<{ id: string; action: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // create form
  const [schedule, setSchedule] = useState('0 9 * * *')
  const [prompt, setPrompt] = useState('')
  const [name, setName] = useState('')
  const [liveNow, setLiveNow] = useState(false)

  // schedule datetime picker state
  const [schedMode, setSchedMode] = useState<'picker' | 'raw'>('picker')
  const [schedType, setSchedType] = useState<ScheduleType>('daily')
  const [timeVal, setTimeVal] = useState('09:00')
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [hourInterval, setHourInterval] = useState('2')
  const [monthDay, setMonthDay] = useState('1')

  useEffect(() => {
    if (schedMode === 'picker') {
      const expr = buildCronExpr(schedType, timeVal, selectedDays, hourInterval, monthDay)
      if (expr) setSchedule(expr)
    }
  }, [schedMode, schedType, timeVal, selectedDays, hourInterval, monthDay])

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetchJson<{ jobs?: Job[]; runs?: Run[]; jobsFailure?: string }>(
        '/api/hermes/cron',
        {
          cache: 'no-store',
        },
      )
      if (!res.ok) throw new Error(res.error || 'gagal memuat cron')
      setJobs(res.data?.jobs || [])
      setRuns(res.data?.runs || [])
      setJobsFailure(res.data?.jobsFailure || null)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  // A click anywhere else cancels a pending confirmation.
  useEffect(() => {
    if (!confirm) return
    const cancel = () => setConfirm(null)
    window.addEventListener('click', cancel)
    return () => window.removeEventListener('click', cancel)
  }, [confirm])

  async function act(id: string, action: string) {
    setBusy(id + action)
    setErr(null)
    setNote(null)
    try {
      const res = await fetchJson('/api/hermes/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      })
      if (!res.ok) throw new Error(res.error || 'aksi gagal')
      setNote(
        action === 'remove'
          ? 'job dihapus'
          : action === 'run'
            ? 'job akan jalan pada tick berikutnya'
            : `job ${action === 'pause' ? 'dipause' : 'diaktifkan'}`,
      )
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
      setConfirm(null)
    }
  }

  /** Fetch a job's follow-up candidates. */
  async function loadItems(jobId: string) {
    setItemsBusy(jobId)
    setErr(null)
    try {
      const res = await fetchJson<{ items?: Candidate[]; roster?: string[] }>(
        `/api/hermes/cron/actions?from=${encodeURIComponent(jobId)}`,
        { cache: 'no-store' },
      )
      if (!res.ok) throw new Error(res.error || 'gagal membaca tindak lanjut')
      setItems((prev) => ({ ...prev, [jobId]: res.data?.items || [] }))
      setRoster(res.data?.roster || [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setItemsBusy(null)
    }
  }

  async function create() {
    setBusy('create')
    setErr(null)
    setNote(null)
    try {
      const res = await fetchJson<{ id: string }>('/api/hermes/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          schedule,
          prompt,
          name,
          paused: !liveNow,
        }),
      })
      if (!res.ok || !res.data) throw new Error(res.error || 'gagal membuat job')
      const newId = res.data.id
      setNote(
        liveNow
          ? `job dibuat dan langsung aktif (${newId})`
          : `job dibuat dalam keadaan pause (${newId}) — aktifkan kalau sudah benar`,
      )
      setSchedule('')
      setPrompt('')
      setName('')
      setLiveNow(false)
      await load()
      setScreen('list')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null

  /** A button that needs a second click before it fires. */
  function Guarded({
    id,
    action,
    label,
    confirmLabel,
    className,
  }: {
    id: string
    action: string
    label: string
    confirmLabel: string
    className?: string
  }) {
    const armed = confirm?.id === id && confirm.action === action
    return (
      <button
        className={`vp-btn ${className || ''}`}
        disabled={busy === id + action}
        onClick={(e) => {
          e.stopPropagation()
          if (!armed) {
            setConfirm({ id, action })
            return
          }
          void act(id, action)
        }}
      >
        {busy === id + action ? '…' : armed ? confirmLabel : label}
      </button>
    )
  }

  return (
    <FullPanel
      onClose={onClose}
      label="Cron"
      title={screen === 'new' ? 'Job baru' : 'Cron'}
      actions={
        screen === 'new' && (
          <button className="vp-chip-btn" onClick={() => setScreen('list')}>
            ← Kembali
          </button>
        )
      }
      bodyClassName="vp-pad flex flex-col gap-3"
    >
      {err && <div className="vp-err">{err}</div>}
      {note && <div className="vp-ok">{note}</div>}
      {loading && <div className="vp-muted">memuat…</div>}
      {/* jobs.json gagal dibaca = "tak terbaca", BUKAN "belum ada job" — pola jujur (bedakan baca-gagal dari kosong). */}
      {jobsFailure && <div className="vp-err">jadwal tak terbaca (bukan &quot;tidak ada job&quot;): {jobsFailure}</div>}

      {screen === 'list' ? (
        <>
          <button className="vp-btn" onClick={() => setScreen('new')}>
            + Buat job
          </button>
          <button className="vp-btn vp-btn-rosy" disabled={loading} onClick={load}>
            Segarkan
          </button>

          <div className="vp-sub">JOB ({jobs.length})</div>
          <div className="flex flex-col gap-2">
            {jobs.map((j) => (
              <div key={j.id} className={`vp-cron-card ${j.enabled ? 'on' : ''}`}>
                <div className="vp-cron-top">
                  <b>{j.name}</b>
                  <span className={`vp-cron-state ${j.enabled ? 'on' : 'off'}`}>{j.state}</span>
                </div>
                <i className="vp-cron-sched">{j.schedule}</i>
                <div className="vp-cron-meta">
                  <span>{j.enabled ? `jalan ${when(j.nextRunAt)}` : 'dijeda'}</span>
                  {j.lastRunAt && <span>terakhir {when(j.lastRunAt)}</span>}
                  {j.failureStreak > 0 && (
                    <span className="vp-cron-bad">gagal {j.failureStreak}×</span>
                  )}
                </div>
                {j.prompt && <Collapsible label="Prompt" text={j.prompt} />}
                {j.lastError && <div className="vp-cron-err">{j.lastError}</div>}

                {/* The cross-menu link: a failing job becomes a task. Offered only
                    when there is something to fix, so a healthy job stays quiet. */}
                {j.failureStreak > 0 && (
                  <>
                    {items[j.id] ? (
                      <ActionItems
                        candidates={items[j.id]}
                        roster={roster}
                        origin={{ kind: 'cron', ref: j.id }}
                        label="TINDAK LANJUT → TUGAS"
                      />
                    ) : (
                      <button
                        className="vp-btn vp-btn-ghost"
                        disabled={itemsBusy === j.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          void loadItems(j.id)
                        }}
                      >
                        {itemsBusy === j.id ? '…' : 'Buat tugas dari kegagalan ini'}
                      </button>
                    )}
                  </>
                )}
                <div className="vp-cron-actions">
                  {j.enabled ? (
                    <Guarded
                      id={j.id}
                      action="pause"
                      label="Pause"
                      confirmLabel="Yakin jeda?"
                    />
                  ) : (
                    <Guarded
                      id={j.id}
                      action="resume"
                      label="Aktifkan"
                      confirmLabel="Yakin aktifkan?"
                    />
                  )}
                  <Guarded
                    id={j.id}
                    action="run"
                    label="Jalankan"
                    confirmLabel="Yakin jalan?"
                  />
                  <Guarded
                    id={j.id}
                    action="remove"
                    label="Hapus"
                    confirmLabel="Yakin hapus?"
                    className="vp-btn-danger"
                  />
                </div>
              </div>
            ))}
            {!jobs.length && !jobsFailure && <span className="vp-muted">belum ada job terjadwal</span>}
          </div>

          {runs.length > 0 && (
            <>
              <div className="vp-sub">EKSEKUSI TERAKHIR ({runs.length})</div>
              <div className="flex flex-col gap-1">
                {runs.slice(0, 12).map((r) => (
                  <div key={r.id} className="vp-cron-run">
                    {/* Hermes reports a good run as `completed`, not `success`;
                        matching only `success` painted every green run grey. */}
                    <span className={`vp-cron-state ${['success', 'completed'].includes(r.status) ? 'on' : 'off'}`}>
                      {r.status}
                    </span>
                    <i>{r.jobId}</i>
                    <span>{when(r.startedAt)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-700 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
              <span>⏰</span> PENGATUR WAKTU & JADWAL (CRON)
            </span>
            <div className="flex rounded bg-slate-800 p-0.5 text-[11px]">
              <button
                type="button"
                className={`px-2 py-0.5 rounded transition-colors ${schedMode === 'picker' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-white'}`}
                onClick={() => {
                  setSchedMode('picker')
                  const expr = buildCronExpr(schedType, timeVal, selectedDays, hourInterval, monthDay)
                  if (expr) setSchedule(expr)
                }}
              >
                Pilih Waktu (Visual)
              </button>
              <button
                type="button"
                className={`px-2 py-0.5 rounded transition-colors ${schedMode === 'raw' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-white'}`}
                onClick={() => setSchedMode('raw')}
              >
                Format Cron Manual
              </button>
            </div>
          </div>

          {schedMode === 'picker' ? (
            <div className="rounded border border-slate-700 bg-slate-900/60 p-3 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                  Frekuensi Eksekusi:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
                  {[
                    { id: 'daily' as ScheduleType, label: '☀️ Setiap Hari' },
                    { id: 'workdays' as ScheduleType, label: '💼 Hari Kerja (Sen-Jum)' },
                    { id: 'weekly' as ScheduleType, label: '📅 Hari Tertentu' },
                    { id: 'hourly' as ScheduleType, label: '⏱️ Interval Jam' },
                    { id: 'monthly' as ScheduleType, label: '📆 Tanggal Bulanan' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`px-2.5 py-1.5 rounded text-left border text-[11px] transition-colors ${
                        schedType === item.id
                          ? 'border-indigo-500 bg-indigo-950/70 text-indigo-200 font-semibold shadow-sm'
                          : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700'
                      }`}
                      onClick={() => setSchedType(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time Picker (for daily, workdays, weekly, monthly) */}
              {schedType !== 'hourly' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Jam & Menit Eksekusi (Time):
                  </label>
                  <input
                    type="time"
                    className="vp-input w-full max-w-[180px] text-sm font-mono"
                    value={timeVal}
                    onChange={(e) => setTimeVal(e.target.value)}
                  />
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    Job akan berjalan otomatis pada jam dan menit ini.
                  </span>
                </div>
              )}

              {/* Weekly Day Selector */}
              {schedType === 'weekly' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Pilih Hari Eksekusi:
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_LABELS.map((d) => {
                      const sel = selectedDays.includes(d.val)
                      return (
                        <button
                          key={d.val}
                          type="button"
                          className={`vp-chip-btn ${sel ? 'on' : ''}`}
                          onClick={() => {
                            setSelectedDays((prev) =>
                              prev.includes(d.val) ? prev.filter((x) => x !== d.val) : [...prev, d.val],
                            )
                          }}
                        >
                          {sel ? '✓ ' : ''}{d.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Hourly Interval Selector */}
              {schedType === 'hourly' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Interval Waktu (Setiap berapa jam):
                  </label>
                  <select
                    className="vp-input w-full max-w-[220px]"
                    value={hourInterval}
                    onChange={(e) => setHourInterval(e.target.value)}
                  >
                    <option value="1">Setiap 1 Jam</option>
                    <option value="2">Setiap 2 Jam</option>
                    <option value="3">Setiap 3 Jam</option>
                    <option value="4">Setiap 4 Jam</option>
                    <option value="6">Setiap 6 Jam</option>
                    <option value="12">Setiap 12 Jam</option>
                  </select>
                </div>
              )}

              {/* Monthly Day of Month Selector */}
              {schedType === 'monthly' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Tanggal Eksekusi Bulanan (1 - 31):
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    className="vp-input w-28 text-sm"
                    value={monthDay}
                    onChange={(e) => setMonthDay(e.target.value)}
                  />
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    Dijalankan pada tanggal ini setiap bulannya.
                  </span>
                </div>
              )}

              {/* Preview Box */}
              <div className="rounded bg-indigo-950/40 border border-indigo-800/40 p-2.5 text-xs text-indigo-300 flex flex-wrap items-center justify-between gap-2">
                <span>
                  ⏰ <b>{describeCron(schedType, timeVal, selectedDays, hourInterval, monthDay, schedule)}</b>
                </span>
                <span className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-slate-400">Ekspresi:</span>
                  <code className="font-mono bg-slate-900 px-2 py-0.5 rounded text-indigo-200 border border-slate-700">
                    {schedule || '—'}
                  </code>
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="vp-sub">EKSPRESI CRON (MANUAL)</label>
              <input
                className="vp-input w-full font-mono text-xs"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="30m  ·  every 2h  ·  0 9 * * *"
              />
              <span className="text-[10px] text-slate-500 block">
                Format ekspresi cron standar (misal: <code>0 9 * * 1-5</code>) atau interval shorthand Hermes.
              </span>
            </div>
          )}

          <label className="vp-sub">PROMPT PERINTAH</label>
          <textarea
            className="vp-input"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="perintah"
          />

          <label className="vp-sub">NAMA (OPSIONAL)</label>
          <input
            className="vp-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cek rilis harian"
          />

          <label className="vp-check">
            <input
              type="checkbox"
              checked={liveNow}
              onChange={(e) => setLiveNow(e.target.checked)}
            />
            <span>langsung aktif (kalau tidak dicentang, job dibuat pause dulu)</span>
          </label>

          <button
            className="vp-btn"
            disabled={busy === 'create' || !schedule.trim() || !prompt.trim()}
            onClick={create}
          >
            {busy === 'create' ? 'Membuat…' : 'Buat job'}
          </button>
        </div>
      )}
    </FullPanel>
  )
}
