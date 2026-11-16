'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import ModelPicker, { type ModelChoice } from './ModelPicker'
import type { AgentDivision, AgentRole } from '@/types/hermes'
import { DIVISION_LABEL } from '@/types/hermes'
import { ROLE_LABEL } from '@/lib/hermes/soul'
import FullPanel from './FullPanel'
import RestartNotice from './RestartNotice'

/**
 * Spawn / hide / kill control.
 *
 * "Sembunyikan" and "Spawn" toggle office MEMBERSHIP
 * (src/lib/hermes/office-membership.ts): the avatar leaves or enters, the profile
 * and its tasks are untouched. "Kill" is the destructive one — it deletes the
 * profile and purges its tasks — so it is only offered when a profile exists and
 * asks for a second click.
 */

type Row = {
  name: string
  total: number
  /** The profile exists on disk, not only as a task assignee. */
  profile: boolean
  inOffice: boolean
  reason: string | null
  /** The profile's default model, when it has one. */
  model?: string | null
  /** Role dari route agents GET; null/undefined bila backend lama. */
  role?: AgentRole | string | null
  /** Divisi dari route agents GET; null/undefined bila backend lama. */
  division?: AgentDivision | string | null
  /** True bila profil punya SOUL.md sendiri. */
  soulExists?: boolean | null
  /** Keahlian/domain (dipakai office, bukan A2A). */
  domains?: string[]
  /**
   * Status A2A jujur: 'served' = terdaftar di platforms.a2a.agents,
   * 'unlisted' = belum didaftarkan. Bukan "aktif" — berlaku pasca-restart.
   */
  a2a?: 'served' | 'unlisted' | null
}

/** Batas izin per role dari route agents GET (tabel tunggal di control.ts). */
type Permissions = Record<string, { allow: string[]; deny: string[]; anyTask: boolean }>

const ROLE_OPTIONS = Object.entries(ROLE_LABEL) as [AgentRole, string][]
const DIVISION_OPTIONS = Object.entries(DIVISION_LABEL) as [AgentDivision, string][]

const SKILL_SUGGESTIONS: Record<AgentRole, string[]> = {
  ceo: ['strategic-planning', 'decision-making', 'team-leadership', 'resource-allocation'],
  orchestrator: ['workflow-automation', 'task-delegation', 'coordination', 'problem-solving'],
  manager: ['project-management', 'team-sync', 'qa-review', 'mentoring'],
  backend: ['nodejs', 'postgresql', 'rest-api', 'docker', 'database-design'],
  frontend: ['react', 'nextjs', 'tailwindcss', 'ui-ux', 'responsive-design'],
  qa: ['test-automation', 'verification', 'bug-hunting', 'evidence-validation'],
  researcher: ['market-research', 'data-synthesis', 'competitive-analysis', 'reporting'],
  devops: ['docker', 'ci-cd', 'linux', 'server-monitoring', 'infrastructure'],
  marketing: ['meta-ads', 'google-ads', 'conversion-rate', 'copywriting', 'campaign-strategy'],
  seo: ['keyword-research', 'on-page-seo', 'backlinks', 'content-optimization', 'search-console'],
  content: ['article-writing', 'video-scripts', 'storytelling', 'social-media-content'],
  affiliator: ['affiliate-marketing', 'product-curation', 'conversion-tracking', 'link-strategy'],
}

const SOUL_PRESETS: { label: string; desc: string; text: (name: string, role: string, div: string) => string }[] = [
  {
    label: '🛡️ Standar Anti-Halusinasi & Bukti',
    desc: 'Pedoman ketat berbasis bukti: dilarang mengarang, wajib sertakan verifikasi output.',
    text: (name, role, div) =>
      `Kamu adalah ${name || 'Agent'}, ${role} di divisi ${div}.\n\nPEDOMAN ANTI-HALUSINASI & CARA KERJA:\n1. Eksekusi Berbasis Bukti: Jangan pernah mengarang data, output tool, atau status apa pun.\n2. Verifikasi Nyata: Setiap hasil kerja wajib dibuktikan dengan output konkret (status tool, error code, test result).\n3. Transparansi Kendala: Jika menemui error atau tidak yakin, sampaikan secara jujur disertai langkah perbaikan alternatif.\n4. Komunikasi: Gunakan Bahasa Indonesia yang ringkas, profesional, dan langsung pada inti persoalan.`,
  },
  {
    label: '🔍 QA & Verifikasi Kritis',
    desc: 'Standar audit tinggi: tolak klaim selesai yang tidak memiliki bukti output nyata.',
    text: (name, role, div) =>
      `Kamu adalah ${name || 'Agent'}, ${role} di divisi ${div}.\n\nPRINSIP VERIFIKASI & AUDIT:\n1. Uji secara menyeluruh sebelum menyatakan tugas selesai.\n2. Tolak overclaim atau dugaan yang tidak didukung data nyata.\n3. Periksa fungsionalitas, keamanan, dan kemungkinan error edge-case.\n4. Berikan rangkuman hasil pengujian yang objektif dan transparan.`,
  },
  {
    label: '⚡ Eksekutor Cepat & Mandiri',
    desc: 'Langsung aksi dengan tool nyata, efisien, dan mandiri.',
    text: (name, role, div) =>
      `Kamu adalah ${name || 'Agent'}, ${role} di divisi ${div}.\n\nPRINSIP EKSEKUSI CEPAT:\n1. Perintah → Langsung aksi via tool nyata → Laporan hasil konkret.\n2. Self-repair: Jika perintah gagal, diagnosa masalah, perbaiki, dan ulangi.\n3. Ringkas dan fokus pada penyelesaian masalah tanpa basa-basi.`,
  },
]

