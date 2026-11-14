'use client'

import { useState } from 'react'
import WorkflowDashboardTab from './WorkflowDashboardTab'
import WorkflowBuilderTab from './WorkflowBuilderTab'
import WorkflowExecutionsTab from './WorkflowExecutionsTab'
import AgentRegistryTab from './AgentRegistryTab'
import ToolRegistryTab from './ToolRegistryTab'
import ApprovalCenterTab from './ApprovalCenterTab'
import WorkflowLogsTab from './WorkflowLogsTab'
import WorkflowSettingsTab from './WorkflowSettingsTab'

export type WorkflowSubmenu =
  | 'dashboard'
  | 'builder'
  | 'executions'
  | 'agents'
  | 'tools'
  | 'approvals'
  | 'logs'
  | 'settings'

export default function WorkflowEnginePanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<WorkflowSubmenu>('dashboard')
  const [targetWorkflowId, setTargetWorkflowId] = useState<string | null>(null)

  if (!open) return null

  const handleNavigate = (tab: string, context?: { workflowId?: string }) => {
    if (context?.workflowId) {
      setTargetWorkflowId(context.workflowId)
    }
    setActiveTab(tab as WorkflowSubmenu)
  }

  const SUBMENUS: { id: WorkflowSubmenu; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'builder', label: 'Builder', icon: '🛠️' },
    { id: 'executions', label: 'Executions', icon: '⚡' },
    { id: 'agents', label: 'Agent Registry', icon: '🤖' },
    { id: 'tools', label: 'Tool Registry', icon: '🧰' },
    { id: 'approvals', label: 'Approval Center', icon: '🛡️' },
    { id: 'logs', label: 'Logs', icon: '📜' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  return (
    <div className="vp-modal-backdrop" onClick={onClose}>
      <div
        className="vp-modal"
        style={{
          width: '95vw',
          maxWidth: 1200,
          height: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          background: '#0a0f16',
          border: '1px solid #1e293b',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER BAR */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            background: '#0e1622',
            borderBottom: '1px solid #1e293b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚡</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f8fafc', letterSpacing: '0.02em' }}>
                AI WORKFLOW ENGINE
              </h2>
              <div style={{ fontSize: 10, color: '#38bdf8' }}>
                Autonomous Multi-Agent Orchestration &amp; Execution Runtime
              </div>
            </div>
          </div>
          <button className="vp-x" onClick={onClose} aria-label="Tutup" style={{ fontSize: 20 }}>
            ×
          </button>
        </header>

        {/* SUBMENU NAVIGATION BAR */}
        <nav
          style={{
            display: 'flex',
            overflowX: 'auto',
            background: '#090d13',
            borderBottom: '1px solid #1e293b',
            padding: '4px 12px 0',
            gap: 4,
          }}
          aria-label="Workflow Engine Submenu"
        >
          {SUBMENUS.map((sub) => {
            const isActive = activeTab === sub.id
            return (
              <button
                key={sub.id}
                type="button"
                className="vp-btn"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  fontSize: 12,
                  borderRadius: '6px 6px 0 0',
                  border: 'none',
                  borderBottom: isActive ? '2px solid #38bdf8' : '2px solid transparent',
                  background: isActive ? '#1e293b' : 'transparent',
                  color: isActive ? '#f8fafc' : '#94a3b8',
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
                onClick={() => {
                  setTargetWorkflowId(null)
                  setActiveTab(sub.id)
                }}
              >
                <span>{sub.icon}</span>
                <span>{sub.label}</span>
              </button>
            )
          })}
        </nav>

        {/* CONTENT AREA */}
        <div style={{ flex: 1, overflowY: 'auto', background: '#070b10' }}>
          {activeTab === 'dashboard' && <WorkflowDashboardTab onNavigate={handleNavigate} />}
          {activeTab === 'builder' && (
            <WorkflowBuilderTab
              initialWorkflowId={targetWorkflowId}
              onWorkflowSaved={() => setTargetWorkflowId(null)}
            />
          )}
          {activeTab === 'executions' && <WorkflowExecutionsTab />}
          {activeTab === 'agents' && (
            <AgentRegistryTab onNavigateToBuilder={(id) => handleNavigate('builder', { workflowId: id })} />
          )}
          {activeTab === 'tools' && <ToolRegistryTab />}
          {activeTab === 'approvals' && <ApprovalCenterTab />}
          {activeTab === 'logs' && <WorkflowLogsTab />}
          {activeTab === 'settings' && <WorkflowSettingsTab />}
        </div>
      </div>
    </div>
  )
}
