/**
 * AI Workflow Engine — Type Definitions
 */

export type WorkflowStatus = 'active' | 'inactive'

export type StepType =
  | 'sequential'
  | 'parallel'
  | 'conditional'
  | 'handoff'
  | 'approval'

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type StepExecutionStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type WorkflowStep = {
  id: string
  workflowId: string
  stepOrder: number
  name: string
  stepType: StepType
  agentName: string
  toolId?: string | null
  instructions: string
  inputConfig: Record<string, unknown>
  outputConfig: Record<string, unknown>
  conditionExpr?: string | null
  timeoutSeconds: number
  retryCount: number
  requiresApproval: boolean
}

export type Workflow = {
  id: string
  name: string
  description: string
  status: WorkflowStatus
  config: Record<string, unknown>
  steps?: WorkflowStep[]
  stepCount?: number
  lastExecution?: {
    id: string
    status: ExecutionStatus
    startedAt: string
    durationMs: number | null
  } | null
  createdAt: string
  updatedAt: string
}

export type WorkflowExecution = {
  id: string
  workflowId: string
  workflowName: string
  status: ExecutionStatus
  currentStepId?: string | null
  triggerType: 'manual' | 'scheduled' | 'webhook'
  inputData: Record<string, unknown>
  outputData: Record<string, unknown>
  errorMessage?: string | null
  startedAt: string
  completedAt?: string | null
  durationMs?: number | null
  steps?: WorkflowStepExecution[]
  logs?: WorkflowLog[]
}

export type WorkflowStepExecution = {
  id: string
  executionId: string
  stepId: string
  stepName: string
  agentName: string
  stepType: StepType
  status: StepExecutionStatus
  inputData: Record<string, unknown>
  outputData: Record<string, unknown>
  errorMessage?: string | null
  startedAt: string
  completedAt?: string | null
  durationMs?: number | null
}

export type WorkflowApproval = {
  id: string
  executionId: string
  stepId: string
  title: string
  description: string
  status: ApprovalStatus
  requestedBy: string
  reviewedBy?: string | null
  reviewComment?: string | null
  requestedAt: string
  reviewedAt?: string | null
  workflowName?: string
  agentName?: string
}

export type WorkflowLog = {
  id: string
  executionId?: string | null
  workflowId?: string | null
  stepId?: string | null
  event: string
  message: string
  details: Record<string, unknown>
  timestamp: string
}

export type WorkflowTool = {
  id: string
  name: string
  displayName: string
  description: string
  category: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  riskLevel: ToolRiskLevel
  requiresApproval: boolean
  enabled: boolean
}

export type WorkflowToolPermission = {
  id: string
  toolId: string
  agentName: string
  allowed: boolean
}

export type WorkflowDashboardStats = {
  totalWorkflows: number
  activeWorkflows: number
  totalExecutions: number
  runningExecutions: number
  completedExecutions: number
  failedExecutions: number
  waitingApproval: number
  recentActivities: WorkflowLog[]
}
