'use client'

/**
 * Panel "SISTEM" — keadaan Hermes yang sebenarnya.
 *
 * Kenapa panel ini ada: kantor 3D-nya bagus, tapi BUTA. Provider bisa balas 520 beruntun,
 * agent bisa diam, dan kantornya tetap terlihat baik-baik saja. Panel ini membuat kegagalan
 * terlihat.
 *
 * Prinsip yang dipegang di sini:
 *
 *   1. SETIAP ANGKA PUNYA UMUR. Kalau data terakhir lebih tua dari ambangnya, panel bilang
 *      BASI — bukan menampilkan angka lama seolah-olah sekarang. Panel yang menampilkan
 *      keadaan lama tanpa memberi tahu adalah panel yang berbohong.
 *
 *   2. MODEL TANPA HARGA BUKAN $0. Nol palsu lebih berbahaya daripada tidak ada angka,
 *      karena operator akan mengira gratis. Jadi yang tidak diketahui ditulis "harga belum
 *      diisi", dan jumlahnya dipisahkan dari total.
 *
 *   3. YANG DILAPORKAN ADALAH SEBABNYA, BUKAN DAFTARNYA. Error dikelompokkan jadi
 *      "provider 5xx: 12x", bukan 400 baris log.
 */

import { useCallback, useEffect, useState } from 'react'
import FullPanel from './FullPanel'
import { useOffice } from '@/lib/store'
import { fetchJson } from '@/lib/api'
import type { ModelChoice } from './ModelPicker'

type UsageRow = {
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  apiCalls: number
  costUsd: number | null
}

type ProviderStat = {
  provider: string
  calls: number
  failures: number
  failureRate: number
  models: string[]
  confident: boolean
}

type FallbackPlan =
  | { kind: 'empty'; current: { provider: string; model: string }[] }
  | { kind: 'propose'; current: unknown[]; proposed: { provider: string; model: string }[]; why: string }
  | { kind: 'none'; current: unknown[]; why: string }

type Observability = {
  providers?: { providers: ProviderStat[]; candidates: ProviderStat[]; windowHours: number; failure?: string }
  fallback?: FallbackPlan
  status: {
    pricingModels: number
    sources: { name: string; found: boolean; ageSeconds: number | null }[]
  }
  usage: {
    readAt: string
    ageSeconds: number
    totalTokens: number
    totalInput: number
    totalOutput: number
    totalCache: number
    knownCostUsd: number
    windowDays: number
    unpricedModels: string[]
    unpricedTokens: number
    rows: UsageRow[]
    recentSessions: { id: string; model: string; inputTokens: number; outputTokens: number; costUsd: number | null }[]
  }
  errors: {
    ageSeconds: number
    total: number
    buckets: { kind: string; count: number; sample: string }[]
    recent: string[]
  }
}

type Approvals = {
  policy: { mode: string | null; timeoutSec: number | null; denyCount: number; ageSeconds: number; failure?: string }
  patterns: {
    count: number
    windowDays: number
    proposals: { pattern: string; kind: string; count: number }[]
    ageSeconds: number
    failure?: string
  }
  pending: { id: string; title: string; reason: { kind: string; reason: string } }[]
  blockedAgents: string[]
  notRead?: number
}

/** Ambang "basi". Bukan angka ajaib: 10 menit untuk log, 1 jam untuk basis data pemakaian. */
const STALE_LOG = 600
const STALE_DB = 3600
/** 5 menit untuk persetujuan — sama dengan APPROVAL_STALE_SEC di lib/hermes/approvals.ts. */
const STALE_APPROVAL = 300

