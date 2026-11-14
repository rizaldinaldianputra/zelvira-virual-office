'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import type { StepType, Workflow, WorkflowStep } from '@/lib/workflow/types'

type AgentOption = { name: string; displayName: string; role: string }
type ToolOption = { id: string; name: string; displayName: string }

export default function WorkflowBuilderTab({
  initialWorkflowId,
  onWorkflowSaved,
}: {
  initialWorkflowId?: string | null
  onWorkflowSaved?: () => void
}) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [tools, setTools] = useState<ToolOption[]>([])
  const [selectedWf, setSelectedWf] = useState<Workflow | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Editor form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<'active' | 'inactive'>('active')
  const [steps, setSteps] = useState<WorkflowStep[]>([])

  async function loadInitial() {
    setLoading(true)
    setError(null)
    try {
      const [resWf, resAgents, resTools] = await Promise.all([
        fetchJson<{ workflows: Workflow[] }>('/api/workflow/workflows'),
        fetchJson<{ agents: AgentOption[] }>('/api/workflow/agents'),
        fetchJson<{ tools: ToolOption[] }>('/api/workflow/tools'),
      ])

      const wfList = resWf.data?.workflows || []
      setWorkflows(wfList)
      if (resAgents.data?.agents) setAgents(resAgents.data.agents)
      if (resTools.data?.tools) setTools(resTools.data.tools)

      if (initialWorkflowId) {
        const hit = wfList.find((w) => w.id === initialWorkflowId)
        if (hit) selectWorkflow(hit.id)
      } else if (wfList.length > 0) {
        selectWorkflow(wfList[0].id)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadInitial()
  }, [])

  async function selectWorkflow(id: string) {
    setError(null)
    setMessage(null)
    try {
      const res = await fetchJson<{ workflow: Workflow }>(`/api/workflow/workflows/${id}`)
      if (res.data?.workflow) {
        const wf = res.data.workflow
        setSelectedWf(wf)
        setName(wf.name)
        setDescription(wf.description || '')
        setStatus(wf.status)
        setSteps(wf.steps || [])
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function startCreateNew() {
    setSelectedWf(null)
    setName('')
    setDescription('')
    setStatus('active')
    setSteps([
      {
        id: `step_${Date.now().toString(36)}_1`,
        workflowId: '',
        stepOrder: 1,
        name: 'Langkah Awal',
        stepType: 'sequential',
        agentName: agents[0]?.name || 'default',
        toolId: null,
        instructions: 'Analisis tugas awal dan siapkan materi.',
        inputConfig: {},
        outputConfig: {},
        timeoutSeconds: 60,
        retryCount: 1,
        requiresApproval: false,
      },
    ])
    setMessage('Mode pembuatan workflow baru.')
  }

  function addStep() {
    const nextOrder = steps.length + 1
    const newStep: WorkflowStep = {
      id: `step_${Date.now().toString(36)}_${nextOrder}`,
      workflowId: selectedWf?.id || '',
      stepOrder: nextOrder,
      name: `Langkah ${nextOrder}`,
      stepType: 'sequential',
      agentName: agents[0]?.name || 'default',
      toolId: null,
      instructions: '',
      inputConfig: {},
      outputConfig: {},
      timeoutSeconds: 60,
      retryCount: 1,
      requiresApproval: false,
    }
    setSteps([...steps, newStep])
  }

  function removeStep(index: number) {
    const filtered = steps.filter((_, i) => i !== index)
    // Reorder
    setSteps(filtered.map((s, i) => ({ ...s, stepOrder: i + 1 })))
  }

  function moveStep(index: number, direction: 'up' | 'down') {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === steps.length - 1)) {
      return
    }
    const targetIdx = direction === 'up' ? index - 1 : index + 1
    const next = [...steps]
    const temp = next[index]
    next[index] = next[targetIdx]
    next[targetIdx] = temp

    setSteps(next.map((s, i) => ({ ...s, stepOrder: i + 1 })))
  }

  function updateStep(index: number, field: keyof WorkflowStep, val: unknown) {
    setSteps(
      steps.map((s, i) => {
        if (i !== index) return s
        return { ...s, [field]: val }
      }),
    )
  }

  async function handleSave() {
    if (!name.trim()) {
      setError('Nama workflow wajib diisi')
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)

    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        status,
        steps: steps.map((s, i) => ({
          ...s,
          stepOrder: i + 1,
        })),
      }

      let res
      if (selectedWf) {
        res = await fetchJson<{ workflow: Workflow }>(`/api/workflow/workflows/${selectedWf.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetchJson<{ workflow: Workflow }>('/api/workflow/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }

      if (res.ok && res.data?.workflow) {
        setMessage(`Workflow "${res.data.workflow.name}" berhasil disimpan!`)
        setSelectedWf(res.data.workflow)
        void loadInitial()
        onWorkflowSaved?.()
      } else {
        throw new Error(res.error || 'Gagal menyimpan workflow')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedWf) return
    if (!confirm(`Hapus workflow "${selectedWf.name}"? Tindakan ini tidak dapat dibatalkan.`)) return

    try {
      const res = await fetchJson(`/api/workflow/workflows/${selectedWf.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setMessage('Workflow berhasil dihapus')
        startCreateNew()
        void loadInitial()
      } else {
        alert(res.error || 'Gagal menghapus workflow')
      }
    } catch (e) {
      alert((e as Error).message)
    }
  }

  async function handleDuplicate() {
    if (!selectedWf) return
    try {
      const res = await fetchJson<{ workflow: Workflow }>(`/api/workflow/workflows/${selectedWf.id}/duplicate`, {
        method: 'POST',
      })
      if (res.ok && res.data?.workflow) {
        setMessage(`Workflow diduplikasi: "${res.data.workflow.name}"`)
        void loadInitial()
        selectWorkflow(res.data.workflow.id)
      } else {
        alert(res.error || 'Gagal menduplikasi')
      }
    } catch (e) {
      alert((e as Error).message)
    }
  }

  if (loading) {
    return <div className="vp-pad text-center text-slate-400 py-12">Memuat Workflow Builder…</div>
  }

  return (
    <div className="vp-pad grid grid-cols-1 md:grid-cols-12 gap-4">
      {/* SIDEBAR LIST */}
      <div className="md:col-span-4 flex flex-col gap-2">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>Daftar Workflow ({workflows.length})</span>
          <button className="vp-chip-btn primary" onClick={startCreateNew}>
            + Baru
          </button>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
          {workflows.map((wf) => (
            <div
              key={wf.id}
              onClick={() => selectWorkflow(wf.id)}
              style={{
                padding: '10px 12px',
                borderRadius: 6,
                border: selectedWf?.id === wf.id ? '1px solid #38bdf8' : '1px solid #1e293b',
                background: selectedWf?.id === wf.id ? '#1e293b' : '#0f172a',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b style={{ fontSize: 12, color: selectedWf?.id === wf.id ? '#38bdf8' : '#f1f5f9' }}>{wf.name}</b>
                <span
                  style={{
                    fontSize: 9,
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: wf.status === 'active' ? 'rgba(52, 211, 153, 0.2)' : '#334155',
                    color: wf.status === 'active' ? '#34d399' : '#94a3b8',
                  }}
                >
                  {wf.status === 'active' ? 'AKTIF' : 'NONAKTIF'}
                </span>
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                {wf.stepCount} Langkah · Diperbarui {new Date(wf.updatedAt).toLocaleDateString('id-ID')}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* WORKFLOW FORM & STEPS BUILDER */}
      <div className="md:col-span-8 flex flex-col gap-4" style={{ background: '#111822', border: '1px solid #1e293b', borderRadius: 8, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, color: '#f8fafc' }}>
              {selectedWf ? `Edit: ${selectedWf.name}` : 'Buat Workflow Baru'}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>
              Rancang urutan eksekusi sequential, parallel, conditional branching, dan approval.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {selectedWf && (
              <>
                <button type="button" className="vp-chip-btn" onClick={handleDuplicate} title="Duplikasi workflow">
                  Duplikasi
                </button>
                <button type="button" className="vp-chip-btn" onClick={handleDelete} style={{ color: '#f43f5e' }}>
                  Hapus
                </button>
              </>
            )}
            <button
              type="button"
              className="vp-btn primary"
              disabled={saving}
              onClick={handleSave}
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              {saving ? 'Menyimpan…' : 'Simpan Workflow'}
            </button>
          </div>
        </div>

        {error && <div className="vp-err" role="alert">{error}</div>}
        {message && <div className="vp-ok" role="status">{message}</div>}

        {/* WORKFLOW METADATA */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="vp-sub">NAMA WORKFLOW</label>
            <input
              className="vp-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Otomasi Publikasi Konten Multi-Agent"
            />
          </div>

          <div>
            <label className="vp-sub">STATUS</label>
            <select
              className="vp-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
            >
              <option value="active">Aktif (Dapat Dijalankan)</option>
              <option value="inactive">Nonaktif</option>
            </select>
          </div>
        </div>

        <div>
          <label className="vp-sub">DESKRIPSI</label>
          <textarea
            className="vp-input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Jelaskan tujuan dan output dari workflow ini…"
          />
        </div>

        {/* STEPS LIST BUILDER */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8' }}>
              Daftar Langkah (Steps Sequence - {steps.length})
            </span>
            <button type="button" className="vp-chip-btn primary" onClick={addStep}>
              + Tambah Langkah
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {steps.map((st, idx) => (
              <div
                key={st.id || idx}
                style={{
                  background: '#0a0f16',
                  border: '1px solid #1e293b',
                  borderRadius: 6,
                  padding: 12,
                }}
              >
                {/* Step Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ background: '#1e293b', color: '#38bdf8', padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: 11 }}>
                      #{idx + 1}
                    </span>
                    <input
                      style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #334155', color: '#f8fafc', fontWeight: 600, fontSize: 13, width: 220 }}
                      value={st.name}
                      onChange={(e) => updateStep(idx, 'name', e.target.value)}
                      placeholder="Nama Langkah"
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      className="vp-chip-btn"
                      disabled={idx === 0}
                      onClick={() => moveStep(idx, 'up')}
                      title="Geser ke atas"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="vp-chip-btn"
                      disabled={idx === steps.length - 1}
                      onClick={() => moveStep(idx, 'down')}
                      title="Geser ke bawah"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      className="vp-chip-btn"
                      onClick={() => removeStep(idx)}
                      style={{ color: '#f43f5e' }}
                      title="Hapus langkah"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Step Config Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <label style={{ fontSize: 10, color: '#94a3b8' }}>Tipe Eksekusi</label>
                    <select
                      className="vp-input"
                      style={{ fontSize: 11, padding: '4px 6px' }}
                      value={st.stepType}
                      onChange={(e) => updateStep(idx, 'stepType', e.target.value as StepType)}
                    >
                      <option value="sequential">Sequential (Berurutan)</option>
                      <option value="parallel">Parallel (Bersamaan)</option>
                      <option value="conditional">Conditional (Bersyarat)</option>
                      <option value="handoff">Agent Handoff (Estafet)</option>
                      <option value="approval">Manual Approval (Persetujuan)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: 10, color: '#94a3b8' }}>Agent Penanggung Jawab</label>
                    <select
                      className="vp-input"
                      style={{ fontSize: 11, padding: '4px 6px' }}
                      value={st.agentName}
                      onChange={(e) => updateStep(idx, 'agentName', e.target.value)}
                    >
                      {agents.map((a) => (
                        <option key={a.name} value={a.name}>
                          {a.displayName} ({a.role})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: 10, color: '#94a3b8' }}>Tool / Kemampuan Eksternal</label>
                    <select
                      className="vp-input"
                      style={{ fontSize: 11, padding: '4px 6px' }}
                      value={st.toolId || ''}
                      onChange={(e) => updateStep(idx, 'toolId', e.target.value || null)}
                    >
                      <option value="">Tanpa Tool Tambahan</option>
                      {tools.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Instructions */}
                <div style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#94a3b8' }}>Instruksi / Prompt Langkah</label>
                  <textarea
                    className="vp-input"
                    rows={2}
                    style={{ fontSize: 11 }}
                    value={st.instructions}
                    onChange={(e) => updateStep(idx, 'instructions', e.target.value)}
                    placeholder="Instruksi spesifik yang harus dikerjakan agent pada langkah ini…"
                  />
                </div>

                {/* Conditional Expression (If type is conditional) */}
                {st.stepType === 'conditional' && (
                  <div style={{ marginTop: 6 }}>
                    <label style={{ fontSize: 10, color: '#fbbf24' }}>Ekspresi Kondisi (cth: score &gt;= 75 atau status === &apos;success&apos;)</label>
                    <input
                      className="vp-input"
                      style={{ fontSize: 11 }}
                      value={st.conditionExpr || ''}
                      onChange={(e) => updateStep(idx, 'conditionExpr', e.target.value)}
                      placeholder="score >= 75"
                    />
                  </div>
                )}

                {/* Advanced parameters: Timeout & Retry */}
                <div style={{ display: 'flex', gap: 12, marginTop: 6, alignItems: 'center' }}>
                  <label style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                    Timeout:
                    <input
                      type="number"
                      className="vp-input"
                      style={{ width: 60, fontSize: 11, padding: '2px 4px' }}
                      value={st.timeoutSeconds}
                      onChange={(e) => updateStep(idx, 'timeoutSeconds', Number(e.target.value))}
                    />
                    detik
                  </label>

                  <label style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                    Retry:
                    <input
                      type="number"
                      className="vp-input"
                      style={{ width: 50, fontSize: 11, padding: '2px 4px' }}
                      value={st.retryCount}
                      onChange={(e) => updateStep(idx, 'retryCount', Number(e.target.value))}
                    />
                    kali
                  </label>

                  <label style={{ fontSize: 10, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={st.requiresApproval}
                      onChange={(e) => updateStep(idx, 'requiresApproval', e.target.checked)}
                    />
                    Wajib Approval Administrator
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