export default function AgentSpawnPanel({
  open,
  onClose,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [perms, setPerms] = useState<Permissions>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newRole, setNewRole] = useState<AgentRole>('backend')
  const [newDivision, setNewDivision] = useState<AgentDivision>('tech')
  const [newSoul, setNewSoul] = useState('')
  /**
   * Keahlian/domain: freetext koma ("meta-ads, reporting"). Disimpan di
   * marker SOUL.md (pemetaan office), TIDAK diumumkan ke A2A — skills di
   * agent card hanya bisa berisi toolset Hermes yang nyata.
   */
  const [newDomains, setNewDomains] = useState('')
  /**
   * Toolset yang diumumkan di agent card. Kosong = semua toolset.
   * Hanya nama toolset nyata (dari /api/hermes/toolsets), bukan tag bebas.
   */
  const [newToolsets, setNewToolsets] = useState<string[]>([])
  const [toolsetCatalog, setToolsetCatalog] = useState<{ name: string; enabled: boolean }[]>([])
  /**
   * Toggle A2A: default NYALA (permintaan operator: spawn dari mana pun harus
   * langsung A2A). Hidup = daftarkan served-agent (local:false). Berlaku
   * setelah gateway di-restart — form tidak janji "langsung aktif".
   */
  const [newServeA2a, setNewServeA2a] = useState(true)
  /** Domain yang tidak punya pemilik: dinyatakan apa adanya, bukan diarang. */
  const [domainOwners, setDomainOwners] = useState<Record<string, string | null>>({})
  /** Model untuk profil yang SEDANG dibuat; '' = bawaan Hermes. Terpisah dari `pick`
   *  (ganti model profil yang sudah ada) supaya dua alur itu tidak saling menimpa. */
  const [newModel, setNewModel] = useState('')
  const [soulPreview, setSoulPreview] = useState<string | null>(null)
  const [divFilter, setDivFilter] = useState<'all' | AgentDivision>('all')
  const [activeTab, setActiveTab] = useState<'create' | 'list'>('create')
  const [showStats, setShowStats] = useState(false)

  // Edit agent state
  const [editingAgent, setEditingAgent] = useState<Row | null>(null)
  const [editRole, setEditRole] = useState<AgentRole>('backend')
  const [editDivision, setEditDivision] = useState<AgentDivision>('tech')
  const [editDesc, setEditDesc] = useState('')
  const [editDomains, setEditDomains] = useState('')
  const [editModel, setEditModel] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  function startEdit(r: Row) {
    setEditingAgent(r)
    setEditRole((r.role as AgentRole) || 'backend')
    setEditDivision((r.division as AgentDivision) || 'tech')
    setEditDesc(r.reason || '')
    setEditDomains((r.domains || []).join(', '))
    setEditModel(r.model || '')
  }

  async function saveEdit() {
    if (!editingAgent) return
    setSavingEdit(true)
    setErr(null)
    setNote(null)
    try {
      const hit = models.find((m) => m.model === editModel)
      const res = await fetchJson('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          name: editingAgent.name,
          role: editRole,
          division: editDivision,
          description: editDesc.trim(),
          domains: editDomains.trim(),
          model: editModel || undefined,
          provider: editModel ? hit?.provider : undefined,
          useDefaultModel: !editModel,
        }),
      })
      if (!res.ok) throw new Error(res.error || 'gagal memperbarui profil agent')
      setNote(`Profil "${editingAgent.name}" berhasil diperbarui.`)
      setEditingAgent(null)
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSavingEdit(false)
    }
  }
  const [creating, setCreating] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /** id awaiting the second click before a destructive delete. */
  const [confirmKill, setConfirmKill] = useState<string | null>(null)
  const [models, setModels] = useState<ModelChoice[]>([])
  /** name -> model being picked but not yet saved. */
  const [pick, setPick] = useState<Record<string, string>>({})
  /**
   * Keadaan "butuh restart" dari server (SATU sumber kebenaran — pembanding
   * yang sama dipakai doctor). null = tak bisa dipastikan (tampil abu).
   */
  const [needsGatewayRestart, setNeedsGatewayRestart] = useState<boolean | null>(null)
  /** Pop up "silahkan restart server" — tampil setelah pendaftaran A2A sukses. */
  const [restartFor, setRestartFor] = useState<string | null>(null)

  // A click anywhere else cancels a pending delete.
  useEffect(() => {
    if (!confirmKill) return
    const cancel = () => setConfirmKill(null)
    window.addEventListener('click', cancel)
    return () => window.removeEventListener('click', cancel)
  }, [confirmKill])

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetchJson<{ available?: Row[]; permissions?: Permissions; domainOwners?: Record<string, string | null>; needsGatewayRestart?: boolean | null }>('/api/hermes/agents', {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(res.error || 'gagal memuat daftar agent')
      setRows(res.data?.available || [])
      setPerms(res.data?.permissions || {})
      setDomainOwners(res.data?.domainOwners || {})
      setNeedsGatewayRestart(res.data?.needsGatewayRestart ?? null)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  // Katalog toolset + model: config, bukan roster — fetch sekali per buka.
  useEffect(() => {
    if (!open) return
    if (!models.length) {
      let alive = true
      fetchJson<{ models?: ModelChoice[] }>('/api/hermes/models', { cache: 'no-store' }).then((res) => {
        if (alive && res.ok) setModels(res.data?.models || [])
      })
      return () => {
        alive = false
      }
    }
  }, [open, models.length])
  useEffect(() => {
    if (!open || toolsetCatalog.length) return
    let alive = true
    fetchJson<{ toolsets?: { name: string; enabled: boolean }[] }>('/api/hermes/toolsets', { cache: 'no-store' }).then((res) => {
      if (alive && res.ok) setToolsetCatalog(res.data?.toolsets || [])
    })
    return () => {
      alive = false
    }
  }, [open, toolsetCatalog.length])

  async function setModel(name: string, model: string) {
    setBusy(name)
    setErr(null)
    setNote(null)
    try {
      const hit = models.find((m) => m.model === model)
      const res = await fetchJson('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-model', name, model, provider: hit?.provider }),
      })
      if (!res.ok) throw new Error(res.error || 'gagal menyimpan model')
      setNote(`Model "${name}" diset ke ${model} — berlaku pada spawn/chat berikutnya.`)
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function act(action: 'spawn' | 'hide' | 'kill' | 'serve' | 'unserve', name: string) {
    setBusy(name)
    setErr(null)
    setNote(null)
    try {
      const res = await fetchJson<{
        purged?: number
        a2aNote?: string | null
        peerAdded?: boolean | null
        peerError?: string | null
        toolsetAdded?: boolean | null
        toolsetError?: string | null
        needsGatewayRestart?: boolean | null
      }>('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name }),
      })
      if (!res.ok) throw new Error(res.error || 'aksi gagal')
      const d = res.data
      if (action === 'kill') {
        const n = Number(d?.purged ?? 0)
        setNote(
          n > 0
            ? `"${name}" dihapus permanen bersama ${n} tugasnya`
            : `"${name}" dihapus permanen`,
        )
      } else if (action === 'hide') {
        setNote(`"${name}" disembunyikan — tugasnya tetap di papan`)
      } else if (action === 'serve') {
        // SELFREPAIR-1 Celah 1: jujur — terdaftar, tapi BERLAKU SETELAH
        // restart gateway (bukan langsung "siap"). A2A-CALL-1: pratinjau +
        // laporan kemampuan MEMANGGIL (peer + toolset, idempoten).
        const callBits: string[] = []
        if (d?.toolsetAdded === true) callBits.push('toolset a2a ditambahkan (bisa memanggil)')
        else if (d?.toolsetAdded === false && d?.toolsetError) callBits.push(`toolset a2a GAGAL (${d.toolsetError})`)
        else callBits.push('toolset a2a sudah ada (bisa memanggil)')
        if (d?.peerAdded === true) callBits.push(`peer ${name}-local didaftarkan`)
        else if (d?.peerAdded === false && d?.peerError) callBits.push(`peer GAGAL (${d.peerError})`)
        else callBits.push(`peer ${name}-local sudah ada`)
        setNote(`"${name}" ${d?.a2aNote ?? 'terdaftar. Berlaku setelah gateway di-restart.'} ${callBits.join(' · ')}.`)
        if (d?.needsGatewayRestart != null) setNeedsGatewayRestart(d.needsGatewayRestart)
      } else if (action === 'unserve') {
        setNote(`"${name}" ${d?.a2aNote ?? 'tercabut dari config.'}`)
      }
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function create() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setErr(null)
    setNote(null)
    setSoulPreview(null)
    try {
      const hit = models.find((m) => m.model === newModel)
      const res = await fetchJson<{
        name: string
        soulPreview?: string
        model?: string | null
        modelError?: string | null
        domains?: string[]
        a2aRegistered?: boolean | null
        a2aError?: string | null
        toolsetAdded?: boolean | null
        toolsetError?: string | null
        peerAdded?: boolean | null
        peerError?: string | null
        a2aNote?: string | null
        needsGatewayRestart?: boolean | null
      }>('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name,
          description: newDesc.trim(),
          role: newRole,
          division: newDivision,
          soul: newSoul.trim(),
          domains: newDomains.trim(),
          advertisedToolsets: newToolsets,
          serveA2a: newServeA2a,
          model: newModel || undefined,
          provider: newModel ? hit?.provider : undefined,
        }),
      })
      if (!res.ok || !res.data) throw new Error(res.error || 'gagal membuat profil')
      setNewName('')
      setNewDesc('')
      setNewSoul('')
      setNewDomains('')
      setNewToolsets([])
      setNewServeA2a(true)
      setNewModel('')
      setSoulPreview(res.data.soulPreview ?? null)
      // Laporkan model dari BALASAN server, bukan dari pilihan di form: kalau set-model
      // gagal, operator harus tahu agent ini jalan dengan bawaan Hermes.
      const modelNote = res.data.model
        ? `model ${res.data.model}`
        : res.data.modelError
          ? `model GAGAL diset (${res.data.modelError}) — sementara pakai bawaan Hermes`
          : 'model bawaan Hermes'
      const domNote = res.data.domains?.length ? `keahlian: ${res.data.domains.join(', ')} (pemetaan office, bukan A2A). ` : ''
      const a2aNote = res.data.a2aRegistered === true
        ? `${res.data.a2aNote ?? 'Tersimpan. Berlaku setelah gateway di-restart.'} `
        : res.data.a2aRegistered === false
          ? `GAGAL didaftarkan A2A (${res.data.a2aError}) — profilnya ada tapi belum terdaftar. `
          : 'A2A tidak didaftarkan (toggle mati) — profilnya ada tapi belum terdaftar. Nyalakan manual bila perlu. '
      // A2A-CALL-1: kemampuan MEMANGGIL ikut dilaporkan (pratinjau + laporan,
      // idempoten — dua kali jalan tak menggandakan).
      const callNote = res.data.a2aRegistered === true
        ? (res.data.toolsetAdded === true
          ? 'toolset a2a ditambahkan (bisa memanggil). '
          : res.data.toolsetAdded === false && res.data.toolsetError
            ? `toolset a2a GAGAL (${res.data.toolsetError}). `
            : 'toolset a2a sudah ada (bisa memanggil). ') +
          (res.data.peerAdded === true
            ? `peer ${res.data.name}-local didaftarkan (nama bisa diresolusi). `
            : res.data.peerAdded === false && res.data.peerError
              ? `peer GAGAL (${res.data.peerError}). `
              : `peer ${res.data.name}-local sudah ada. `)
        : ''
      setNote(`profil "${res.data.name}" dibuat, ${modelNote} — agent berjalan masuk lewat pintu utama. ${domNote}${a2aNote}${callNote}`)
      setNeedsGatewayRestart(res.data.needsGatewayRestart ?? null)
      // Pendaftaran A2A sukses → pop up "silahkan restart server". Gagal =
      // JANGAN tampilkan pop up sukses (catatan di atas sudah bilang gagal).
      if (res.data.a2aRegistered === true) setRestartFor(res.data.name)
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  if (!open) return null

  const matchDiv = (r: Row) => divFilter === 'all' || r.division === divFilter
  const inOffice = rows.filter((r) => r.inOffice && matchDiv(r))
  const out = rows.filter((r) => !r.inOffice && matchDiv(r))

  /** Badge role + divisi + indikator soul + status A2A. Aman bila field null (backend lama). */
  function badges(r: Row) {
    const roleLabel = r.role ? (ROLE_LABEL as Record<string, string>)[r.role] ?? r.role : null
    const divLabel = r.division ? (DIVISION_LABEL as Record<string, string>)[r.division] ?? null : null
    return (
      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
        {roleLabel && (
          <span className="vp-chip" title={`role: ${r.role}`}>
            {roleLabel}
          </span>
        )}
        {divLabel && (
          <span className="vp-chip" title={`divisi: ${r.division}`}>
            {divLabel}
          </span>
        )}
        {(r.domains?.length ?? 0) > 0 && (
          <span className="vp-chip" title={`keahlian (pemetaan office, bukan A2A): ${(r.domains ?? []).join(', ')}`}>
            {(r.domains ?? []).join(', ')}
          </span>
        )}
        {r.soulExists === true && (
          <span className="vp-chip" title="Profil ini punya SOUL.md sendiri">
            soul ✓
          </span>
        )}
        {r.soulExists === false && <span className="vp-tag-warn">tanpa soul</span>}
        {a2aBadge(r)}
      </span>
    )
  }

  /**
   * Checklist "A2A Ready" per agent — tiga nilai jujur, SATU sumber kebenaran
   * (entri served + needsGatewayRestart dari server, pembanding yang sama
   * dipakai doctor):
   * - ✅ A2A Ready: terdaftar DAN gateway sudah restart sesudahnya.
   * - 🟡 Terdaftar, belum aktif: ada entri tapi config lebih baru dari start.
   * - ❌ Belum terdaftar: tidak ada entri served.
   * needsGatewayRestart null = tak bisa dipastikan → abu, bukan hijau.
   */
  function a2aBadge(r: Row) {
    if (r.a2a !== 'served') {
      // SELFREPAIR-1 Celah 1: agent `unlisted` (profil ada, belum didaftarkan)
      // bisa didaftarkan dari UI — aksi `serve` + kalimat jujur (berlaku
      // setelah restart). Profil tak ada (null) = tak ada tombol.
      if (r.a2a === 'unlisted' && r.profile) {
        return (
          <span className="flex flex-wrap items-center gap-2">
            <span className="vp-tag-warn" title="Tidak ada entri di platforms.a2a.agents">
              ❌ Belum terdaftar A2A
            </span>
            <button
              className="vp-chip-btn"
              disabled={busy === r.name}
              onClick={(e) => {
                e.stopPropagation()
                void act('serve', r.name)
              }}
              title="Daftarkan profil ini di platforms.a2a.agents (local:false). Berlaku setelah gateway di-restart."
            >
              {busy === r.name ? '…' : 'daftarkan ke A2A'}
            </button>
          </span>
        )
      }
      return (
        <span className="vp-tag-warn" title="Tidak ada entri di platforms.a2a.agents — nyalakan A2A untuk agent ini">
          ❌ Belum terdaftar A2A — nyalakan A2A untuk agent ini
        </span>
      )
    }
    if (needsGatewayRestart === true) {
      return (
        <span className="vp-tag-warn" title="Ada di platforms.a2a.agents, tapi config.yaml lebih baru dari start gateway — daftar baru berlaku setelah restart">
          🟡 Terdaftar, belum aktif — butuh restart gateway
        </span>
      )
    }
    if (needsGatewayRestart === false) {
      return (
        <span className="vp-chip" title="Terdaftar DAN gateway sudah restart sesudahnya — benar-benar bisa dipanggil">
          ✅ A2A siap — agent ini bisa dipanggil sekarang
        </span>
      )
    }
    return (
      <span className="vp-tag-warn" title="Terdaftar, tapi waktu start gateway tak terbaca — tidak bisa dipastikan sudah aktif">
        A2A terdaftar (tak pasti aktif — start gateway tak terbaca)
      </span>
    )
  }

  /** Satu baris batas izin untuk role agent ini. Kosong bila role/tabel tidak ada. */
  function limits(r: Row) {
    const p = r.role ? perms[r.role] : undefined
    if (!p) return null
    const allow = p.allow.length
      ? p.allow.join(', ') + (p.anyTask ? '' : ' (task sendiri)')
      : '—'
    return (
      <span className="vp-muted" style={{ fontSize: 11 }} title="Batas izin bila aksi diminta atas nama agent ini">
        boleh: {allow} · tidak boleh: {p.deny.length ? p.deny.join(', ') : '—'}
      </span>
    )
  }

  function renderAgentCard(r: Row, isOffice: boolean) {
    const isSelected = editingAgent?.name === r.name
    const roleLabel = r.role ? (ROLE_LABEL as Record<string, string>)[r.role] ?? r.role : 'Tanpa Role'
    const divLabel = r.division ? (DIVISION_LABEL as Record<string, string>)[r.division] ?? null : null
    const domainsStr = (r.domains || []).join(', ')

    return (
      <div
        key={r.name}
        className={`rounded-lg border transition-all ${
          isSelected
            ? 'border-indigo-500 bg-slate-900 shadow-xl'
            : isOffice
              ? 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90'
              : 'border-slate-800/80 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900/40'
        }`}
      >
        {/* COMPACT ROW: HANYA NAMA & SPESIALISASI */}
        <div
          className="p-3 cursor-pointer flex items-center justify-between gap-3 select-none"
          onClick={() => {
            if (isSelected) {
              setEditingAgent(null)
            } else {
              startEdit(r)
            }
          }}
          title="Klik untuk membuka detail form & konfigurasi agent ini"
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base">🤖</span>
              <b className="text-sm text-slate-100 font-mono tracking-wide">{r.name}</b>
              {divLabel && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                  {divLabel}
                </span>
              )}
              {!r.profile && <span className="vp-tag-warn text-[10px]">tanpa profil</span>}
            </div>

            {/* SPESIALISASI AGENT: ROLE & DOMAINS */}
            <div className="text-xs text-slate-400 flex items-center gap-1.5 flex-wrap pl-6">
              <span className="text-indigo-300 font-medium">{roleLabel}</span>
              {domainsStr && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-300 font-mono text-[11px] bg-slate-800/80 px-1.5 py-0.5 rounded">
                    ⚡ {domainsStr}
                  </span>
                </>
              )}
              {r.model && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400 text-[11px]">
                    Model: <b className="text-cyan-400 font-mono">{r.model}</b>
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-semibold whitespace-nowrap ${
                isOffice
                  ? 'bg-emerald-950/70 border border-emerald-800/60 text-emerald-300'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {isOffice ? '🟢 Di Kantor' : '⚪ Di Luar'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {isSelected ? '▲' : '▼'}
            </span>
          </div>
        </div>

        {/* DETAIL FORM: HANYA TAMPIL KETIKA DIKLIK */}
        {isSelected && (
          <div className="p-4 border-t border-indigo-500/30 bg-slate-950/70 rounded-b-lg space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-xs font-semibold text-indigo-300">
                ⚙️ DETAIL & PENGATURAN AGENT: <span className="font-mono text-white">{r.name}</span>
              </span>
              <span className="text-[11px] text-slate-400">· {r.total} tugas kanban</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Divisi:</label>
                <select
                  className="vp-input w-full"
                  value={editDivision}
                  onChange={(e) => setEditDivision(e.target.value as AgentDivision)}
                >
                  {DIVISION_OPTIONS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Role / Jabatan:</label>
                <select
                  className="vp-input w-full"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as AgentRole)}
                >
                  {ROLE_OPTIONS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Spesialisasi / Keahlian (Domains):</label>
              <input
                className="vp-input w-full text-xs"
                value={editDomains}
                onChange={(e) => setEditDomains(e.target.value)}
                placeholder="misal: react, nextjs, docker, rest-api"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Deskripsi Job Desk / Tanggung Jawab:</label>
              <textarea
                className="vp-input w-full text-xs"
                rows={2}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Rincian tanggung jawab dan tugas spesifik agent ini..."
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Model AI Agent:</label>
              <ModelPicker
                value={editModel}
                onChange={setEditModel}
                models={models}
                emptyLabel="Mengikuti Default Hermes"
                title="Pilih model AI untuk agent ini"
              />
            </div>

            {/* Badges & Permissions preview */}
            <div className="pt-1">
              <div className="text-[10px] text-slate-400 mb-1">Status & Batasan Izin:</div>
              {badges(r)}
              <div className="mt-1">{limits(r)}</div>
            </div>

            {/* ACTION BUTTONS */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-2">
                {r.profile && (
                  <button
                    type="button"
                    className="vp-btn py-1 px-3 text-xs font-semibold"
                    disabled={savingEdit}
                    onClick={saveEdit}
                  >
                    {savingEdit ? 'Menyimpan…' : '💾 Simpan Perubahan'}
                  </button>
                )}
                {isOffice ? (
                  <button
                    type="button"
                    className="vp-btn text-xs py-1 px-3"
                    disabled={busy === r.name}
                    onClick={(e) => {
                      e.stopPropagation()
                      void act('hide', r.name)
                    }}
                    title="Keluarkan dari kantor virtual"
                  >
                    {busy === r.name ? '…' : '🚪 Sembunyikan'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="vp-btn text-xs py-1 px-3"
                    disabled={busy === r.name}
                    onClick={(e) => {
                      e.stopPropagation()
                      void act('spawn', r.name)
                    }}
                    title="Panggil masuk ke kantor virtual"
                  >
                    {busy === r.name ? '…' : '🚪 Spawn'}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {r.profile && (
                  <button
                    type="button"
                    className={`vp-btn vp-btn-danger text-xs py-1 px-3 ${confirmKill === r.name ? 'vp-btn-armed' : ''}`}
                    disabled={busy === r.name}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirmKill !== r.name) {
                        setConfirmKill(r.name)
                        return
                      }
                      void act('kill', r.name)
                    }}
                    title="Hapus profil ini permanen"
                  >
                    {busy === r.name ? '…' : confirmKill === r.name ? 'Yakin Hapus?' : '🗑️ Hapus (Kill)'}
                  </button>
                )}
                <button
                  type="button"
                  className="vp-btn text-xs py-1 px-2.5 text-slate-400"
                  onClick={() => setEditingAgent(null)}
                >
                  ✕ Tutup Form
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <FullPanel onClose={onClose} label="Agent" title="Agent" bodyClassName="vp-pad flex flex-col gap-3">
      {restartFor && <RestartNotice agentName={restartFor} onClose={() => setRestartFor(null)} />}

      {/* ======================================================== TABBAR NAVIGASI */}
      <div className="flex border-b border-slate-700 bg-slate-900/90 -mx-4 -mt-3 px-4 pt-2 gap-2">
        <button
          type="button"
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
            activeTab === 'create'
              ? 'border-indigo-500 text-indigo-300 bg-indigo-950/40 shadow-sm'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
          onClick={() => setActiveTab('create')}
        >
          <span>✨</span> Buat Agent Baru
        </button>
        <button
          type="button"
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
            activeTab === 'list'
              ? 'border-indigo-500 text-indigo-300 bg-indigo-950/40 shadow-sm'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
          onClick={() => setActiveTab('list')}
        >
          <span>👥</span> Daftar Agent (Agent List)
          <span className="ml-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 border border-slate-700">
            {rows.length}
          </span>
        </button>
      </div>

      {needsGatewayRestart === true && (
        <div className="vp-err">
          🟡 Config lebih baru dari start gateway — entri served tersimpan tapi BELUM aktif. Restart gateway untuk
          mengaktifkannya.
        </div>
      )}

      {err && <div className="vp-err">{err}</div>}
      {note && <div className="vp-ok">{note}</div>}
      {soulPreview && (
        <div className="vp-ok">
          <b>Soul tersimpan:</b>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 11 }}>{soulPreview}</pre>
        </div>
      )}
      {loading && <div className="vp-muted">memuat…</div>}

      {activeTab === 'create' ? (
        <>

      {/* ======================================================== FORM BUAT AGENT */}
      <div className="rounded-lg border border-slate-700 bg-slate-900/90 p-4 shadow-xl space-y-4">
        <div className="border-b border-slate-700 pb-2">
          <h3 className="text-sm font-bold tracking-wide text-indigo-300 uppercase flex items-center gap-2">
            <span>✨</span> FORM PEMBUATAN AGENT BARU
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Definisikan identitas, peran, soul (anti-halusinasi), skill spesifik, dan alat eksekusi agent dengan jelas.
          </p>
        </div>

        {/* ---------------- 1. IDENTITAS & PERAN ---------------- */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200 uppercase tracking-wider">
            <span>👤</span> 1. Identitas & Peran Agent
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-300 mb-1">
              ID Panggilan Agent <span className="text-rose-400">*</span>
            </label>
            <input
              className="vp-input w-full font-mono text-xs"
              value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              placeholder="Contoh: dev-lead, content-1, seo-analyst"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create()
              }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Divisi <span className="text-rose-400">*</span>
              </label>
              <select
                className="vp-input w-full"
                value={newDivision}
                onChange={(e) => setNewDivision(e.target.value as AgentDivision)}
              >
                {DIVISION_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Role / Jabatan <span className="text-rose-400">*</span>
              </label>
              <select
                className="vp-input w-full"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as AgentRole)}
              >
                {ROLE_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-300 mb-1">
              Deskripsi Tugas Singkat
            </label>
            <input
              className="vp-input w-full text-xs"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Misal: Bertanggung jawab atas API, database Postgres, dan docker container"
            />
          </div>
        </div>

        {/* ---------------- 2. SOUL & ANTI-HALUSINASI ---------------- */}
        <div className="rounded-xl border border-indigo-900/60 bg-indigo-950/20 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300 uppercase tracking-wider">
              <span>🧠</span> 2. Karakter & Pedoman SOUL
            </div>
            <span className="rounded-full bg-indigo-900/70 text-indigo-200 px-2 py-0.5 text-[10px] font-bold border border-indigo-700/50">
              Anti-Halusinasi
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SOUL_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setNewSoul(preset.text(newName, newRole, newDivision))}
                className="text-[11px] rounded-lg border border-indigo-700/60 bg-indigo-900/40 px-2.5 py-1 text-indigo-200 hover:bg-indigo-800/60 hover:text-white transition-all font-medium"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div>
            <textarea
              className="vp-input w-full font-mono text-[11px]"
              value={newSoul}
              onChange={(e) => setNewSoul(e.target.value)}
              placeholder="Instruksi dan kepribadian agent (kosong = template standar otomatis)..."
              rows={3}
            />
          </div>
        </div>

        {/* ---------------- 3. SKILL & DOMAIN SPESIFIK ---------------- */}
        <div className="rounded border border-slate-800 bg-slate-800/40 p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider">
            <span>⚡</span> 3. SKILL & DOMAIN KEAHLIAN SPESIFIK (COMPETENCIES)
          </div>

          <p className="text-[11px] text-slate-400">
            Daftar kompetensi atau domain topik spesifik yang dikuasai agent (pisahkan dengan koma). Membantu kantor memetakan keahlian agent ke task yang sesuai:
          </p>

          <input
            className="vp-input w-full"
            value={newDomains}
            onChange={(e) => setNewDomains(e.target.value)}
            placeholder="cth: nodejs, postgresql, docker, rest-api (pisah dengan koma)"
          />

          {/* Rekomendasi skill instan sesuai role */}
          {SKILL_SUGGESTIONS[newRole] && (
            <div className="pt-1">
              <span className="text-[10px] text-slate-400 block mb-1">Rekomendasi skill untuk role ini (klik untuk menambahkan):</span>
              <div className="flex flex-wrap gap-1">
                {SKILL_SUGGESTIONS[newRole].map((skill) => {
                  const currentList = newDomains.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
                  const has = currentList.includes(skill)
                  return (
                    <button
                      key={skill}
                      type="button"
                      disabled={has}
                      onClick={() => {
                        const updated = has ? currentList : [...currentList, skill]
                        setNewDomains(updated.join(', '))
                      }}
                      className={`text-[10px] rounded px-1.5 py-0.5 border ${
                        has
                          ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300 opacity-60'
                          : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500 hover:text-white'
                      }`}
                    >
                      {has ? '✓ ' : '+ '}
                      {skill}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ---------------- 4. TOOLSET HERMES (ALAT EKSEKUSI NYATA) ---------------- */}
        <div className="rounded border border-slate-800 bg-slate-800/40 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider">
              <span>🛠️</span> 4. TOOLSET HERMES (ALAT EKSEKUSI NYATA)
            </div>
            <span className="text-[10px] text-slate-400">
              {newToolsets.length ? `${newToolsets.length} terpilih` : 'Semua tool diizinkan'}
            </span>
          </div>

          <p className="text-[11px] text-slate-400">
            Alat eksekusi resmi dari platform Hermes yang diumumkan di agent card. Kosongkan jika ingin mengizinkan seluruh toolset:
          </p>

          <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1 rounded bg-slate-950/40 border border-slate-800">
            {toolsetCatalog.map((t) => {
              const on = newToolsets.includes(t.name)
              return (
                <button
                  key={t.name}
                  type="button"
                  className={`vp-chip-btn ${on ? 'on' : ''}`}
                  disabled={creating}
                  onClick={() =>
                    setNewToolsets((prev) => (prev.includes(t.name) ? prev.filter((x) => x !== t.name) : [...prev, t.name]))
                  }
                  title={`${t.name}${t.enabled ? '' : ' (nonaktif di install ini)'}`}
                  style={{ opacity: t.enabled ? 1 : 0.55 }}
                >
                  {on ? '✓ ' : ''}{t.name}
                </button>
              )
            })}
            {!toolsetCatalog.length && <span className="vp-muted text-[11px]">memuat daftar toolset…</span>}
          </div>
        </div>

        {/* ---------------- 5. MODEL AI AGENT ---------------- */}
        <div className="rounded border border-slate-800 bg-slate-800/40 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider">
              <span>🤖</span> 5. MODEL AI AGENT (BRAIN)
            </div>
            <span className="text-[10px] text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/50">
              Default: Profile Hermes
            </span>
          </div>

          <p className="text-[11px] text-slate-400">
            Pilih model AI khusus untuk agent ini, atau biarkan kosong untuk otomatis <b>mengikuti model default profile Hermes</b>:
          </p>

          <ModelPicker
            value={newModel}
            onChange={setNewModel}
            models={models}
            disabled={creating}
            emptyLabel="Mengikuti Default Profile Hermes"
            title="Model untuk agent baru ini (kosong = otomatis mengikuti default Hermes)"
          />
        </div>

        {/* ---------------- 6. KONEKSI AGENT-TO-AGENT (A2A) ---------------- */}
        <div className="rounded border border-slate-800 bg-slate-800/40 p-3">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-slate-600 bg-slate-800 text-indigo-500"
              checked={newServeA2a}
              disabled={creating}
              onChange={(e) => setNewServeA2a(e.target.checked)}
            />
            <div className="text-[11px]">
              <span className="font-semibold text-slate-200 block">
                Bisa dihubungi agent lain (A2A) — otomatis terdaftar A2A; berlaku setelah gateway di-restart
              </span>
              <span className="text-slate-400 block mt-0.5">
                Mendaftarkan profil ini ke platforms.a2a.agents (local:false) agar agent lain dapat memanggil dan berkoordinasi.
              </span>
            </div>
          </label>
        </div>

        {/* Tombol Buat Profil */}
        <div className="pt-2 flex items-center gap-2">
          <button
            className="vp-btn flex-1 py-2 font-semibold text-sm shadow-md"
            disabled={creating || !newName.trim()}
            onClick={create}
          >
            {creating ? 'Membuat Profil Agent…' : '✨ Buat Profil Agent Baru'}
          </button>
          <button className="vp-btn vp-btn-rosy py-2" disabled={!!busy} onClick={load}>
            Segarkan
          </button>
        </div>

        <button
          type="button"
          className="vp-btn w-full py-2 text-xs text-indigo-300 border border-indigo-900/50 bg-indigo-950/30 flex items-center justify-center gap-1.5"
          onClick={() => setActiveTab('list')}
        >
          <span>👥</span> Lihat & Kelola Daftar Agent ({rows.length}) →
        </button>
      </div>
      </>
    ) : (
      <>
        {/* ======================================================== DAFTAR AGENT (LIST) */}
        {/* Ringkasan status kantor & profil (Buka / Tutup) */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 overflow-hidden mb-1">
          <button
            type="button"
            onClick={() => setShowStats(!showStats)}
            className="w-full flex items-center justify-between p-2.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800/50 transition-colors"
            title="Klik untuk membuka/menutup ringkasan status kantor"
          >
            <span className="flex items-center gap-2 font-semibold">
              <span>📊</span>
              <span>Ringkasan Status Kantor</span>
              <span className="text-[11px] text-slate-400 font-normal">
                ({inOffice.length} di kantor · {rows.length} profil)
              </span>
            </span>
            <span className="text-[11px] text-indigo-400 font-medium">
              {showStats ? 'Tutup ▲' : 'Buka ▼'}
            </span>
          </button>
          {showStats && (
            <div className="p-3 border-t border-slate-800/80 bg-slate-950/40 space-y-2">
              <div className="vp-kv">
                <span>di kantor</span>
                <b>{inOffice.length}</b>
              </div>
              <div className="vp-kv">
                <span>profil tersedia</span>
                <b>{rows.length}</b>
              </div>

              {/*
                Pemetaan domain→pemilik (dipakai office, bukan A2A). Domain tanpa
                pemilik = null → TAMPILKAN "tidak ada pemilik", jangan mengarang.
              */}
              {Object.keys(domainOwners).length > 0 && (
                <>
                  <div className="vp-sub mt-2">SIAPA PEGANG APA (OFFICE, BUKAN A2A)</div>
                  <div className="flex flex-col gap-1">
                    {Object.entries(domainOwners).map(([d, owner]) => (
                      <div key={d} className="vp-kv">
                        <span>{d}</span>
                        <b>{owner ?? 'tidak ada pemilik'}</b>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="vp-sub">FILTER DIVISI</div>
        <select
          className="vp-input"
          value={divFilter}
          onChange={(e) => setDivFilter(e.target.value as 'all' | AgentDivision)}
          title="Filter daftar agent per divisi"
        >
          <option value="all">Semua</option>
          {DIVISION_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>

        <div className="vp-sub">DI KANTOR ({inOffice.length})</div>
        <div className="flex flex-col gap-2">
          {inOffice.map((r) => renderAgentCard(r, true))}
          {confirmKill && (
            <div className="vp-cron-err">
              Menghapus <b>{confirmKill}</b> permanen — profil, sesi, memori, kunci,
              <b> dan {inOffice.find((x) => x.name === confirmKill)?.total ?? 0} tugasnya</b>.
              Klik di tempat lain untuk batal.
            </div>
          )}
          {!inOffice.length && <span className="vp-muted">kosong</span>}
        </div>

        {out.length > 0 && (
          <>
            <div className="vp-sub">DI LUAR ({out.length})</div>
            <div className="flex flex-col gap-2">
              {out.map((r) => renderAgentCard(r, false))}
            </div>
          </>
        )}
      </>
    )}
  </FullPanel>
)
}
