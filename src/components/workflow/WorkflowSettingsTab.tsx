'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'

export default function WorkflowSettingsTab() {
  const [settings, setSettings] = useState({
    max_parallel_executions: '5',
    default_step_timeout_seconds: '60',
    default_retry_count: '2',
    auto_cleanup_logs_days: '30',
    require_approval_high_risk: 'true',
    notify_approval_email: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadSettings() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchJson<{ settings: Record<string, string> }>('/api/workflow/settings')
      if (res.data?.settings) {
        setSettings((prev) => ({ ...prev, ...res.data?.settings }))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
  }, [])

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const res = await fetchJson('/api/workflow/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (res.ok) {
        setMessage('Pengaturan AI Workflow Engine berhasil disimpan!')
      } else {
        setError(res.error || 'Gagal menyimpan pengaturan')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="vp-pad text-center text-slate-400 py-12">Memuat Pengaturan Workflow…</div>
  }

  return (
    <div className="vp-pad flex flex-col gap-4" style={{ maxWidth: 640 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 15, color: '#f8fafc' }}>Workflow Engine Configuration</h3>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>
          Atur parameter eksekusi global, batas kuota paralel, dan kebijakan keamanan engine.
        </p>
      </div>

      {error && <div className="vp-err" role="alert">{error}</div>}
      {message && <div className="vp-ok" role="status">{message}</div>}

      <form onSubmit={saveSettings} className="flex flex-col gap-3">
        {/* Card 1: Batas & Waktu Eksekusi */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 flex flex-col gap-2.5">
          <div className="text-xs font-bold text-slate-300">⚡ Batas & Waktu Eksekusi</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Batas Paralel Maksimal
              </label>
              <input
                className="vp-input w-full text-xs"
                type="number"
                min={1}
                max={20}
                value={settings.max_parallel_executions}
                onChange={(e) => setSettings({ ...settings, max_parallel_executions: e.target.value })}
              />
              <div className="text-[10px] text-slate-500 mt-1">Maksimum eksekusi concurrent bersamaan.</div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Timeout Standar Per Langkah (Detik)
              </label>
              <input
                className="vp-input w-full text-xs"
                type="number"
                min={10}
                max={600}
                value={settings.default_step_timeout_seconds}
                onChange={(e) => setSettings({ ...settings, default_step_timeout_seconds: e.target.value })}
              />
              <div className="text-[10px] text-slate-500 mt-1">Batas waktu sebelum langkah dianggap gagal.</div>
            </div>
          </div>
        </div>

        {/* Card 2: Keandalan & Retensi */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 flex flex-col gap-2.5">
          <div className="text-xs font-bold text-slate-300">🔄 Keandalan & Pembersihan Log</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Percobaan Ulang (Retry Count)
              </label>
              <input
                className="vp-input w-full text-xs"
                type="number"
                min={0}
                max={5}
                value={settings.default_retry_count}
                onChange={(e) => setSettings({ ...settings, default_retry_count: e.target.value })}
              />
              <div className="text-[10px] text-slate-500 mt-1">Percobaan otomatis saat step network/AI gagal.</div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Retensi Log (Hari)
              </label>
              <input
                className="vp-input w-full text-xs"
                type="number"
                min={7}
                max={365}
                value={settings.auto_cleanup_logs_days}
                onChange={(e) => setSettings({ ...settings, auto_cleanup_logs_days: e.target.value })}
              />
              <div className="text-[10px] text-slate-500 mt-1">Log eksekusi otomatis dibersihkan setelah X hari.</div>
            </div>
          </div>
        </div>

        {/* Card 3: Kebijakan Keamanan */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-slate-700 bg-slate-800 text-indigo-500"
              checked={settings.require_approval_high_risk === 'true'}
              onChange={(e) =>
                setSettings({ ...settings, require_approval_high_risk: e.target.checked ? 'true' : 'false' })
              }
            />
            <div>
              <span className="font-semibold text-slate-200">Wajibkan approval manual untuk aksi berisiko tinggi</span>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Meminta konfirmasi admin sebelum menjalankan query database langsung atau API eksternal kritis.
              </div>
            </div>
          </label>
        </div>

        <div style={{ marginTop: 8 }}>
          <button type="submit" className="vp-btn primary" disabled={saving}>
            {saving ? 'Menyimpan…' : 'Simpan Pengaturan'}
          </button>
        </div>
      </form>
    </div>
  )
}
