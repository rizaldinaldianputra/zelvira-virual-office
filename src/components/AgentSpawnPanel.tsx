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

  return (
    <FullPanel onClose={onClose} label="Agent" title="Agent" bodyClassName="vp-pad flex flex-col gap-3">
      {restartFor && <RestartNotice agentName={restartFor} onClose={() => setRestartFor(null)} />}
      <div className="vp-kv">
        <span>di kantor</span>
        <b>{inOffice.length}</b>
      </div>
      <div className="vp-kv">
        <span>profil tersedia</span>
        <b>{rows.length}</b>
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
        <div className="rounded border border-slate-800 bg-slate-800/40 p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider">
            <span>👤</span> 1. IDENTITAS & PERAN UTAMA (IDENTITY & ROLE)
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Nama Profil / ID Panggilan Agent: <span className="text-red-400">*</span>
            </label>
            <input
              className="vp-input w-full"
              value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              placeholder="misal: satria, budi, maya (huruf kecil tanpa spasi)"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create()
              }}
            />
            <span className="text-[10px] text-slate-500 block mt-0.5">
              ID unik profil Hermes di sistem. Digunakan saat chat, penugasan kanban, dan koordinasi antar-agent.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Divisi Kantor: <span className="text-red-400">*</span>
              </label>
              <select
                className="vp-input w-full"
                value={newDivision}
                onChange={(e) => setNewDivision(e.target.value as AgentDivision)}
                title="Divisi agent di kantor"
              >
                {DIVISION_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Spesialisasi Role / Jabatan: <span className="text-red-400">*</span>
              </label>
              <select
                className="vp-input w-full"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as AgentRole)}
                title="Spesialisasi peran agent"
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
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Deskripsi Publik Agent Card (A2A Discovery):
            </label>
            <textarea
              className="vp-input w-full"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Deskripsi ringkas yang dibaca agent lain saat discovery. Tulis cakupan tugas, misal: Menangani API backend, optimasi query Postgres, dan deployment container. Hubungi untuk integrasi service atau bug server."
              rows={2}
            />
            <span className="text-[10px] text-slate-500 block mt-0.5">
              Teks ini dibaca oleh AI agent lain di kantor untuk mengetahui kapan harus mendelegasikan tugas ke agent ini.
            </span>
          </div>
        </div>

        {/* ---------------- 2. SOUL & ANTI-HALUSINASI ---------------- */}
        <div className="rounded border border-indigo-900/60 bg-indigo-950/20 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300 uppercase tracking-wider">
              <span>🧠</span> 2. SOUL & PEDOMAN ANTI-HALUSINASI (SYSTEM PROMPT)
            </div>
            <span className="rounded bg-indigo-900/70 text-indigo-200 px-1.5 py-0.5 text-[10px] font-medium">
              No Halu · Verifikasi Wajib
            </span>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            <b>Soul</b> adalah kepribadian dan pedoman instruksi eksekusi utama agent. Untuk memastikan agent
            bekerja sesuai harapan dan <b>tidak berhalusinasi (tanpa ngarang jawaban)</b>, pilih template pedoman
            ketat di bawah atau tulis aturan kustom Anda:
          </p>

          <div className="flex flex-wrap gap-1.5">
            {SOUL_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setNewSoul(preset.text(newName, newRole, newDivision))}
                className="text-[11px] rounded border border-indigo-700/60 bg-indigo-900/40 px-2 py-1 text-indigo-200 hover:bg-indigo-800/60 hover:text-white transition-colors"
                title={preset.desc}
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
              placeholder="Isi instruksi kerja & kepribadian agent... (Kosong = otomatis memakai template anti-halusinasi standar per role)"
              rows={4}
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
      </div>

      {/*
        Pemetaan domain→pemilik (dipakai office, bukan A2A). Domain tanpa
        pemilik = null → TAMPILKAN "tidak ada pemilik", jangan mengarang.
      */}
      {Object.keys(domainOwners).length > 0 && (
        <>
          <div className="vp-sub">SIAPA PEGANG APA (OFFICE, BUKAN A2A)</div>
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
        {inOffice.map((r) => (
          <div key={r.name} className="vp-agent-row">
            <div className="vp-agent-meta">
              <b>
                {r.name}
                {!r.profile && <span className="vp-tag-warn">tanpa profil</span>}
              </b>
              <i>{r.total} tugas</i>
              {badges(r)}
              {limits(r)}
            </div>
            {/* The profile's default model: what its workers and chats run.
                Saving here writes `model.default` for that profile, so it
                applies to every future spawn — not just one task. */}
            {r.profile && (
              <div className="vp-agent-model">
                <ModelPicker
                  value={pick[r.name] ?? r.model ?? ''}
                  onChange={(model) => setPick((p) => ({ ...p, [r.name]: model }))}
                  models={models}
                  disabled={busy === r.name}
                  emptyLabel="bawaan Hermes"
                  title="Model bawaan profil ini"
                />
                <button
                  className="vp-btn"
                  disabled={busy === r.name || (pick[r.name] ?? r.model ?? '') === (r.model ?? '')}
                  onClick={(e) => {
                    e.stopPropagation()
                    void setModel(r.name, pick[r.name] ?? '')
                  }}
                >
                  {busy === r.name ? '…' : 'Set'}
                </button>
              </div>
            )}
            {/* Two different things, so two different buttons, and now two
                different actions. A name with no profile on disk is an assignee
                left behind by a task whose profile was deleted — there is
                nothing to delete, and hiding it is the ONLY safe operation:
                sending it to `kill` purged its tasks permanently while the
                button said "tanpa menghapus apa pun". */}
            <div className="flex gap-2">
              <button
                className="vp-btn"
                disabled={busy === r.name}
                onClick={(e) => {
                  e.stopPropagation()
                  void act('hide', r.name)
                }}
                title="Keluarkan nama ini dari kantor tanpa menghapus apa pun"
              >
                {busy === r.name ? '…' : 'Sembunyikan'}
              </button>
              {r.profile && (
                <button
                  className={`vp-btn vp-btn-danger ${confirmKill === r.name ? 'vp-btn-armed' : ''}`}
                  disabled={busy === r.name}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirmKill !== r.name) {
                      setConfirmKill(r.name)
                      return
                    }
                    void act('kill', r.name)
                  }}
                  title="Menghapus profil ini permanen, termasuk sesi dan kuncinya"
                >
                  {busy === r.name ? '…' : confirmKill === r.name ? 'Yakin hapus?' : 'Kill'}
                </button>
              )}
            </div>
          </div>
        ))}
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
            {out.map((r) => (
              <div key={r.name} className="vp-agent-row off">
                <div className="vp-agent-meta">
                  <b>
                    {r.name}
                    {!r.profile && <span className="vp-tag-warn">tanpa profil</span>}
                  </b>
                  <i>
                    {r.reason === 'hidden'
                      ? 'disembunyikan'
                      : r.reason === 'no_profile'
                        ? 'tanpa profil di disk'
                        : 'tanpa tugas'}
                  </i>
                  {badges(r)}
                  {limits(r)}
                </div>
                <button
                  className="vp-btn"
                  disabled={busy === r.name}
                  onClick={() => act('spawn', r.name)}
                  title="Agent masuk lewat pintu utama dan berjalan ke mejanya"
                >
                  {busy === r.name ? '…' : 'Spawn'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </FullPanel>
  )
}
