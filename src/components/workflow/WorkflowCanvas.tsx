'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { WorkflowStep, StepType, FlowiseEdge, CableAction } from '@/lib/workflow/types'

type AgentOption = { name: string; displayName: string; role: string }
type ToolOption = { id: string; name: string; displayName: string }

type NodePosition = { x: number; y: number }

type WorkflowCanvasProps = {
  steps: WorkflowStep[]
  agents: AgentOption[]
  tools: ToolOption[]
  edges: FlowiseEdge[]
  nodePositions: Record<string, NodePosition>
  onStepsChange: (steps: WorkflowStep[]) => void
  onEdgesChange: (edges: FlowiseEdge[]) => void
  onPositionsChange: (positions: Record<string, NodePosition>) => void
  onSelectStepToEdit: (step: WorkflowStep) => void
}

export default function WorkflowCanvas({
  steps,
  agents,
  tools,
  edges,
  nodePositions,
  onStepsChange,
  onEdgesChange,
  onPositionsChange,
  onSelectStepToEdit,
}: WorkflowCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Canvas zoom & pan
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 20, y: 20 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  // Dragging a node
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  // Connecting cables
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  // Cable settings popover
  const [selectedEdge, setSelectedEdge] = useState<FlowiseEdge | null>(null)
  const [edgePopoverPos, setEdgePopoverPos] = useState<{ x: number; y: number } | null>(null)

  // Ensure default positions for all steps
  useEffect(() => {
    const nextPos = { ...nodePositions }
    let changed = false
    steps.forEach((s, idx) => {
      if (!nextPos[s.id]) {
        nextPos[s.id] = {
          x: 60 + idx * 320,
          y: 100 + (idx % 2) * 60,
        }
        changed = true
      }
    })
    if (changed) {
      onPositionsChange(nextPos)
    }
  }, [steps, nodePositions, onPositionsChange])

  // Ensure default sequential edges if edges are empty
  useEffect(() => {
    if (edges.length === 0 && steps.length > 1) {
      const defaultEdges: FlowiseEdge[] = []
      for (let i = 0; i < steps.length - 1; i++) {
        defaultEdges.push({
          id: `edge_${steps[i].id}_${steps[i + 1].id}`,
          source: steps[i].id,
          target: steps[i + 1].id,
          action: steps[i + 1].requiresApproval ? 'approval' : 'direct',
        })
      }
      onEdgesChange(defaultEdges)
    }
  }, [steps, edges.length, onEdgesChange])

  // Mouse handlers for dragging node and pan
  const handleMouseDownNode = (e: React.MouseEvent, stepId: string) => {
    e.stopPropagation()
    const pos = nodePositions[stepId] || { x: 100, y: 100 }
    setDraggingNodeId(stepId)
    setDragOffset({
      x: e.clientX / zoom - pos.x,
      y: e.clientY / zoom - pos.y,
    })
  }

  const handleStartConnect = (e: React.MouseEvent, stepId: string) => {
    e.stopPropagation()
    setConnectingSourceId(stepId)
  }

  const handleEndConnect = (e: React.MouseEvent, targetStepId: string) => {
    e.stopPropagation()
    if (!connectingSourceId || connectingSourceId === targetStepId) {
      setConnectingSourceId(null)
      return
    }

    // Check if edge already exists
    const exists = edges.some((ed) => ed.source === connectingSourceId && ed.target === targetStepId)
    if (!exists) {
      const targetStep = steps.find((s) => s.id === targetStepId)
      const newEdge: FlowiseEdge = {
        id: `edge_${connectingSourceId}_${targetStepId}_${Date.now().toString(36)}`,
        source: connectingSourceId,
        target: targetStepId,
        action: targetStep?.requiresApproval ? 'approval' : 'direct',
      }
      onEdgesChange([...edges, newEdge])
    }
    setConnectingSourceId(null)
  }

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const canvasX = (e.clientX - rect.left - pan.x) / zoom
    const canvasY = (e.clientY - rect.top - pan.y) / zoom

    setMousePos({ x: canvasX, y: canvasY })

    if (draggingNodeId) {
      const newX = Math.max(10, Math.round(e.clientX / zoom - dragOffset.x))
      const newY = Math.max(10, Math.round(e.clientY / zoom - dragOffset.y))
      onPositionsChange({
        ...nodePositions,
        [draggingNodeId]: { x: newX, y: newY },
      })
    } else if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      })
    }
  }, [draggingNodeId, dragOffset, isPanning, pan.x, pan.y, panStart, nodePositions, onPositionsChange, zoom])

  const handleCanvasMouseUp = useCallback(() => {
    if (draggingNodeId) setDraggingNodeId(null)
    if (isPanning) setIsPanning(false)
    if (connectingSourceId) setConnectingSourceId(null)
  }, [draggingNodeId, isPanning, connectingSourceId])

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only pan if clicking on empty canvas
    if ((e.target as HTMLElement).tagName === 'svg' || (e.target as HTMLElement).classList.contains('canvas-surface')) {
      setIsPanning(true)
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
      setSelectedEdge(null)
    }
  }

  // Node deletion
  const handleDeleteNode = (stepId: string) => {
    const updated = steps.filter((s) => s.id !== stepId).map((s, i) => ({ ...s, stepOrder: i + 1 }))
    onStepsChange(updated)
    const filteredEdges = edges.filter((e) => e.source !== stepId && e.target !== stepId)
    onEdgesChange(filteredEdges)
    const newPos = { ...nodePositions }
    delete newPos[stepId]
    onPositionsChange(newPos)
  }

  // Edge actions
  const handleUpdateEdgeAction = (action: CableAction, emailTo?: string, emailSubject?: string, condition?: string) => {
    if (!selectedEdge) return
    const updated = edges.map((e) => {
      if (e.id === selectedEdge.id) {
        return {
          ...e,
          action,
          emailTo: emailTo !== undefined ? emailTo : e.emailTo,
          emailSubject: emailSubject !== undefined ? emailSubject : e.emailSubject,
          condition: condition !== undefined ? condition : e.condition,
        }
      }
      return e
    })
    onEdgesChange(updated)

    // Sync approval to target step if cable is approval
    if (action === 'approval') {
      const stepIdx = steps.findIndex((s) => s.id === selectedEdge.target)
      if (stepIdx >= 0) {
        const nextSteps = [...steps]
        nextSteps[stepIdx] = { ...nextSteps[stepIdx], requiresApproval: true }
        onStepsChange(nextSteps)
      }
    }

    setSelectedEdge(null)
  }

  const handleDeleteEdge = (edgeId: string) => {
    onEdgesChange(edges.filter((e) => e.id !== edgeId))
    setSelectedEdge(null)
  }

  // Auto layout
  const handleAutoLayout = () => {
    const newPos: Record<string, NodePosition> = {}
    steps.forEach((s, idx) => {
      newPos[s.id] = {
        x: 60 + idx * 340,
        y: 120 + (idx % 2 === 0 ? 0 : 50),
      }
    })
    onPositionsChange(newPos)
    setPan({ x: 20, y: 20 })
    setZoom(1)
  }

  return (
    <div className="relative w-full h-[640px] rounded-lg overflow-hidden border border-slate-800 bg-[#070b12] select-none flex flex-col">
      {/* CANVAS TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-900/90 border-b border-slate-800 z-20">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
            <span>⚡</span> Flowise Node Canvas
          </span>
          <span className="text-[11px] text-slate-400">({steps.length} Node · {edges.length} Kabel)</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="vp-chip-btn"
            onClick={handleAutoLayout}
            title="Tata otomatis posisi semua node secara rapi dari kiri ke kanan"
          >
            🪄 Susun Rapi
          </button>

          <div className="flex items-center bg-slate-950/80 rounded border border-slate-800 px-1 py-0.5">
            <button
              type="button"
              className="text-xs text-slate-300 hover:text-white px-2 py-0.5"
              onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.1).toFixed(1))))}
              title="Perkecil kanvas"
            >
              -
            </button>
            <span className="text-[10px] text-slate-400 font-mono w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className="text-xs text-slate-300 hover:text-white px-2 py-0.5"
              onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.1).toFixed(1))))}
              title="Perbesar kanvas"
            >
              +
            </button>
            <button
              type="button"
              className="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 ml-1 border-l border-slate-800"
              onClick={() => {
                setZoom(1)
                setPan({ x: 20, y: 20 })
              }}
              title="Reset Zoom 100%"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* CANVAS SURFACE */}
      <div
        ref={containerRef}
        className="canvas-surface relative flex-1 w-full h-full overflow-hidden cursor-grab active:cursor-grabbing"
        style={{
          backgroundColor: '#070b12',
          backgroundImage: 'radial-gradient(circle, #1e293b 1px, transparent 1px)',
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {/* SVG CABLES LAYER */}
          <svg
            className="absolute inset-0 w-[4000px] h-[3000px] pointer-events-none"
            style={{ overflow: 'visible' }}
          >
            <defs>
              <linearGradient id="cableDirect" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#818cf8" />
              </linearGradient>
              <linearGradient id="cableApproval" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
              <linearGradient id="cableEmail" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#c084fc" />
                <stop offset="100%" stopColor="#e879f9" />
              </linearGradient>
              <linearGradient id="cableCondition" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>

            {/* RENDER EXISTING EDGES */}
            {edges.map((edge) => {
              const srcPos = nodePositions[edge.source] || { x: 100, y: 100 }
              const tgtPos = nodePositions[edge.target] || { x: 450, y: 100 }

              // Port positions: OUT is on the right, IN is on the left
              const startX = srcPos.x + 260
              const startY = srcPos.y + 60
              const endX = tgtPos.x
              const endY = tgtPos.y + 60

              const dx = Math.max(60, Math.abs(endX - startX) * 0.5)
              const pathData = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`

              const midX = (startX + endX) / 2
              const midY = (startY + endY) / 2

              let strokeColor = 'url(#cableDirect)'
              let badgeBg = 'rgba(56, 189, 248, 0.15)'
              let badgeBorder = '#38bdf8'
              let badgeColor = '#38bdf8'
              let badgeText = '⚡ Langsung'

              if (edge.action === 'approval') {
                strokeColor = 'url(#cableApproval)'
                badgeBg = 'rgba(245, 158, 11, 0.2)'
                badgeBorder = '#f59e0b'
                badgeColor = '#fbbf24'
                badgeText = '🛡️ Wajib Approve'
              } else if (edge.action === 'email') {
                strokeColor = 'url(#cableEmail)'
                badgeBg = 'rgba(192, 132, 252, 0.2)'
                badgeBorder = '#c084fc'
                badgeColor = '#e9d5ff'
                badgeText = `📧 Email: ${edge.emailTo || 'Notif'}`
              } else if (edge.action === 'condition') {
                strokeColor = 'url(#cableCondition)'
                badgeBg = 'rgba(52, 211, 153, 0.2)'
                badgeBorder = '#34d399'
                badgeColor = '#6ee7b7'
                badgeText = `❓ ${edge.condition || 'Kondisi'}`
              }

              return (
                <g key={edge.id}>
                  {/* Outer glow stroke */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={badgeBorder}
                    strokeWidth={6}
                    strokeOpacity={0.25}
                    className="pointer-events-none"
                  />
                  {/* Main animated cable */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={2.5}
                    strokeDasharray="6 6"
                    className="cursor-pointer pointer-events-auto hover:stroke-width-4 transition-all"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedEdge(edge)
                      setEdgePopoverPos({ x: midX, y: midY })
                    }}
                  />
                  {/* Interactive Cable Action Badge in the middle */}
                  <foreignObject
                    x={midX - 70}
                    y={midY - 14}
                    width={140}
                    height={28}
                    className="pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedEdge(edge)
                      setEdgePopoverPos({ x: midX, y: midY })
                    }}
                  >
                    <div
                      style={{
                        background: badgeBg,
                        border: `1px solid ${badgeBorder}`,
                        color: badgeColor,
                        borderRadius: 14,
                        fontSize: 10,
                        fontWeight: 600,
                        textAlign: 'center',
                        lineHeight: '22px',
                        padding: '0 6px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                        backdropFilter: 'blur(4px)',
                      }}
                      title="Klik untuk mengubah aksi kabel (Approve / Email / Kondisi / Putus)"
                    >
                      {badgeText}
                    </div>
                  </foreignObject>
                </g>
              )
            })}

            {/* CONNECTING CABLE IN PROGRESS */}
            {connectingSourceId && (
              <path
                d={`M ${(nodePositions[connectingSourceId]?.x || 0) + 260} ${(nodePositions[connectingSourceId]?.y || 0) + 60} C ${(nodePositions[connectingSourceId]?.x || 0) + 360} ${(nodePositions[connectingSourceId]?.y || 0) + 60}, ${mousePos.x - 80} ${mousePos.y}, ${mousePos.x} ${mousePos.y}`}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={2.5}
                strokeDasharray="4 4"
                className="animate-pulse"
              />
            )}
          </svg>

          {/* RENDER NODES */}
          {steps.map((st, idx) => {
            const pos = nodePositions[st.id] || { x: 60 + idx * 320, y: 120 }
            const agent = agents.find((a) => a.name === st.agentName)
            const tool = tools.find((t) => t.id === st.toolId)

            // Theme per node type
            let nodeBorder = 'border-sky-500/40 hover:border-sky-400'
            let nodeIcon = '🤖'
            let typeBadge = 'Agent Hermes'
            let badgeBg = 'bg-sky-950/60 text-sky-300 border-sky-800'

            if (st.stepType === 'approval' || st.requiresApproval) {
              nodeBorder = 'border-amber-500/50 hover:border-amber-400'
              nodeIcon = '🛡️'
              typeBadge = 'Approval Gate'
              badgeBg = 'bg-amber-950/60 text-amber-300 border-amber-800'
            } else if (st.toolId === 'tool_email_dispatch') {
              nodeBorder = 'border-purple-500/50 hover:border-purple-400'
              nodeIcon = '📧'
              typeBadge = 'Kirim Email'
              badgeBg = 'bg-purple-950/60 text-purple-300 border-purple-800'
            } else if (st.stepType === 'conditional') {
              nodeBorder = 'border-emerald-500/50 hover:border-emerald-400'
              nodeIcon = '❓'
              typeBadge = 'Kondisi Branch'
              badgeBg = 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
            } else if (tool) {
              nodeBorder = 'border-teal-500/40 hover:border-teal-400'
              nodeIcon = '🛠️'
              typeBadge = tool.displayName
              badgeBg = 'bg-teal-950/60 text-teal-300 border-teal-800'
            }

            return (
              <div
                key={st.id}
                className={`absolute w-[260px] rounded-lg border ${nodeBorder} bg-slate-900/95 shadow-2xl transition-shadow pointer-events-auto flex flex-col group`}
                style={{
                  left: `${pos.x}px`,
                  top: `${pos.y}px`,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                }}
              >
                {/* NODE HEADER (DRAGGABLE) */}
                <div
                  className="flex items-center justify-between px-3 py-2 bg-slate-950/80 rounded-t-lg border-b border-slate-800/80 cursor-move"
                  onMouseDown={(e) => handleMouseDownNode(e, st.id)}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm">{nodeIcon}</span>
                    <span className="text-[11px] font-mono text-slate-400">#{idx + 1}</span>
                    <b className="text-xs text-slate-100 truncate">{st.name}</b>
                  </div>
                  <button
                    type="button"
                    className="text-slate-500 hover:text-rose-400 text-xs px-1"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteNode(st.id)
                    }}
                    title="Hapus node"
                  >
                    ×
                  </button>
                </div>

                {/* NODE BODY (CLICK TO INSPECT) */}
                <div
                  className="p-2.5 flex flex-col gap-1.5 cursor-pointer hover:bg-slate-800/40 transition-colors"
                  onClick={() => onSelectStepToEdit(st)}
                  title="Klik untuk membuka detail konfigurasi node ini"
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${badgeBg}`}>
                      {typeBadge}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {st.agentName || 'default'}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-300 line-clamp-2 m-0 font-sans leading-tight">
                    {st.instructions || '(Belum ada instruksi tugas)'}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800/60">
                    <span>Timeout: {st.timeoutSeconds}s</span>
                    <span className="text-sky-400 group-hover:underline">Edit ⚙️</span>
                  </div>
                </div>

                {/* INPUT PORT (LEFT HANDLE) */}
                <div
                  className="absolute -left-3 top-[52px] w-6 h-6 rounded-full bg-slate-800 border-2 border-emerald-400 flex items-center justify-center cursor-crosshair hover:scale-125 transition-transform shadow-md"
                  onClick={(e) => handleEndConnect(e, st.id)}
                  title="Hubungkan kabel ke input node ini"
                >
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                </div>

                {/* OUTPUT PORT (RIGHT HANDLE) */}
                <div
                  className="absolute -right-3 top-[52px] w-6 h-6 rounded-full bg-slate-800 border-2 border-sky-400 flex items-center justify-center cursor-crosshair hover:scale-125 transition-transform shadow-md"
                  onClick={(e) => handleStartConnect(e, st.id)}
                  title="Tarik kabel dari output node ini"
                >
                  <div className="w-2 h-2 rounded-full bg-sky-400" />
                </div>
              </div>
            )
          })}
        </div>

        {/* CABLE CONFIGURATION MODAL / POPOVER */}
        {selectedEdge && edgePopoverPos && (
          <div
            className="absolute z-50 p-4 w-72 rounded-lg border border-indigo-500 bg-slate-900 shadow-2xl space-y-3"
            style={{
              left: Math.max(20, Math.min(window.innerWidth - 320, edgePopoverPos.x * zoom + pan.x - 140)),
              top: Math.max(60, edgePopoverPos.y * zoom + pan.y - 120),
            }}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
                <span>⚙️</span> Konfigurasi Aksi Kabel
              </span>
              <button
                type="button"
                className="text-slate-400 hover:text-white text-xs"
                onClick={() => setSelectedEdge(null)}
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Aksi pada Sambungan Kabel:</label>
              <select
                className="vp-input w-full text-xs"
                value={selectedEdge.action}
                onChange={(e) => handleUpdateEdgeAction(e.target.value as CableAction)}
              >
                <option value="direct">⚡ Langsung (Direct Flow)</option>
                <option value="approval">🛡️ Wajib Approval Administrator</option>
                <option value="email">📧 Kirim Notifikasi Email</option>
                <option value="condition">❓ Filter Kondisi (If / Then)</option>
              </select>
            </div>

            {selectedEdge.action === 'email' && (
              <div className="space-y-2 pt-1 border-t border-slate-800">
                <div>
                  <label className="block text-[10px] text-purple-300 mb-0.5">Email Penerima:</label>
                  <input
                    className="vp-input w-full text-xs"
                    value={selectedEdge.emailTo || ''}
                    onChange={(e) => handleUpdateEdgeAction('email', e.target.value, selectedEdge.emailSubject)}
                    placeholder="admin@zelvira.office"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-purple-300 mb-0.5">Subjek Notifikasi:</label>
                  <input
                    className="vp-input w-full text-xs"
                    value={selectedEdge.emailSubject || ''}
                    onChange={(e) => handleUpdateEdgeAction('email', selectedEdge.emailTo, e.target.value)}
                    placeholder="Laporan Alur Kerja: Transisi Langkah"
                  />
                </div>
              </div>
            )}

            {selectedEdge.action === 'condition' && (
              <div className="pt-1 border-t border-slate-800">
                <label className="block text-[10px] text-emerald-300 mb-0.5">
                  Syarat Kondisi (cth: status === &apos;success&apos;):
                </label>
                <input
                  className="vp-input w-full text-xs"
                  value={selectedEdge.condition || ''}
                  onChange={(e) => handleUpdateEdgeAction('condition', undefined, undefined, e.target.value)}
                  placeholder="status === 'success'"
                />
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                type="button"
                className="vp-btn vp-btn-danger text-xs py-1 px-2.5"
                onClick={() => handleDeleteEdge(selectedEdge.id)}
              >
                🗑️ Putuskan Kabel
              </button>
              <button
                type="button"
                className="vp-btn text-xs py-1 px-3"
                onClick={() => setSelectedEdge(null)}
              >
                Tutup
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