const nfmt = (n: number) => n.toLocaleString('id-ID')
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`
const tok = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} M` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} jt` : nfmt(n))

function age(sec: number | null): string {
  if (sec == null || sec < 0) return '—'
  if (sec < 60) return `${sec} dtk`
  if (sec < 3600) return `${Math.floor(sec / 60)} mnt`
  if (sec < 86400) return `${Math.floor(sec / 3600)} jam`
  return `${Math.floor(sec / 86400)} hari`
}

export default function SystemPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<Observability | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [days, setDays] = useState(30)
  const [notice, setNotice] = useState<string | null>(null)
  const [appr, setAppr] = useState<Approvals | null>(null)
  const [apprErr, setApprErr] = useState<string | null>(null)
  /**
   * "Butuh restart gateway?" — SATU sumber kebenaran: dibaca dari
   * /api/hermes/agents (pembanding mtime config vs start gateway yang SAMA
   * dipakai doctor). Panel ini TIDAK menghitung ulang. null = tak pasti.
   */
  const [needsGatewayRestart, setNeedsGatewayRestart] = useState<boolean | null>(null)
  const work = useOffice((st) => st.work)

  // Model settings state
  const [modelData, setModelData] = useState<{
    models: ModelChoice[]
    defaultModel: string | null
    defaultProvider: string | null
    profiles: { name: string; model: string | null; provider: string | null; isDefault: boolean }[]
  } | null>(null)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelBusy, setModelBusy] = useState(false)
  const [modelMsg, setModelMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Catalog model selection
  const [selectedCatalogModel, setSelectedCatalogModel] = useState('')
  const [applyCatalogToAll, setApplyCatalogToAll] = useState(true)

  // Custom provider input
  const [customApiKey, setCustomApiKey] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [customProviderName, setCustomProviderName] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customSetAsDefault, setCustomSetAsDefault] = useState(true)
  const [customApplyToAll, setCustomApplyToAll] = useState(true)
  const [modelTab, setModelTab] = useState<'catalog' | 'custom' | 'project'>('catalog')

  // Project & Server Integration state
  const [projectConfig, setProjectConfig] = useState({
    ecommercePath: '/var/www/ecommerce',
    framework: 'Next.js / Node.js / PostgreSQL',
    serverHost: 'VM-32-155-ubuntu (127.0.0.1)',
    projectDescription: 'Zelvira E-Commerce Ecosystem (Storefront, Keranjang Belanja, Katalog Produk, & Blog)',
    dbEnabled: true,
    dbHost: '127.0.0.1',
    dbPort: 5432,
    dbName: 'ecommerce',
    dbUser: 'postgres',
    dbPassword: '',
    dbReadOnly: true,
    dbKeyTables: 'products, categories, articles, content_posts, users, orders',
    adminPortalUrl: 'https://admin.zelvira.my.id',
    adminAuthType: 'api_token' as 'api_token' | 'credentials',
    adminToken: '',
    adminUsername: 'content_creator',
    adminPassword: '',
    adminContentEndpoint: '/api/articles',
    adminForceDraft: true,
    allowBashExecution: true,
    requireConfirmationForDestructive: true,
  })
  const [projectBusy, setProjectBusy] = useState(false)
  const [projectMsg, setProjectMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [projectTest, setProjectTest] = useState<{
    ecommerceFolderExists: boolean
    adminPortalReachable: boolean
    adminPortalStatus: string
    dbConfigValid: boolean
    dbSummary: string
    message: string
  } | null>(null)
  const [projectTesting, setProjectTesting] = useState(false)

  const loadModels = useCallback(async () => {
    setModelLoading(true)
    try {
      const res = await fetchJson<{
        models: ModelChoice[]
        defaultModel: string | null
        defaultProvider: string | null
        profiles: { name: string; model: string | null; provider: string | null; isDefault: boolean }[]
      }>('/api/hermes/models')
      if (res.ok && res.data) {
        setModelData(res.data)
        if (res.data.defaultModel && !selectedCatalogModel) {
          setSelectedCatalogModel(res.data.defaultModel)
        }
      }
    } catch (e) {
      console.error('Failed to load models:', e)
    } finally {
      setModelLoading(false)
    }
  }, [selectedCatalogModel])

  const handleApplyCatalogModel = async () => {
    if (!selectedCatalogModel) return
    setModelBusy(true)
    setModelMsg(null)
    try {
      const found = modelData?.models.find((m) => m.model === selectedCatalogModel)
      const res = await fetchJson<{ success: boolean; appliedToProfiles?: string[] }>('/api/hermes/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setDefault',
          model: selectedCatalogModel,
          provider: found?.provider,
          applyToAllProfiles: applyCatalogToAll,
        }),
      })
      if (!res.ok) throw new Error(res.error || 'Gagal mengubah model default')
      setModelMsg({
        type: 'ok',
        text: `Model default diubah ke "${selectedCatalogModel}"${
          applyCatalogToAll ? ` dan diterapkan ke ${res.data?.appliedToProfiles?.length ?? 0} profil agent.` : '.'
        }`,
      })
      await loadModels()
    } catch (e) {
      setModelMsg({ type: 'err', text: (e as Error).message })
    } finally {
      setModelBusy(false)
    }
  }

  const handleSaveCustomProvider = async () => {
    if (!customApiKey.trim() || !customModel.trim()) return
    setModelBusy(true)
    setModelMsg(null)
    try {
      const res = await fetchJson<{ success: boolean; profilesUpdated?: string[] }>('/api/hermes/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setCustomProvider',
          name: customProviderName.trim() || 'custom',
          apiKey: customApiKey.trim(),
          baseUrl: customBaseUrl.trim() || undefined,
          model: customModel.trim(),
          setAsDefault: customSetAsDefault,
          applyToAllProfiles: customApplyToAll,
        }),
      })
      if (!res.ok) throw new Error(res.error || 'Gagal menyimpan custom provider')
      setModelMsg({
        type: 'ok',
        text: `Provider & Model "${customModel}" berhasil disimpan${
          customApplyToAll ? ` dan diterapkan ke ${res.data?.profilesUpdated?.length ?? 0} profil agent.` : '.'
        }`,
      })
      setCustomApiKey('')
      await loadModels()
    } catch (e) {
      setModelMsg({ type: 'err', text: (e as Error).message })
    } finally {
      setModelBusy(false)
    }
  }

  const handleSyncAllProfiles = async () => {
    setModelBusy(true)
    setModelMsg(null)
    try {
      const res = await fetchJson<{ success: boolean; profilesUpdated?: string[]; defaultModel?: string }>('/api/hermes/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'syncAll' }),
      })
      if (!res.ok) throw new Error(res.error || 'Gagal menyamakan profil')
      setModelMsg({
        type: 'ok',
        text: `Seluruh profil agent (${res.data?.profilesUpdated?.length ?? 0} agent) berhasil disamakan mengikuti model default "${res.data?.defaultModel}".`,
      })
      await loadModels()
    } catch (e) {
      setModelMsg({ type: 'err', text: (e as Error).message })
    } finally {
      setModelBusy(false)
    }
  }

  const handleResetProfile = async (name: string) => {
    if (!modelData?.defaultModel) return
    setModelBusy(true)
    setModelMsg(null)
    try {
      const res = await fetchJson<{ success: boolean }>('/api/hermes/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setProfileModel',
          name,
          model: modelData.defaultModel,
          provider: modelData.defaultProvider,
        }),
      })
      if (!res.ok) throw new Error(res.error || `Gagal me-reset profil ${name}`)
      setModelMsg({
        type: 'ok',
        text: `Profil "${name}" berhasil di-reset mengikuti default Hermes ("${modelData.defaultModel}").`,
      })
      await loadModels()
    } catch (e) {
      setModelMsg({ type: 'err', text: (e as Error).message })
    } finally {
      setModelBusy(false)
    }
  }

  const [reloadingAll, setReloadingAll] = useState(false)
  const [reloadMsg, setReloadMsg] = useState<{ type: 'ok' | 'err'; text: string; manualCmd?: string } | null>(null)

  const handleReloadAllHermes = async () => {
    setReloadingAll(true)
    setReloadMsg(null)
    try {
      // 1. Sinkronkan seluruh profil agent ke model default Hermes (misal nvidia/nemotron-3-ultra-55)
      const syncRes = await fetchJson<{ success: boolean; profilesUpdated?: string[]; defaultModel?: string }>('/api/hermes/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'syncAll' }),
      })
      if (!syncRes.ok) {
        throw new Error(syncRes.error || 'Gagal menyamakan profil ke model default')
      }

      // 2. Jadwalkan restart gateway Hermes
      const restartRes = await fetchJson<{
        success: boolean
        scheduled?: boolean
        message?: string
        manual?: string[]
      }>('/api/hermes/gateway-restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })

      const defModel = syncRes.data?.defaultModel || modelData?.defaultModel || 'default'
      const updatedCount = syncRes.data?.profilesUpdated?.length ?? 0

      if (restartRes.ok && restartRes.data?.scheduled) {
        setReloadMsg({
          type: 'ok',
          text: `✅ Sukses! ${updatedCount} profil agent disamakan ke model "${defModel}", dan Gateway Hermes dijadwalkan restart.`,
        })
      } else {
        setReloadMsg({
          type: 'ok',
          text: `✅ ${updatedCount} profil agent disamakan ke model "${defModel}". Gateway restart dapat dipicu manual: hermes gateway restart`,
          manualCmd: 'hermes gateway restart',
        })
      }

      await load()
      await loadModels()
      await loadRestart()
    } catch (e) {
      setReloadMsg({ type: 'err', text: (e as Error).message })
    } finally {
      setReloadingAll(false)
    }
  }

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/hermes/observability?days=${days}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message || 'gagal membaca keadaan sistem')
      setData(json)
      setErr(null)
    } catch (e) {
      // Gagal membaca BUKAN alasan menampilkan angka lama. Panelnya harus bilang dia tidak tahu.
      setErr((e as Error).message)
      setData(null)
    } finally {
      setBusy(false)
    }
  }, [days])

  // Dipisah dari `load`: pembacaan pola (`approvals suggest`) bisa makan 25 detik, dan itu tidak
  // boleh menahan angka biaya dan error yang sudah siap.
  const loadApprovals = useCallback(async () => {
    try {
      const res = await fetch('/api/hermes/approvals', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message || 'gagal membaca persetujuan')
      setAppr(json)
      setApprErr(null)
    } catch (e) {
      // Sama dengan `load`: gagal = bilang tidak tahu, bukan menampilkan daftar tunggu lama.
      setApprErr((e as Error).message)
      setAppr(null)
    }
  }, [])

  /**
   * Keadaan restart: ikut poll yang sama, tapi dari SATU sumber kebenaran
   * (/api/hermes/agents). Gagal dibaca = null (tak pasti), bukan hijau.
   */
  const loadRestart = useCallback(async () => {
    try {
      const res = await fetch('/api/hermes/agents', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message || 'gagal membaca keadaan restart')
      setNeedsGatewayRestart(json?.needsGatewayRestart ?? null)
    } catch {
      setNeedsGatewayRestart(null)
    }
  }, [])

  const loadProjectConfig = useCallback(async () => {
    try {
      const res = await fetchJson<{ success: boolean; config: any }>('/api/hermes/project-context')
      if (res.ok && res.data && res.data.config) {
        setProjectConfig((prev) => ({
          ...prev,
          ...res.data!.config,
        }))
      }
    } catch (e) {
      console.error('Failed to load project context:', e)
    }
  }, [])

  const handleSaveProjectConfig = async () => {
    setProjectBusy(true)
    setProjectMsg(null)
    try {
      const res = await fetchJson<{ success: boolean; config: any }>('/api/hermes/project-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', config: projectConfig }),
      })
      if (!res.ok) throw new Error(res.error || 'Gagal menyimpan konfigurasi')
      setProjectMsg({ type: 'ok', text: '✅ Konfigurasi integrasi proyek & server berhasil disimpan ke sistem!' })
      await loadProjectConfig()
    } catch (e) {
      setProjectMsg({ type: 'err', text: (e as Error).message })
    } finally {
      setProjectBusy(false)
    }
  }

  const handleSyncProjectToAgents = async () => {
    setProjectBusy(true)
    setProjectMsg(null)
    try {
      await fetchJson('/api/hermes/project-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', config: projectConfig }),
      })
      const res = await fetchJson<{ success: boolean; profilesUpdated?: string[]; message?: string }>(
        '/api/hermes/project-context',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync' }),
        },
      )
      if (!res.ok) throw new Error(res.error || 'Gagal menyinkronkan profil agent')
      const count = res.data?.profilesUpdated?.length || 0
      setProjectMsg({
        type: 'ok',
        text: `🚀 SUKSES! ${count} profil agent (termasuk contentcreator, seo, & backend) telah diperbarui dengan pengetahuan proyek /var/www/ecommerce, PostgreSQL, dan portal admin.zelvira.my.id!`,
      })
      await loadModels()
    } catch (e) {
      setProjectMsg({ type: 'err', text: (e as Error).message })
    } finally {
      setProjectBusy(false)
    }
  }

  const handleTestProjectIntegration = async () => {
    setProjectTesting(true)
    setProjectMsg(null)
    try {
      const res = await fetchJson<{ success: boolean; result: any }>('/api/hermes/project-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      })
      if (!res.ok) throw new Error(res.error || 'Gagal menguji koneksi')
      setProjectTest(res.data?.result || null)
      setProjectMsg({ type: 'ok', text: 'Uji koneksi server, database, dan portal admin selesai dijalankan.' })
    } catch (e) {
      setProjectMsg({ type: 'err', text: (e as Error).message })
    } finally {
      setProjectTesting(false)
    }
  }

  useEffect(() => {
    if (!open) return
    load()
    loadApprovals()
    loadRestart()
    loadModels()
    loadProjectConfig()
    const t = setInterval(() => {
      load()
      loadApprovals()
      loadRestart()
      loadModels()
    }, 30_000)
    return () => clearInterval(t)
  }, [open, load, loadApprovals, loadRestart, loadModels, loadProjectConfig])

  if (!open) return null

  const u = data?.usage
  const e = data?.errors
  const s = data?.status
  const logStale = !!e && e.ageSeconds > STALE_LOG
  const dbStale = !!u && u.ageSeconds > STALE_DB
  const top = (u?.rows || []).filter((r) => (r.costUsd ?? 0) > 0.005).slice(0, 8)

  return (
    <FullPanel
      variant="slate"
      onClose={onClose}
      label="Sistem"
      title="Sistem"
      actions={
        <>
          <select
            value={days}
            onChange={(ev) => setDays(Number(ev.target.value))}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1"
          >
            <option value={1}>1 hari</option>
            <option value={7}>7 hari</option>
            <option value={30}>30 hari</option>
            <option value={365}>semua</option>
          </select>
          <button
            onClick={() => {
              load()
              loadApprovals()
              loadRestart()
              loadModels()
            }}
            disabled={busy || modelBusy} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800">
            {busy || modelBusy ? '...' : 'muat ulang'}
          </button>
        </>
      }
    >

      {err && (
        <div className="mb-4 rounded border border-red-800 bg-red-950/50 p-3 text-sm">
          <b>Tidak bisa membaca keadaan sistem.</b>
          <div className="mt-1 text-red-300">{err}</div>
          <div className="mt-1 text-xs text-red-400/80">
            Angka lama sengaja TIDAK ditampilkan. Lebih baik tidak tahu daripada salah tahu.
          </div>
        </div>
      )}

      {notice && <div className="mb-4 rounded border border-slate-600 bg-slate-800/60 p-2 text-xs">{notice}</div>}

      {/* ---------- RELOAD SEMUA HERMES ---------- */}
      <section className="mb-6 rounded-lg border border-rose-700/60 bg-gradient-to-r from-slate-900 via-rose-950/20 to-slate-900 p-4 text-xs shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1 max-w-xl">
            <div className="flex items-center gap-2">
              <span className="text-base">⚡</span>
              <h3 className="font-bold text-sm uppercase tracking-wide text-rose-300">
                Reload & Restart Semua Hermes
              </h3>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Terapkan model default ({modelData?.defaultModel || 'nvidia/nemotron-3-ultra-55'}) ke seluruh profil agent (`contencreator`, `seo`, dll), perbarui konfigurasi provider di scope profil, bersihkan cache, dan restart gateway Hermes agar seluruh agent langsung sinkron.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReloadAllHermes}
              disabled={reloadingAll || modelBusy}
              className="rounded-lg bg-rose-600 hover:bg-rose-500 font-bold px-4 py-2.5 text-white shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 text-xs cursor-pointer"
            >
              {reloadingAll ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Sedang Me-reload Semua Hermes…</span>
                </>
              ) : (
                <>
                  <span>🔄</span>
                  <span>Reload & Restart Semua Hermes</span>
                </>
              )}
            </button>
          </div>
        </div>

        {reloadMsg && (
          <div
            className={`mt-3 p-2.5 rounded border text-xs flex justify-between items-center ${
              reloadMsg.type === 'ok'
                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                : 'bg-red-950/60 border-red-700 text-red-300'
            }`}
          >
            <div>
              <span>{reloadMsg.text}</span>
              {reloadMsg.manualCmd && (
                <code className="block mt-1 font-mono text-[10px] bg-slate-950 p-1 rounded text-slate-200">
                  {reloadMsg.manualCmd}
                </code>
              )}
            </div>
            <button
              onClick={() => setReloadMsg(null)}
              className="text-slate-400 hover:text-white ml-2 text-sm font-bold"
            >
              ×
            </button>
          </div>
        )}
      </section>

      {/* ---------- PENGATURAN MODEL AGENT & API KEY ---------- */}
      <section className="mb-6 rounded-lg border border-indigo-700/60 bg-gradient-to-b from-slate-900 to-indigo-950/30 p-4 text-xs shadow-lg">
        <div className="flex items-center justify-between border-b border-indigo-800/50 pb-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">⚙️</span>
            <div>
              <h3 className="font-semibold text-sm uppercase tracking-wide text-indigo-300">
                Pengaturan Model Agent & API Key
              </h3>
              <p className="text-[11px] text-slate-400">
                Pilih model AI untuk seluruh agent. Default dari profile Hermes, atau masukkan API key & model kustom.
              </p>
            </div>
          </div>
          {modelLoading && <span className="text-indigo-400 animate-pulse text-[11px]">memuat model…</span>}
        </div>

        {modelMsg && (
          <div
            className={`mb-3 p-2.5 rounded border text-xs flex justify-between items-center ${
              modelMsg.type === 'ok'
                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                : 'bg-red-950/60 border-red-700 text-red-300'
            }`}
          >
            <span>{modelMsg.text}</span>
            <button
              onClick={() => setModelMsg(null)}
              className="text-slate-400 hover:text-white ml-2 text-sm font-bold"
            >
              ×
            </button>
          </div>
        )}

        {/* Status Default Hermes Model Saat Ini */}
        <div className="mb-4 rounded border border-slate-700 bg-slate-800/80 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-slate-400 text-[11px] block">Model Default Hermes Kantor:</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-sm font-bold text-amber-300">
                  {modelData?.defaultModel || 'gpt-4o-mini'}
                </span>
                {modelData?.defaultProvider && (
                  <span className="rounded bg-indigo-900/60 px-1.5 py-0.5 text-[10px] text-indigo-300 border border-indigo-700/50">
                    provider: {modelData.defaultProvider}
                  </span>
                )}
                <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300 border border-emerald-700/40">
                  default profile
                </span>
              </div>
            </div>

            <button
              onClick={handleSyncAllProfiles}
              disabled={modelBusy}
              className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors shadow-sm"
              title="Set semua profil agent aktif agar mengikuti model default Hermes ini"
            >
              {modelBusy ? 'Memproses…' : '🔄 Samakan Semua Profile ke Default Hermes'}
            </button>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            💡 Semua agent yang dibuat tanpa spesifikasi model khusus otomatis mengikuti default ini.
          </div>
        </div>

        {/* Tab Pilih Model / Masukkan API Key / Integrasi Proyek */}
        <div className="flex border-b border-slate-700 mb-3 gap-2 overflow-x-auto">
          <button
            onClick={() => setModelTab('catalog')}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              modelTab === 'catalog'
                ? 'border-indigo-400 text-indigo-300 bg-indigo-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            📋 Pilih Model Terdaftar
          </button>
          <button
            onClick={() => setModelTab('custom')}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              modelTab === 'custom'
                ? 'border-indigo-400 text-indigo-300 bg-indigo-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            🔑 Input API Key & Custom
          </button>
          <button
            onClick={() => setModelTab('project')}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              modelTab === 'project'
                ? 'border-emerald-400 text-emerald-300 bg-emerald-950/20 font-semibold'
                : 'border-transparent text-emerald-400/80 hover:text-emerald-300'
            }`}
          >
            🌐 Integrasi Proyek Zelvira (/var/www/ecommerce, DB & Admin)
          </button>
        </div>

        {/* TAB 1: PILIH DARI KATALOG */}
        {modelTab === 'catalog' && (
          <div className="space-y-3 bg-slate-800/40 p-3 rounded border border-slate-700/70">
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Pilih Model dari Katalog Hermes:
              </label>
              <select
                value={selectedCatalogModel}
                onChange={(e) => setSelectedCatalogModel(e.target.value)}
                className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">-- Pilih Model --</option>
                {modelData?.models?.map((m) => (
                  <option key={`${m.provider}:${m.model}`} value={m.model}>
                    {m.label || `${m.model} (${m.provider})`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyCatalogToAll}
                  onChange={(e) => setApplyCatalogToAll(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-400"
                />
                <span>Set ke semua profil agent (semua profile mengikuti model ini)</span>
              </label>
            </div>

            <div className="pt-2">
              <button
                onClick={handleApplyCatalogModel}
                disabled={modelBusy || !selectedCatalogModel}
                className="rounded bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                {modelBusy ? 'Menyimpan…' : '✓ Terapkan Model Terpilih'}
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: INPUT API KEY & CUSTOM MODEL */}
        {modelTab === 'custom' && (
          <div className="space-y-3 bg-slate-800/40 p-3 rounded border border-slate-700/70">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  API Key: <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                  placeholder="sk-or-v1-... atau sk-..."
                  className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Model ID: <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="cth: anthropic/claude-3.5-sonnet, openai/gpt-4o-mini"
                  className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Nama Provider:
                </label>
                <input
                  type="text"
                  value={customProviderName}
                  onChange={(e) => setCustomProviderName(e.target.value)}
                  placeholder="cth: openrouter, openai, groq (opsional)"
                  className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Base URL:
                </label>
                <input
                  type="text"
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1 (opsional)"
                  className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none font-mono text-[11px]"
                />
              </div>
            </div>

            <div className="space-y-1 pt-1">
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={customSetAsDefault}
                  onChange={(e) => setCustomSetAsDefault(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-400"
                />
                <span>Jadikan model default Hermes kantor</span>
              </label>
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={customApplyToAll}
                  onChange={(e) => setCustomApplyToAll(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-400"
                />
                <span>Set ke semua profil agent aktif sekarang juga</span>
              </label>
            </div>

            <div className="pt-2">
              <button
                onClick={handleSaveCustomProvider}
                disabled={modelBusy || !customApiKey.trim() || !customModel.trim()}
                className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors shadow-sm"
              >
                {modelBusy ? 'Menyimpan…' : '💾 Simpan Provider & Pasang Model'}
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: INTEGRASI PROYEK ZELVIRA */}
        {modelTab === 'project' && (
          <div className="space-y-4 bg-slate-800/40 p-3.5 rounded border border-emerald-900/50">
            {/* Header info */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/60 pb-2">
              <div>
                <h4 className="font-semibold text-emerald-400 text-sm flex items-center gap-1.5">
                  <span>🏢 Integrasi Proyek & Server Zelvira</span>
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Hubungkan agen AI dengan codebase riil di server, database PostgreSQL, dan portal admin.zelvira.my.id.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSyncProjectToAgents}
                disabled={projectBusy}
                className="px-3 py-1 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white shadow transition-colors disabled:opacity-50 flex items-center gap-1.5"
                title="Suntikkan konteks proyek ke semua file SOUL.md profil agent"
              >
                <span>⚡ Sinkronkan ke Semua Agent</span>
              </button>
            </div>

            {/* Notification message */}
            {projectMsg && (
              <div
                className={`p-2.5 rounded text-xs flex items-center justify-between ${
                  projectMsg.type === 'ok'
                    ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60'
                    : 'bg-red-950/70 text-red-300 border border-red-800/60'
                }`}
              >
                <span>{projectMsg.text}</span>
                <button
                  type="button"
                  onClick={() => setProjectMsg(null)}
                  className="text-slate-400 hover:text-white ml-2 text-sm font-bold"
                >
                  ×
                </button>
              </div>
            )}

            {/* Test result display */}
            {projectTest && (
              <div className="p-2.5 rounded text-xs bg-slate-900/90 border border-slate-700/80 space-y-1.5">
                <div className="font-semibold text-slate-300 flex items-center justify-between">
                  <span>Hasil Uji Koneksi:</span>
                  <span className="text-[10px] text-slate-400">{projectTest.message}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
                  <div className="p-1.5 rounded bg-slate-800/60 border border-slate-700/50">
                    <span className="text-[10px] text-slate-400 block">Codebase Server</span>
                    <span className={`text-[11px] font-semibold ${projectTest.ecommerceFolderExists ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {projectTest.ecommerceFolderExists ? '✓ Terdeteksi di Host' : '⚠ Belum Terdeteksi Lokal (Server Mode)'}
                    </span>
                  </div>
                  <div className="p-1.5 rounded bg-slate-800/60 border border-slate-700/50">
                    <span className="text-[10px] text-slate-400 block">Portal Admin Zelvira</span>
                    <span className={`text-[11px] font-semibold ${projectTest.adminPortalReachable ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {projectTest.adminPortalStatus}
                    </span>
                  </div>
                  <div className="p-1.5 rounded bg-slate-800/60 border border-slate-700/50">
                    <span className="text-[10px] text-slate-400 block">Database PostgreSQL</span>
                    <span className={`text-[11px] font-semibold ${projectTest.dbConfigValid ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {projectTest.dbSummary}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Card 1: Codebase Server */}
              <div className="p-3 rounded bg-slate-900/60 border border-slate-700/70 space-y-2">
                <h5 className="font-semibold text-xs text-sky-400 flex items-center gap-1.5">
                  📁 Codebase & Folder Server
                </h5>
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">Path Proyek di Server:</label>
                  <input
                    type="text"
                    value={projectConfig.ecommercePath}
                    onChange={(e) => setProjectConfig({ ...projectConfig, ecommercePath: e.target.value })}
                    placeholder="/var/www/ecommerce"
                    className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-400 font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Framework / Stack:</label>
                    <input
                      type="text"
                      value={projectConfig.framework}
                      onChange={(e) => setProjectConfig({ ...projectConfig, framework: e.target.value })}
                      placeholder="Next.js / Node.js"
                      className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Host Server:</label>
                    <input
                      type="text"
                      value={projectConfig.serverHost}
                      onChange={(e) => setProjectConfig({ ...projectConfig, serverHost: e.target.value })}
                      placeholder="VM-32-155-ubuntu"
                      className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-400"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">Keterangan Proyek:</label>
                  <input
                    type="text"
                    value={projectConfig.projectDescription}
                    onChange={(e) => setProjectConfig({ ...projectConfig, projectDescription: e.target.value })}
                    placeholder="Zelvira E-Commerce Ecosystem"
                    className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-400"
                  />
                </div>
              </div>

              {/* Card 2: Database PostgreSQL */}
              <div className="p-3 rounded bg-slate-900/60 border border-slate-700/70 space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="font-semibold text-xs text-indigo-400 flex items-center gap-1.5">
                    🗄️ Database PostgreSQL Server
                  </h5>
                  <label className="text-[11px] text-slate-300 flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={projectConfig.dbEnabled}
                      onChange={(e) => setProjectConfig({ ...projectConfig, dbEnabled: e.target.checked })}
                      className="rounded bg-slate-800 border-slate-600 text-indigo-500"
                    />
                    Aktif
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-400 mb-0.5">Host & Port:</label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={projectConfig.dbHost}
                        onChange={(e) => setProjectConfig({ ...projectConfig, dbHost: e.target.value })}
                        placeholder="127.0.0.1"
                        className="w-3/4 rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-400 font-mono"
                      />
                      <input
                        type="number"
                        value={projectConfig.dbPort}
                        onChange={(e) => setProjectConfig({ ...projectConfig, dbPort: Number(e.target.value) || 5432 })}
                        placeholder="5432"
                        className="w-1/4 rounded bg-slate-800 border border-slate-600 px-1 py-1 text-xs text-white focus:outline-none focus:border-indigo-400 font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Database:</label>
                    <input
                      type="text"
                      value={projectConfig.dbName}
                      onChange={(e) => setProjectConfig({ ...projectConfig, dbName: e.target.value })}
                      placeholder="ecommerce"
                      className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-400 font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">DB User:</label>
                    <input
                      type="text"
                      value={projectConfig.dbUser}
                      onChange={(e) => setProjectConfig({ ...projectConfig, dbUser: e.target.value })}
                      placeholder="postgres"
                      className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-400 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">DB Password:</label>
                    <input
                      type="password"
                      value={projectConfig.dbPassword || ''}
                      onChange={(e) => setProjectConfig({ ...projectConfig, dbPassword: e.target.value })}
                      placeholder="••••••••"
                      className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-400 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">Tabel Kunci Konten / Produk:</label>
                  <input
                    type="text"
                    value={projectConfig.dbKeyTables}
                    onChange={(e) => setProjectConfig({ ...projectConfig, dbKeyTables: e.target.value })}
                    placeholder="products, categories, articles, content_posts, users, orders"
                    className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-[11px] text-white focus:outline-none focus:border-indigo-400 font-mono"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-amber-300 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={projectConfig.dbReadOnly}
                    onChange={(e) => setProjectConfig({ ...projectConfig, dbReadOnly: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-600 text-amber-500"
                  />
                  <span>🛡️ Mode Aman (Hanya izinkan SELECT, tolak DROP/DELETE)</span>
                </label>
              </div>

              {/* Card 3: Portal Admin Zelvira */}
              <div className="p-3 rounded bg-slate-900/60 border border-slate-700/70 space-y-2">
                <h5 className="font-semibold text-xs text-emerald-400 flex items-center gap-1.5">
                  🔐 Portal Admin Zelvira (admin.zelvira.my.id)
                </h5>
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">URL Portal Admin:</label>
                  <input
                    type="text"
                    value={projectConfig.adminPortalUrl}
                    onChange={(e) => setProjectConfig({ ...projectConfig, adminPortalUrl: e.target.value })}
                    placeholder="https://admin.zelvira.my.id"
                    className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-400 font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Metode Autentikasi:</label>
                    <select
                      value={projectConfig.adminAuthType}
                      onChange={(e) => setProjectConfig({ ...projectConfig, adminAuthType: e.target.value as any })}
                      className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-400"
                    >
                      <option value="api_token">API Token (Bearer)</option>
                      <option value="credentials">Akun Login (Username & Password)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Endpoint Buat Konten:</label>
                    <input
                      type="text"
                      value={projectConfig.adminContentEndpoint}
                      onChange={(e) => setProjectConfig({ ...projectConfig, adminContentEndpoint: e.target.value })}
                      placeholder="/api/articles"
                      className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-400 font-mono"
                    />
                  </div>
                </div>

                {projectConfig.adminAuthType === 'api_token' ? (
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Admin API Token / Bearer Key:</label>
                    <input
                      type="password"
                      value={projectConfig.adminToken || ''}
                      onChange={(e) => setProjectConfig({ ...projectConfig, adminToken: e.target.value })}
                      placeholder="Masukkan Token API (misal: zelvira-...)"
                      className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-400 font-mono"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">Username Akun Content:</label>
                      <input
                        type="text"
                        value={projectConfig.adminUsername || ''}
                        onChange={(e) => setProjectConfig({ ...projectConfig, adminUsername: e.target.value })}
                        placeholder="content_creator"
                        className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">Password Akun Content:</label>
                      <input
                        type="password"
                        value={projectConfig.adminPassword || ''}
                        onChange={(e) => setProjectConfig({ ...projectConfig, adminPassword: e.target.value })}
                        placeholder="••••••••"
                        className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-400 font-mono"
                      />
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-1.5 text-[11px] text-emerald-300 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={projectConfig.adminForceDraft}
                    onChange={(e) => setProjectConfig({ ...projectConfig, adminForceDraft: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-600 text-emerald-500"
                  />
                  <span>🔒 Wajibkan Status Draft (Cegah artikel langsung publish tanpa review)</span>
                </label>
              </div>

              {/* Card 4: SOP Agent & Keamanan Sistem */}
              <div className="p-3 rounded bg-slate-900/60 border border-slate-700/70 space-y-2">
                <h5 className="font-semibold text-xs text-amber-400 flex items-center gap-1.5">
                  🛡️ Hak Akses Server & Keamanan Agen
                </h5>
                <div className="space-y-1.5 pt-1">
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={projectConfig.allowBashExecution}
                      onChange={(e) => setProjectConfig({ ...projectConfig, allowBashExecution: e.target.checked })}
                      className="rounded bg-slate-800 border-slate-600 text-sky-500"
                    />
                    <span>Izinkan agen membaca file & menjalankan bash/curl di server</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={projectConfig.requireConfirmationForDestructive}
                      onChange={(e) => setProjectConfig({ ...projectConfig, requireConfirmationForDestructive: e.target.checked })}
                      className="rounded bg-slate-800 border-slate-600 text-amber-500"
                    />
                    <span>Tolak semua perintah destruktif (rm -rf, DROP TABLE, dll)</span>
                  </label>
                </div>

                <div className="mt-2.5 p-2 rounded bg-slate-800/80 border border-slate-700/60 text-[10.5px] text-slate-400 space-y-1">
                  <b className="text-slate-300 block">Bagaimana Agent Menggunakan Data Ini?</b>
                  <p>
                    • <b>contencreator</b>: Otomatis memformat payload JSON konten ke target <code>admin.zelvira.my.id</code> dengan status <code>draft</code>.
                  </p>
                  <p>
                    • <b>seo</b>: Menganalisa struktur URL, keyword, dan heading artikel/katalog produk.
                  </p>
                  <p>
                    • <b>backend</b>: Mengetahui path <code>{projectConfig.ecommercePath}</code> dan tabel database PostgreSQL <code>{projectConfig.dbName}</code>.
                  </p>
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-700/60">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveProjectConfig}
                  disabled={projectBusy}
                  className="rounded bg-emerald-600 px-3 py-1.5 font-medium text-xs text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {projectBusy ? 'Menyimpan…' : '💾 Simpan Konfigurasi'}
                </button>
                <button
                  type="button"
                  onClick={handleTestProjectIntegration}
                  disabled={projectTesting}
                  className="rounded bg-slate-700 px-3 py-1.5 font-medium text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50 transition-colors"
                >
                  {projectTesting ? 'Menguji…' : '🧪 Uji Status Koneksi'}
                </button>
              </div>

              <button
                type="button"
                onClick={handleSyncProjectToAgents}
                disabled={projectBusy}
                className="rounded bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-1.5 font-semibold text-xs text-white hover:brightness-110 disabled:opacity-50 transition-all shadow"
              >
                {projectBusy ? 'Sinkronisasi…' : '⚡ Terapkan & Sinkronkan SOUL.md ke Semua Agent'}
              </button>
            </div>
          </div>
        )}

        {/* Tabel Profil Agent Aktif & Status Model */}
        {modelData?.profiles && modelData.profiles.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-700/60">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Status Model per Profil Agent ({modelData.profiles.length} agent):
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] text-left border border-slate-700/80 rounded">
                <thead className="bg-slate-800 text-slate-400">
                  <tr>
                    <th className="px-2 py-1.5 border-b border-slate-700">Agent</th>
                    <th className="px-2 py-1.5 border-b border-slate-700">Model Aktif</th>
                    <th className="px-2 py-1.5 border-b border-slate-700">Status</th>
                    <th className="px-2 py-1.5 border-b border-slate-700 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {modelData.profiles.map((p) => (
                    <tr key={p.name} className="hover:bg-slate-800/40">
                      <td className="px-2 py-1.5 font-medium text-slate-200">{p.name}</td>
                      <td className="px-2 py-1.5 font-mono text-slate-300">
                        {p.model || modelData.defaultModel || 'gpt-4o-mini'}
                      </td>
                      <td className="px-2 py-1.5">
                        {p.isDefault ? (
                          <span className="text-emerald-300">✓ Mengikuti Default Hermes</span>
                        ) : (
                          <span className="text-amber-300">Custom Override</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {!p.isDefault && (
                          <button
                            onClick={() => handleResetProfile(p.name)}
                            disabled={modelBusy}
                            className="rounded border border-slate-600 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700"
                          >
                            Reset ke Default
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ---------- gateway ---------- */}
      {/* "Butuh restart" dari SATU sumber kebenaran (bukan hitungan panel ini).
          Kuning = tersimpan belum aktif; abu = tak bisa dipastikan. */}
      <section className="mb-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Gateway</h3>
        <div className="space-y-1 rounded border border-slate-700 bg-slate-800/50 p-2 text-xs">
          <div>
            restart gateway:{' '}
            {needsGatewayRestart === true ? (
              <span className="text-amber-300">butuh — config lebih baru dari start gateway (served tersimpan, BELUM aktif)</span>
            ) : needsGatewayRestart === false ? (
              <span className="text-emerald-300">tidak — served yang tersimpan sudah aktif</span>
            ) : (
              <span className="text-slate-500">tak pasti — start gateway tak terbaca</span>
            )}
          </div>
        </div>
      </section>

      {/* ---------- kerja di kantor ---------- */}
      {/* Bukti kenapa agent duduk di mejanya walau papan kosong. Cron ditulis sebagai KEBIJAKAN:
          Hermes tidak menyimpan pemilik cron, jadi panel tidak menyebut agent untuknya. */}
      <section className="mb-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Kerja di kantor</h3>
        <div className="space-y-1 rounded border border-slate-700 bg-slate-800/50 p-2 text-xs">
          <div>
            chat hidup:{' '}
            {work.chatLive.length ? <span className="font-mono">{work.chatLive.join(', ')}</span> : <span className="text-slate-500">tidak ada</span>}
          </div>
          <div>
            {work.cron ? (
              <>
                cron <span className="font-mono">{work.cron.name}</span> jalan {age(work.cron.agoSec)} lalu —
                kebijakan: agent yang bebas kembali ke mejanya
              </>
            ) : (
              <span className="text-slate-500">tidak ada cron agent yang jalan dalam 2 menit terakhir</span>
            )}
          </div>
        </div>
      </section>

      {/* ---------- persetujuan ---------- */}
      <section className="mb-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Persetujuan
          {appr && (
            <span className={`ml-2 ${appr.pending.length > 0 ? 'text-red-400' : 'text-slate-500'}`}>
              · {appr.pending.length} menunggu
            </span>
          )}
        </h3>
        {apprErr ? (
          <div className="rounded border border-red-800 bg-red-950/50 p-2 text-xs">
            <b>Tidak bisa membaca keadaan persetujuan.</b>
            <div className="mt-1 text-red-300">{apprErr}</div>
          </div>
        ) : !appr ? (
          <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-xs text-slate-400">membaca…</div>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
              {appr.policy.failure ? (
                <span className="text-red-300">Kebijakan tidak terbaca: {appr.policy.failure}</span>
              ) : (
                <>
                  kebijakan <span className="font-mono">{appr.policy.mode}</span>
                  <span className="text-slate-400">
                    {' '}
                    · tunggu {appr.policy.timeoutSec ?? '—'} dtk · {appr.policy.denyCount} aturan deny
                  </span>
                  {appr.policy.ageSeconds > STALE_APPROVAL && (
                    <span className="ml-2 text-amber-400">· BASI ({age(appr.policy.ageSeconds)})</span>
                  )}
                </>
              )}
            </div>

            {appr.pending.length === 0 ? (
              <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-slate-400">
                Tidak ada yang menunggu keputusan kamu.
              </div>
            ) : (
              <div className="space-y-1">
                {appr.pending.map((w) => (
                  <div key={w.id} className="rounded border border-red-800 bg-red-950/40 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-red-300">{w.title}</span>
                      <span className="font-mono text-[11px] text-slate-400">{w.id}</span>
                    </div>
                    <div className="mt-1 text-red-200/80">{w.reason.reason}</div>
                  </div>
                ))}
                {appr.blockedAgents.length > 0 && (
                  <div className="text-[11px] text-red-400/80">
                    agent berhenti: {appr.blockedAgents.join(' · ')}
                  </div>
                )}
              </div>
            )}
            {(appr.notRead ?? 0) > 0 && (
              <div className="text-[11px] text-amber-400">{appr.notRead} task tidak dibaca detailnya — daftar ini mungkin kurang</div>
            )}

            <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-slate-400">
              {appr.patterns.failure ? (
                <span className="text-amber-300">Pola approval tidak terbaca: {appr.patterns.failure}</span>
              ) : appr.patterns.ageSeconds > STALE_APPROVAL ? (
                <span className="text-amber-400">Pola approval BASI ({age(appr.patterns.ageSeconds)})</span>
              ) : appr.patterns.count === 0 ? (
                `Pola approval ${appr.patterns.windowDays} hari: belum ada data.`
              ) : (
                <>
                  {appr.patterns.count} pola sering disetujui ({appr.patterns.windowDays} hari):{' '}
                  <span className="font-mono text-slate-300">
                    {appr.patterns.proposals
                      .slice(0, 5)
                      .map((p) => `${p.pattern} ×${p.count}`)
                      .join(' · ')}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {!data && !err && <div className="py-8 text-center text-sm text-slate-400">membaca…</div>}

      {data && (
        <div className="space-y-5">
          {/* ---------- sumber & umur ---------- */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Sumber data</h3>
            <div className="grid grid-cols-3 gap-2 text-xs max-[720px]:grid-cols-2">
              {(s?.sources || []).map((src) => (
                <div key={src.name} className="rounded border border-slate-700 bg-slate-800/50 p-2">
                  <div className="flex items-center gap-1">
                    <span className={src.found ? 'text-green-400' : 'text-red-400'}>{src.found ? '●' : '○'}</span>
                    <span className="truncate font-mono">{src.name}</span>
                  </div>
                  <div className="mt-1 text-slate-400">umur {age(src.ageSeconds)}</div>
                </div>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {s?.pricingModels ?? 0} tarif model tersedia dari cache model.dev
            </div>
          </section>

          {/* ---------- biaya ---------- */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Pemakaian & biaya{' '}
              <span className="text-slate-500">
                ({u!.windowDays >= 365 ? 'seumur hidup' : `${u!.windowDays} hari terakhir`})
              </span>
              {dbStale && <span className="ml-2 text-amber-400">· DATA BASI ({age(u!.ageSeconds)})</span>}
            </h3>
            <div className="grid grid-cols-4 gap-2 text-xs max-[720px]:grid-cols-2">
              <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                <div className="text-slate-400">biaya terhitung</div>
                <div className="text-lg font-semibold text-emerald-400">{usd(u!.knownCostUsd)}</div>
              </div>
              <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                <div className="text-slate-400">token masuk</div>
                <div className="text-lg font-semibold">{tok(u!.totalInput)}</div>
              </div>
              <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                <div className="text-slate-400">token keluar</div>
                <div className="text-lg font-semibold">{tok(u!.totalOutput)}</div>
              </div>
              <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                <div className="text-slate-400">cache dibaca</div>
                <div className="text-lg font-semibold">{tok(u!.totalCache)}</div>
              </div>
            </div>

            {u!.unpricedModels.length > 0 && (
              <div className="mt-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-xs">
                <b className="text-amber-300">{u!.unpricedModels.length} model harganya belum diisi</b>
                <span className="text-amber-200/80">
                  {' '}
                  — {tok(u!.unpricedTokens)} token tidak ikut dihitung. Angka di atas adalah batas bawah,
                  bukan total.
                </span>
                <div className="mt-1 font-mono text-[11px] text-amber-300/70">{u!.unpricedModels.join(' · ')}</div>
              </div>
            )}

            {top.length > 0 && (
              <table className="mt-2 w-full text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="text-left font-normal">model</th>
                    <th className="text-right font-normal">masuk</th>
                    <th className="text-right font-normal">keluar</th>
                    <th className="text-right font-normal">panggilan</th>
                    <th className="text-right font-normal">biaya</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((r) => (
                    <tr key={`${r.model}|${r.provider}`} className="border-t border-slate-800">
                      <td className="py-1 pr-2 font-mono text-[11px]">{r.model}</td>
                      <td className="py-1 text-right text-slate-400">{tok(r.inputTokens)}</td>
                      <td className="py-1 text-right text-slate-400">{tok(r.outputTokens)}</td>
                      <td className="py-1 text-right text-slate-400">{nfmt(r.apiCalls)}</td>
                      <td className="py-1 text-right font-semibold text-emerald-400">
                        {r.costUsd == null ? <span className="text-amber-500">belum ada harga</span> : usd(r.costUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ---------- provider ---------- */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Provider {data.providers?.windowHours ? `(${data.providers.windowHours} jam)` : ''}
            </h3>
            {!data.providers || data.providers.providers.length === 0 ? (
              <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-xs text-slate-400">
                {data.providers?.failure
                  ? `Tidak bisa membaca statistik provider: ${data.providers.failure}`
                  : 'Belum ada panggilan API tercatat di jendela ini.'}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="text-left font-normal">provider</th>
                    <th className="text-right font-normal">panggilan</th>
                    <th className="text-right font-normal">gagal</th>
                    <th className="text-right font-normal">rasio</th>
                  </tr>
                </thead>
                <tbody>
                  {data.providers.providers.map((p) => (
                    <tr key={p.provider} className="border-t border-slate-800">
                      <td className="py-1 pr-2">
                        <span className={p.failures > 0 ? 'text-red-300' : 'text-emerald-300'}>{p.provider}</span>
                        {!p.confident && (
                          <span className="ml-2 text-[10px] text-slate-500" title={`kurang dari 10 panggilan — rasionya belum bisa dipercaya`}>
                            sampel kecil
                          </span>
                        )}
                      </td>
                      <td className="py-1 text-right text-slate-400">{nfmt(p.calls)}</td>
                      <td className={`py-1 text-right ${p.failures > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                        {nfmt(p.failures)}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {p.failures === 0 ? '—' : `${(p.failureRate * 100).toFixed(0)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ---------- cadangan provider ---------- */}
          {data.fallback && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Cadangan provider</h3>
              {data.fallback.kind === 'empty' && (
                <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-xs text-slate-400">
                  Sudah terisi.
                </div>
              )}
              {data.fallback.kind === 'none' && (
                <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-xs text-slate-400">
                  Belum ada usulan: {data.fallback.why}
                </div>
              )}
              {data.fallback.kind === 'propose' && (
                <div className="rounded border border-slate-600 bg-slate-800/50 p-2 text-xs">
                  <div className="text-slate-300">
                    Usulan: <span className="font-mono">{data.fallback.proposed[0]?.model}</span> lewat{' '}
                    <span className="font-mono">{data.fallback.proposed[0]?.provider}</span>
                  </div>
                  <div className="mt-1 text-slate-400">{data.fallback.why}</div>
                  <button
                    onClick={async () => {
                      setNotice(null)
                      const res = await fetch('/api/hermes/control', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'setFallback' }),
                      })
                      const j = await res.json()
                      setNotice(res.ok ? j.did : `GAGAL: ${j?.error?.message}`)
                      load()
                    }}
                    className="mt-2 rounded border border-red-700 px-3 py-1 text-red-300 hover:bg-red-950/40"
                    title="Mengubah provider yang dipakai SELURUH instalasi. Cadangan berkas dibuat dulu."
                  >
                    pasang cadangan ini
                  </button>
                  <div className="mt-1 text-[10px] text-amber-400/80">
                    Ini mengubah provider yang dipakai SELURUH instalasi, termasuk agent yang sedang bekerja.
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ---------- error ---------- */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Kegagalan 24 jam terakhir
              {logStale && <span className="ml-2 text-amber-400">· LOG BASI ({age(e!.ageSeconds)})</span>}
            </h3>
            {e!.total === 0 ? (
              <div className="rounded border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-400">
                Tidak ada kegagalan tercatat dalam 24 jam terakhir.
              </div>
            ) : (
              <>
                <div className="mb-2 text-xs text-slate-400">{nfmt(e!.total)} baris bermasalah</div>
                <div className="space-y-1">
                  {e!.buckets.map((b) => {
                    const critical = /5xx|rate|ditolak|context/.test(b.kind)
                    return (
                      <div
                        key={b.kind}
                        className={`rounded border p-2 text-xs ${
                          critical ? 'border-red-800 bg-red-950/40' : 'border-slate-700 bg-slate-800/50'
                        }`}
                        title={b.sample}
                      >
                        <div className="flex items-center justify-between">
                          <span className={critical ? 'font-semibold text-red-300' : ''}>{b.kind}</span>
                          <span className="font-mono">{nfmt(b.count)}×</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </FullPanel>
  )
}
