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
        <div>
          <label className="vp-sub">BATAS EKSEKUSI PARALEL MAKSIMAL</label>
          <input
            className="vp-input"
            type="number"
            min={1}
            max={20}
            value={settings.max_parallel_executions}
            onChange={(e) => setSettings({ ...settings, max_parallel_executions: e.target.value })}
          />
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
            Mencegah lonjakan beban CPU/RAM pada server dengan membatasi eksekusi concurrent.
          </div>
        </div>

        <div>
          <label className="vp-sub">TIMEOUT STANDAR PER LANGKAH (DETIK)</label>
          <input
            className="vp-input"
            type="number"
            min={10}
            max={600}
            value={settings.default_step_timeout_seconds}
            onChange={(e) => setSettings({ ...settings, default_step_timeout_seconds: e.target.value })}
          />
        </div>

        <div>
          <label className="vp-sub">JUMLAH PERCOBAAN ULANG STANDAR (RETRY)</label>
          <input
            className="vp-input"
            type="number"
            min={0}
            max={5}
            value={settings.default_retry_count}
            onChange={(e) => setSettings({ ...settings, default_retry_count: e.target.value })}
          />
        </div>

        <div>
          <label className="vp-sub">RETENSI PEMBERSIHAN LOG (HARI)</label>
          <input
            className="vp-input"
            type="number"
            min={7}
            max={365}
            value={settings.auto_cleanup_logs_days}
            onChange={(e) => setSettings({ ...settings, auto_cleanup_logs_days: e.target.value })}
          />
        </div>

        <div style={{ background: '#111822', border: '1px solid #1e293b', borderRadius: 6, padding: 10, marginTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#f8fafc', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.require_approval_high_risk === 'true'}
              onChange={(e) =>
                setSettings({ ...settings, require_approval_high_risk: e.target.checked ? 'true' : 'false' })
              }
            />
            <span>Wajibkan approval manual untuk semua tool berisiko tinggi (Database Query, External API, File Writer)</span>
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
