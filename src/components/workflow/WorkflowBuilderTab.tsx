'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import type { FlowiseEdge, StepType, Workflow, WorkflowStep } from '@/lib/workflow/types'
import WorkflowCanvas from './WorkflowCanvas'

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
  const [edges, setEdges] = useState<FlowiseEdge[]>([])
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({})

  // View mode: flowise visual canvas or list sequence
  const [viewMode, setViewMode] = useState<'flowise' | 'list'>('flowise')

  // Inspector state for editing a clicked node
  const [inspectingStep, setInspectingStep] = useState<WorkflowStep | null>(null)

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
    setInspectingStep(null)
    try {
      const res = await fetchJson<{ workflow: Workflow }>(`/api/workflow/workflows/${id}`)
      if (res.data?.workflow) {
        const wf = res.data.workflow
        setSelectedWf(wf)
        setName(wf.name)
        setDescription(wf.description || '')
        setStatus(wf.status)
        setSteps(wf.steps || [])

        // Load visual canvas config if present
        const cfg = wf.config as {
          edges?: FlowiseEdge[]
          nodePositions?: Record<string, { x: number; y: number }>
          canvas?: { edges?: FlowiseEdge[]; nodePositions?: Record<string, { x: number; y: number }> }
        }
        const loadedEdges = cfg?.edges || cfg?.canvas?.edges || []
        const loadedPositions = cfg?.nodePositions || cfg?.canvas?.nodePositions || {}
        setEdges(loadedEdges)
        setNodePositions(loadedPositions)
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
    setEdges([])
    setNodePositions({})
    setInspectingStep(null)

    const initialId = `step_${Date.now().toString(36)}_1`
    setSteps([
      {
        id: initialId,
        workflowId: '',
        stepOrder: 1,
        name: 'Riset & Perencanaan Konten',
        stepType: 'sequential',
        agentName: agents[0]?.name || 'default',
        toolId: null,
        instructions: 'Analisis tren dan siapkan ide konten kreatif.',
        inputConfig: {},
        outputConfig: {},
        timeoutSeconds: 60,
        retryCount: 1,
        requiresApproval: false,
      },
    ])
    setNodePositions({
      [initialId]: { x: 60, y: 120 },
    })
    setMessage('Mode pembuatan workflow baru.')
  }

  // Node addition with specific presets
  function addTypedNode(type: 'agent' | 'email' | 'tool' | 'approval' | 'condition', specificToolId?: string) {
    const nextOrder = steps.length + 1
    const id = `step_${Date.now().toString(36)}_${nextOrder}`
    let newStep: WorkflowStep

    if (type === 'email') {
      newStep = {
        id,
        workflowId: selectedWf?.id || '',
        stepOrder: nextOrder,
        name: `Kirim Email #${nextOrder}`,
        stepType: 'sequential',
        agentName: agents[0]?.name || 'default',
        toolId: 'tool_email_dispatch',
        instructions: 'Kirim notifikasi email hasil tugas ke stakeholder.',
        inputConfig: { to: 'admin@zelvira.office', subject: 'Laporan Progres Alur Kerja' },
        outputConfig: {},
        timeoutSeconds: 30,
        retryCount: 1,
        requiresApproval: false,
      }
    } else if (type === 'approval') {
      newStep = {
        id,
        workflowId: selectedWf?.id || '',
        stepOrder: nextOrder,
        name: `Persetujuan Admin #${nextOrder}`,
        stepType: 'approval',
        agentName: 'ceo',
        toolId: null,
        instructions: 'Menunggu persetujuan manual administrator sebelum data diteruskan ke langkah berikutnya.',
        inputConfig: {},
        outputConfig: {},
        timeoutSeconds: 300,
        retryCount: 0,
        requiresApproval: true,
      }
    } else if (type === 'condition') {
      newStep = {
        id,
        workflowId: selectedWf?.id || '',
        stepOrder: nextOrder,
        name: `Filter Kondisi #${nextOrder}`,
        stepType: 'conditional',
        agentName: agents[0]?.name || 'default',
        toolId: null,
        conditionExpr: "status === 'success'",
        instructions: 'Periksa apakah hasil dari agent sebelumnya memenuhi kriteria sukses.',
        inputConfig: {},
        outputConfig: {},
        timeoutSeconds: 30,
        retryCount: 0,
        requiresApproval: false,
      }
    } else if (type === 'tool') {
      const t = tools.find((tool) => tool.id === specificToolId) || tools[0]
      newStep = {
        id,
        workflowId: selectedWf?.id || '',
        stepOrder: nextOrder,
        name: t ? t.displayName : `Tool Aksi #${nextOrder}`,
        stepType: 'sequential',
        agentName: agents[0]?.name || 'default',
        toolId: t ? t.id : null,
        instructions: `Gunakan ${t ? t.displayName : 'tool'} untuk mengeksekusi operasi otomatis.`,
        inputConfig: {},
        outputConfig: {},
        timeoutSeconds: 60,
        retryCount: 1,
        requiresApproval: false,
      }
    } else {
      // Default agent step
      newStep = {
        id,
        workflowId: selectedWf?.id || '',
        stepOrder: nextOrder,
        name: `Tugas Agent #${nextOrder}`,
        stepType: 'sequential',
        agentName: agents[0]?.name || 'default',
        toolId: null,
        instructions: 'Analisis data dan hasilkan output terstruktur sesuai instruksi.',
        inputConfig: {},
        outputConfig: {},
        timeoutSeconds: 60,
        retryCount: 1,
        requiresApproval: false,
      }
    }

    const updatedSteps = [...steps, newStep]
    setSteps(updatedSteps)

    // Position node cleanly on canvas
    setNodePositions((prev) => ({
      ...prev,
      [id]: {
        x: 60 + (updatedSteps.length - 1) * 320,
        y: 120 + ((updatedSteps.length - 1) % 2) * 50,
      },
    }))

    // Auto connect from last step via cable
    if (steps.length > 0) {
      const lastStep = steps[steps.length - 1]
      const newEdge: FlowiseEdge = {
        id: `edge_${lastStep.id}_${id}_${Date.now().toString(36)}`,
        source: lastStep.id,
        target: id,
        action: newStep.requiresApproval ? 'approval' : 'direct',
      }
      setEdges((prev) => [...prev, newEdge])
    }

    setInspectingStep(newStep)
  }

  function removeStep(index: number) {
    const stepId = steps[index]?.id
    const filtered = steps.filter((_, i) => i !== index)
    setSteps(filtered.map((s, i) => ({ ...s, stepOrder: i + 1 })))

    if (stepId) {
      setEdges((prev) => prev.filter((e) => e.source !== stepId && e.target !== stepId))
      setNodePositions((prev) => {
        const next = { ...prev }
        delete next[stepId]
        return next
      })
      if (inspectingStep?.id === stepId) setInspectingStep(null)
    }
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
    const updated = steps.map((s, i) => {
      if (i !== index) return s
      return { ...s, [field]: val }
    })
    setSteps(updated)
    if (inspectingStep && steps[index]?.id === inspectingStep.id) {
      setInspectingStep({ ...inspectingStep, [field]: val })
    }
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
        config: {
          edges,
          nodePositions,
        },
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
      <div className="md:col-span-3 flex flex-col gap-2">
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

      {/* WORKFLOW BUILDER CANVAS & CONFIG */}
      <div
        className="md:col-span-9 flex flex-col gap-3"
        style={{ background: '#111822', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}
      >
        {/* HEADER BAR */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div className="min-w-0">
            <h3 style={{ margin: 0, fontSize: 15, color: '#f8fafc' }} className="truncate">
              {selectedWf ? `Edit: ${selectedWf.name}` : 'Buat Workflow Baru'}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>
              Rancang alur kerja visual Flowise dengan sambungan kabel, otorisasi approval, dan notifikasi email.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* VIEW MODE TOGGLE */}
            <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5">
              <button
                type="button"
                className={`text-xs px-2.5 py-1 rounded font-medium transition-all ${
                  viewMode === 'flowise'
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setViewMode('flowise')}
                title="Tampilan visual kanvas Flowise dengan kabel sambungan"
              >
                ⚡ Flowise (Kabel)
              </button>
              <button
                type="button"
                className={`text-xs px-2.5 py-1 rounded font-medium transition-all ${
                  viewMode === 'list'
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setViewMode('list')}
                title="Tampilan daftar langkah sekuensial"
              >
                📋 List Sekuensial
              </button>
            </div>

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
              {saving ? 'Menyimpan…' : '💾 Simpan Workflow'}
            </button>
          </div>
        </div>

        {error && <div className="vp-err" role="alert">{error}</div>}
        {message && <div className="vp-ok" role="status">{message}</div>}

        {/* WORKFLOW METADATA CARD */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold text-slate-300 block mb-1">NAMA WORKFLOW</label>
            <input
              className="vp-input w-full text-xs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="cth: Otomasi Konten Zelvira Instagram & Web"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1">STATUS</label>
            <select
              className="vp-input w-full text-xs"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
            >
              <option value="active">Aktif (Dapat Dijalankan)</option>
              <option value="inactive">Nonaktif</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1">DESKRIPSI RINGKAS</label>
            <input
              className="vp-input w-full text-xs"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Deskripsi tujuan alur kerja…"
            />
          </div>
        </div>

        {/* NODE PALETTE BAR (ADD NODES QUICKLY) */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded bg-slate-950/70 border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <span>➕</span> Tambah Node ke Alur Kerja:
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="vp-chip-btn text-[11px] hover:border-sky-500"
              onClick={() => addTypedNode('agent')}
              title="Tambah node tugas agent AI"
            >
              🤖 + Agent Node
            </button>
            <button
              type="button"
              className="vp-chip-btn text-[11px] hover:border-purple-500"
              onClick={() => addTypedNode('email')}
              title="Tambah node pengiriman email notifikasi"
            >
              📧 + Kirim Email
            </button>
            <button
              type="button"
              className="vp-chip-btn text-[11px] hover:border-teal-500"
              onClick={() => addTypedNode('tool')}
              title="Tambah node aksi tool eksternal (API/Web Search/DB)"
            >
              🛠️ + Tool Aksi
            </button>
            <button
              type="button"
              className="vp-chip-btn text-[11px] hover:border-amber-500"
              onClick={() => addTypedNode('approval')}
              title="Tambah node persetujuan manual administrator"
            >
              🛡️ + Approval Gate
            </button>
            <button
              type="button"
              className="vp-chip-btn text-[11px] hover:border-emerald-500"
              onClick={() => addTypedNode('condition')}
              title="Tambah node percabangan bersyarat"
            >
              ❓ + Kondisi
            </button>
          </div>
        </div>

        {/* FLOWISE VISUAL CANVAS MODE */}
        {viewMode === 'flowise' ? (
          <WorkflowCanvas
            steps={steps}
            agents={agents}
            tools={tools}
            edges={edges}
            nodePositions={nodePositions}
            onStepsChange={setSteps}
            onEdgesChange={setEdges}
            onPositionsChange={setNodePositions}
            onSelectStepToEdit={(st) => setInspectingStep(st)}
          />
        ) : (
          /* LIST SEQUENCE MODE */
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8' }}>
                Daftar Langkah Sekuensial ({steps.length})
              </span>
              <button type="button" className="vp-chip-btn primary" onClick={() => addTypedNode('agent')}>
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
                </div>
              ))}
            </div>
          </div>
        )}

        {/* NODE INSPECTOR DRAWER / MODAL */}
        {inspectingStep && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div
              className="w-full max-w-lg rounded-lg border border-sky-500 bg-slate-900 shadow-2xl p-4 space-y-3"
              style={{ maxHeight: '90vh', overflowY: 'auto' }}
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-sm font-bold text-sky-300 flex items-center gap-1.5">
                  <span>⚙️</span> Detail Node: <span className="text-white font-mono">{inspectingStep.name}</span>
                </span>
                <button
                  type="button"
                  className="text-slate-400 hover:text-white text-xs px-2 py-0.5 rounded bg-slate-800"
                  onClick={() => setInspectingStep(null)}
                >
                  ✕ Tutup
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Nama Node / Langkah:</label>
                <input
                  className="vp-input w-full text-xs"
                  value={inspectingStep.name}
                  onChange={(e) => {
                    const idx = steps.findIndex((s) => s.id === inspectingStep.id)
                    if (idx >= 0) updateStep(idx, 'name', e.target.value)
                  }}
                  placeholder="Nama Langkah"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Tipe Eksekusi:</label>
                  <select
                    className="vp-input w-full text-xs"
                    value={inspectingStep.stepType}
                    onChange={(e) => {
                      const idx = steps.findIndex((s) => s.id === inspectingStep.id)
                      if (idx >= 0) updateStep(idx, 'stepType', e.target.value as StepType)
                    }}
                  >
                    <option value="sequential">Sequential (Berurutan)</option>
                    <option value="parallel">Parallel (Bersamaan)</option>
                    <option value="conditional">Conditional (Bersyarat)</option>
                    <option value="approval">Manual Approval (Persetujuan)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Agent Hermes Penanggung Jawab:</label>
                  <select
                    className="vp-input w-full text-xs"
                    value={inspectingStep.agentName}
                    onChange={(e) => {
                      const idx = steps.findIndex((s) => s.id === inspectingStep.id)
                      if (idx >= 0) updateStep(idx, 'agentName', e.target.value)
                    }}
                  >
                    {agents.map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.displayName} ({a.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Tool / Eksternal Capability:</label>
                <select
                  className="vp-input w-full text-xs"
                  value={inspectingStep.toolId || ''}
                  onChange={(e) => {
                    const idx = steps.findIndex((s) => s.id === inspectingStep.id)
                    if (idx >= 0) updateStep(idx, 'toolId', e.target.value || null)
                  }}
                >
                  <option value="">Tanpa Tool (Agent Standalone)</option>
                  {tools.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Instruksi Prompt:</label>
                <textarea
                  className="vp-input w-full text-xs"
                  rows={3}
                  value={inspectingStep.instructions}
                  onChange={(e) => {
                    const idx = steps.findIndex((s) => s.id === inspectingStep.id)
                    if (idx >= 0) updateStep(idx, 'instructions', e.target.value)
                  }}
                  placeholder="Instruksi spesifik yang akan dijalankan oleh agent atau tool..."
                />
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <label className="text-[11px] text-slate-400 flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inspectingStep.requiresApproval}
                    onChange={(e) => {
                      const idx = steps.findIndex((s) => s.id === inspectingStep.id)
                      if (idx >= 0) updateStep(idx, 'requiresApproval', e.target.checked)
                    }}
                  />
                  <span>Wajib Approval Administrator</span>
                </label>

                <label className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <span>Timeout:</span>
                  <input
                    type="number"
                    className="vp-input text-xs w-16"
                    value={inspectingStep.timeoutSeconds}
                    onChange={(e) => {
                      const idx = steps.findIndex((s) => s.id === inspectingStep.id)
                      if (idx >= 0) updateStep(idx, 'timeoutSeconds', Number(e.target.value))
                    }}
                  />
                  <span>detik</span>
                </label>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-800">
                <button
                  type="button"
                  className="vp-btn primary text-xs py-1 px-4"
                  onClick={() => setInspectingStep(null)}
                >
                  Selesai
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
