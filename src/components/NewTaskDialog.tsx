'use client'

import { useRef, useState } from 'react'
import { useOffice } from '@/lib/store'
import { fetchJson } from '@/lib/api'
import { read, utils, writeFile } from 'xlsx'

type ImportedRow = {
  id: string
  selected: boolean
  title: string
  assignee: string
  priority: number
  body: string
}

const PRIORITY_NAMES: Record<number, string> = {
  3: 'Critical',
  2: 'High',
  1: 'Medium',
  0: 'Low',
}

/** Dispatch a new task straight into the Hermes board (Manual / Excel / CSV). */
export default function NewTaskDialog() {
  const open = useOffice((s) => s.newTaskOpen)
  const setOpen = useOffice((s) => s.setNewTaskOpen)
  const agents = useOffice((s) => s.agents)
  const load = useOffice((s) => s.load)

  const [activeTab, setActiveTab] = useState<'create' | 'import'>('create')

  // Manual Form
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState(1) // Default: Medium (1)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // Import Form & Preview
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importedTasks, setImportedTasks] = useState<ImportedRow[]>([])
  const [importFileName, setImportFileName] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)

  if (!open) return null

  async function submit() {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetchJson<{ task: { id: string } }>('/api/hermes/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          assignee: assignee || agents[0]?.name,
          body,
          priority,
        }),
      })
      if (!res.ok || !res.data) throw new Error(res.error || 'gagal membuat tugas')
      setNote(`Dibuat: ${res.data.task.id}`)
      setTitle('')
      setBody('')
      await load()
      setTimeout(() => setOpen(false), 900)
    } catch (e) {
      setNote(`Gagal: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFileName(file.name)
    setImportError(null)
    setImportSuccess(null)

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result as ArrayBuffer
        const workbook = read(buffer, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        if (!sheetName) throw new Error('Sheet kosong atau tidak ditemukan')
        const worksheet = workbook.Sheets[sheetName]
        const rawJson = utils.sheet_to_json<Record<string, unknown>>(worksheet)

        if (!rawJson.length) {
          throw new Error('Tidak ada baris data yang ditemukan dalam file.')
        }

        const defaultAgent = agents[0]?.name || ''
        const rows: ImportedRow[] = rawJson.map((r, idx) => {
          // Normalize header lookups
          const findVal = (keys: string[]): string => {
            for (const k of keys) {
              for (const [colName, val] of Object.entries(r)) {
                if (colName.toLowerCase().trim() === k.toLowerCase()) {
                  return String(val ?? '').trim()
                }
              }
            }
            return ''
          }

          const rawTitle = findVal(['judul', 'title', 'tugas', 'task', 'name']) || String(Object.values(r)[0] ?? '').trim()
          let rawAssignee = findVal(['penanggung', 'assignee', 'penanggung_jawab', 'agent', 'staff'])
          if (rawAssignee) {
            const matched = agents.find((a) => a.name.toLowerCase() === rawAssignee.toLowerCase() || a.displayName.toLowerCase() === rawAssignee.toLowerCase())
            if (matched) rawAssignee = matched.name
          }
          if (!rawAssignee) rawAssignee = defaultAgent

          const rawPriority = findVal(['prioritas', 'priority', 'level', 'prio'])
          let pVal = 1
          const pLower = rawPriority.toLowerCase()
          if (pLower.includes('crit') || pLower === '3') pVal = 3
          else if (pLower.includes('high') || pLower.includes('tinggi') || pLower === '2') pVal = 2
          else if (pLower.includes('low') || pLower.includes('rendah') || pLower === '0') pVal = 0
          else pVal = 1

          const rawBody = findVal(['detail', 'body', 'deskripsi', 'description', 'keterangan'])

          return {
            id: `row-${idx}-${Date.now().toString(36)}`,
            selected: true,
            title: rawTitle,
            assignee: rawAssignee,
            priority: pVal,
            body: rawBody,
          }
        }).filter((r) => r.title.length > 0)

        if (!rows.length) {
          throw new Error('Tidak ditemukan judul tugas yang valid di kolom judul/title.')
        }

        setImportedTasks(rows)
      } catch (err) {
        setImportError((err as Error).message)
        setImportedTasks([])
      }
    }
    reader.onerror = () => setImportError('Gagal membaca file dari disk')
    reader.readAsArrayBuffer(file)
  }

  function downloadTemplate(type: 'csv' | 'xlsx') {
    const sample = [
      {
        'Judul': 'Buatkan Konten Instagram Zelvira Virtual Office',
        'Penanggung': agents[0]?.name || 'jun',
        'Prioritas': 'High',
        'Detail': 'Buat 3 carousel postingan edukasi tentang kantor 3D AI agent',
      },
      {
        'Judul': 'Riset Kata Kunci SEO AI Agent Office 2026',
        'Penanggung': agents[1]?.name || agents[0]?.name || 'jun',
        'Prioritas': 'Medium',
        'Detail': 'Kumpulkan 20 keyword volume pencarian tertinggi beserta kesulitan ranking',
      },
      {
        'Judul': 'Perbaiki Idempotensi API Endpoint Webhook',
        'Penanggung': agents[0]?.name || 'jun',
        'Prioritas': 'Critical',
        'Detail': 'Tambahkan penanganan kunci idempotensi Redis agar tidak terjadi double execute',
      },
    ]

    const ws = utils.json_to_sheet(sample)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Template Tugas')
    writeFile(wb, `template_tugas_zelvira.${type}`)
  }

  async function submitImportedTasks() {
    const selected = importedTasks.filter((t) => t.selected && t.title.trim())
    if (!selected.length) {
      setImportError('Tidak ada tugas yang dipilih untuk di-submit.')
      return
    }

    setBusy(true)
    setImportError(null)
    setImportSuccess(null)

    try {
      const items = selected.map((t) => ({
        title: t.title,
        assignee: t.assignee || agents[0]?.name,
        priority: t.priority,
        body: t.body,
      }))

      const res = await fetchJson<{ created?: { id: string }[]; failed?: { title: string; error: string }[] }>(
        '/api/hermes/tasks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: { kind: 'manual', ref: `import-${importFileName || 'file'}` },
            items,
          }),
        },
      )

      if (!res.ok) throw new Error(res.error || 'Gagal mengirim batch tugas')

      const count = res.data?.created?.length ?? items.length
      setImportSuccess(`Berhasil mengimpor ${count} tugas ke papan Hermes Kanban!`)
      setImportedTasks([])
      setImportFileName(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await load()
      setTimeout(() => setOpen(false), 1200)
    } catch (e) {
      setImportError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vp-modal-backdrop" onClick={() => setOpen(false)}>
      <div className="vp-modal" style={{ maxWidth: activeTab === 'import' && importedTasks.length ? 720 : 540 }} onClick={(e) => e.stopPropagation()}>
        <header className="vp-panel-head">
          <div className="flex items-center gap-2">
            <h2>Buat Tugas</h2>
          </div>
          <button className="vp-x" onClick={() => setOpen(false)} aria-label="Tutup">×</button>
        </header>

        {/* Tabbar Navigasi */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', background: '#090d12', padding: '4px 8px 0', gap: 6 }}>
          <button
            type="button"
            className="vp-btn"
            style={{
              padding: '6px 14px',
              fontSize: 12,
              borderRadius: '6px 6px 0 0',
              borderBottom: activeTab === 'create' ? '2px solid #38bdf8' : '2px solid transparent',
              background: activeTab === 'create' ? '#1e293b' : 'transparent',
              color: activeTab === 'create' ? '#f8fafc' : '#94a3b8',
              fontWeight: activeTab === 'create' ? 600 : 400,
            }}
            onClick={() => setActiveTab('create')}
          >
            ✍️ Buat Tugas Manual
          </button>
          <button
            type="button"
            className="vp-btn"
            style={{
              padding: '6px 14px',
              fontSize: 12,
              borderRadius: '6px 6px 0 0',
              borderBottom: activeTab === 'import' ? '2px solid #38bdf8' : '2px solid transparent',
              background: activeTab === 'import' ? '#1e293b' : 'transparent',
              color: activeTab === 'import' ? '#f8fafc' : '#94a3b8',
              fontWeight: activeTab === 'import' ? 600 : 400,
            }}
            onClick={() => setActiveTab('import')}
          >
            📥 Import Excel / CSV
          </button>
        </div>

        {/* TAB 1: MANUAL */}
        {activeTab === 'create' && (
          <div className="vp-pad flex flex-col gap-3">
            {/* Card 1: Informasi Tugas & Prioritas */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1">
                  Judul Tugas <span className="text-rose-400">*</span>
                </label>
                <input
                  className="vp-input w-full font-medium"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Misal: Buat integrasi payment gateway Midtrans"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-800/80">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1">
                    Prioritas
                  </label>
                  <select
                    className="vp-input w-full"
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                  >
                    <option value={3}>🔴 Critical (Prioritas Tertinggi)</option>
                    <option value={2}>🟠 High (Tinggi)</option>
                    <option value={1}>🔵 Medium (Standar)</option>
                    <option value={0}>⚪ Low (Rendah)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1">
                    Penanggung Jawab
                  </label>
                  <select
                    className="vp-input w-full"
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                  >
                    {agents.map((a) => (
                      <option key={a.name} value={a.name}>
                        🤖 {a.displayName} ({a.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Card 2: Instruksi & Kriteria Penerimaan */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                Instruksi & Kriteria (Opsional)
              </label>
              <textarea
                className="vp-input w-full"
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Rincian konteks pekerjaan, API endpoint, atau deliverable yang diharapkan…"
              />
            </div>

            <div className="mt-1">
              <button
                className="vp-btn primary w-full flex items-center justify-center gap-2 font-bold py-2.5 shadow-md shadow-emerald-500/10"
                disabled={busy || !title.trim()}
                onClick={submit}
              >
                <span>✓</span>
                <span>{busy ? 'Mengirim ke Antrean…' : 'Kirim Tugas ke Papan Kanban'}</span>
              </button>
            </div>
            {note && <div className="vp-note">{note}</div>}
          </div>
        )}

        {/* TAB 2: IMPORT EXCEL / CSV */}
        {activeTab === 'import' && (
          <div className="vp-pad flex flex-col gap-3">
            <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Unggah File Excel atau CSV</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="vp-chip-btn"
                    onClick={() => downloadTemplate('csv')}
                    title="Unduh contoh template CSV"
                  >
                    Template .csv
                  </button>
                  <button
                    type="button"
                    className="vp-chip-btn"
                    onClick={() => downloadTemplate('xlsx')}
                    title="Unduh contoh template Excel"
                  >
                    Template .xlsx
                  </button>
                </div>
              </div>

              <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 10px 0' }}>
                Format kolom yang didukung: <b>Judul</b> (wajib), <b>Penanggung</b>, <b>Prioritas</b> (Critical/High/Medium/Low), dan <b>Detail</b>.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv, .xlsx, .xls, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                onChange={handleFileUpload}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '8px 10px',
                  background: '#1e293b',
                  borderRadius: 6,
                  border: '1px dashed #38bdf8',
                  color: '#cbd5e1',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              />
            </div>

            {importError && (
              <div className="vp-err" role="alert">
                {importError}
              </div>
            )}
            {importSuccess && (
              <div className="vp-ok" role="status">
                {importSuccess}
              </div>
            )}

            {/* PREVIEW TABLE OF IMPORTED TASKS */}
            {importedTasks.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 0' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8' }}>
                    Hasil Import ({importedTasks.filter((t) => t.selected).length}/{importedTasks.length} dipilih):
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="vp-chip-btn"
                      onClick={() => setImportedTasks((prev) => prev.map((t) => ({ ...t, selected: true })))}
                    >
                      Pilih Semua
                    </button>
                    <button
                      type="button"
                      className="vp-chip-btn"
                      onClick={() => setImportedTasks((prev) => prev.map((t) => ({ ...t, selected: false })))}
                    >
                      Batal Semua
                    </button>
                  </div>
                </div>

                <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #1e293b', borderRadius: 6, background: '#0b1118' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#1e293b', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                        <th style={{ padding: '6px 8px', width: 28 }}>✓</th>
                        <th style={{ padding: '6px 8px' }}>Judul Tugas</th>
                        <th style={{ padding: '6px 8px', width: 120 }}>Penanggung</th>
                        <th style={{ padding: '6px 8px', width: 80 }}>Prioritas</th>
                        <th style={{ padding: '6px 8px', width: 40 }}>Hapus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importedTasks.map((task, idx) => (
                        <tr
                          key={task.id}
                          style={{
                            borderBottom: '1px solid #1e293b',
                            background: task.selected ? 'transparent' : 'rgba(0,0,0,0.3)',
                            opacity: task.selected ? 1 : 0.5,
                          }}
                        >
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              type="checkbox"
                              checked={task.selected}
                              onChange={(e) => {
                                const checked = e.target.checked
                                setImportedTasks((prev) =>
                                  prev.map((t, i) => (i === idx ? { ...t, selected: checked } : t)),
                                )
                              }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px', color: '#f1f5f9' }}>
                            <div style={{ fontWeight: 500 }}>{task.title}</div>
                            {task.body && <div style={{ color: '#64748b', fontSize: 10 }}>{task.body}</div>}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <select
                              value={task.assignee}
                              onChange={(e) => {
                                const newAss = e.target.value
                                setImportedTasks((prev) =>
                                  prev.map((t, i) => (i === idx ? { ...t, assignee: newAss } : t)),
                                )
                              }}
                              style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 4, padding: '2px 4px', fontSize: 10, width: '100%' }}
                            >
                              {agents.map((a) => (
                                <option key={a.name} value={a.name}>
                                  {a.displayName}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <select
                              value={task.priority}
                              onChange={(e) => {
                                const newP = Number(e.target.value)
                                setImportedTasks((prev) =>
                                  prev.map((t, i) => (i === idx ? { ...t, priority: newP } : t)),
                                )
                              }}
                              style={{
                                background: '#1e293b',
                                color: task.priority === 3 ? '#f43f5e' : task.priority === 2 ? '#f97316' : task.priority === 1 ? '#38bdf8' : '#94a3b8',
                                border: '1px solid #334155',
                                borderRadius: 4,
                                padding: '2px 4px',
                                fontSize: 10,
                                fontWeight: 600,
                              }}
                            >
                              <option value={3}>Critical</option>
                              <option value={2}>High</option>
                              <option value={1}>Medium</option>
                              <option value={0}>Low</option>
                            </select>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <button
                              type="button"
                              className="vp-x"
                              style={{ fontSize: 12, padding: 0 }}
                              onClick={() => setImportedTasks((prev) => prev.filter((_, i) => i !== idx))}
                              title="Hapus baris ini"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="vp-btn primary"
                    disabled={busy || !importedTasks.some((t) => t.selected)}
                    onClick={submitImportedTasks}
                    style={{ flex: 1 }}
                  >
                    {busy
                      ? 'Mengimpor Tugas…'
                      : `Submit ${importedTasks.filter((t) => t.selected).length} Tugas Terpilih`}
                  </button>
                  <button
                    type="button"
                    className="vp-btn"
                    onClick={() => {
                      setImportedTasks([])
                      setImportFileName(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                  >
                    Batal
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
