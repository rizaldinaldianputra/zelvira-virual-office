import { officeDb } from '@/lib/office/db'
import type {
  ApprovalStatus,
  ExecutionStatus,
  Workflow,
  WorkflowApproval,
  WorkflowDashboardStats,
  WorkflowExecution,
  WorkflowLog,
  WorkflowStep,
  WorkflowStepExecution,
  WorkflowTool,
} from './types'

let initialized = false

/** Initialize workflow tables in office.db */
export function initWorkflowDb() {
  if (initialized) return
  const db = officeDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'active',
      config      TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_steps (
      id                TEXT PRIMARY KEY,
      workflow_id       TEXT NOT NULL,
      step_order        INTEGER NOT NULL,
      name              TEXT NOT NULL,
      step_type         TEXT NOT NULL DEFAULT 'sequential',
      agent_name        TEXT NOT NULL DEFAULT '',
      tool_id           TEXT,
      instructions      TEXT NOT NULL DEFAULT '',
      input_config      TEXT NOT NULL DEFAULT '{}',
      output_config     TEXT NOT NULL DEFAULT '{}',
      condition_expr    TEXT,
      timeout_seconds   INTEGER NOT NULL DEFAULT 60,
      retry_count       INTEGER NOT NULL DEFAULT 0,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_executions (
      id              TEXT PRIMARY KEY,
      workflow_id     TEXT NOT NULL,
      workflow_name   TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      current_step_id TEXT,
      trigger_type    TEXT NOT NULL DEFAULT 'manual',
      input_data      TEXT NOT NULL DEFAULT '{}',
      output_data     TEXT NOT NULL DEFAULT '{}',
      error_message   TEXT,
      started_at      TEXT NOT NULL,
      completed_at    TEXT,
      duration_ms     INTEGER
    );

    CREATE TABLE IF NOT EXISTS workflow_step_executions (
      id            TEXT PRIMARY KEY,
      execution_id  TEXT NOT NULL,
      step_id       TEXT NOT NULL,
      step_name     TEXT NOT NULL,
      agent_name    TEXT NOT NULL DEFAULT '',
      step_type     TEXT NOT NULL DEFAULT 'sequential',
      status        TEXT NOT NULL DEFAULT 'pending',
      input_data    TEXT NOT NULL DEFAULT '{}',
      output_data   TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      started_at    TEXT NOT NULL,
      completed_at  TEXT,
      duration_ms   INTEGER,
      FOREIGN KEY (execution_id) REFERENCES workflow_executions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_approvals (
      id             TEXT PRIMARY KEY,
      execution_id   TEXT NOT NULL,
      step_id        TEXT NOT NULL,
      title          TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      status         TEXT NOT NULL DEFAULT 'pending',
      requested_by   TEXT NOT NULL DEFAULT 'workflow_engine',
      reviewed_by    TEXT,
      review_comment TEXT,
      requested_at   TEXT NOT NULL,
      reviewed_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS workflow_logs (
      id           TEXT PRIMARY KEY,
      execution_id TEXT,
      workflow_id  TEXT,
      step_id      TEXT,
      event        TEXT NOT NULL,
      message      TEXT NOT NULL,
      details      TEXT NOT NULL DEFAULT '{}',
      timestamp    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_tools (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL UNIQUE,
      display_name      TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      category          TEXT NOT NULL DEFAULT 'general',
      input_schema      TEXT NOT NULL DEFAULT '{}',
      output_schema     TEXT NOT NULL DEFAULT '{}',
      risk_level        TEXT NOT NULL DEFAULT 'low',
      requires_approval INTEGER NOT NULL DEFAULT 0,
      enabled           INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS workflow_tool_permissions (
      id         TEXT PRIMARY KEY,
      tool_id    TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      allowed    INTEGER NOT NULL DEFAULT 1,
      UNIQUE (tool_id, agent_name)
    );

    CREATE TABLE IF NOT EXISTS workflow_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  // Seed standard tools
  seedTools()
  // Seed sample workflow if none exist
  seedInitialWorkflow()

  initialized = true
}

function seedTools() {
  const db = officeDb()

  const defaultTools = [
    {
      id: 'tool_http_request',
      name: 'http_api_request',
      display_name: 'HTTP API Request',
      description: 'Eksekusi HTTP/REST API request (GET, POST, PUT, DELETE) ke service pihak ketiga dengan header & payload kustom.',
      category: 'integration',
      input_schema: JSON.stringify({ url: 'string', method: 'string', headers: 'object', body: 'any' }),
      output_schema: JSON.stringify({ status: 'number', data: 'any', duration: 'number' }),
      risk_level: 'medium',
      requires_approval: 0,
      enabled: 1,
    },
    {
      id: 'tool_web_search',
      name: 'web_search',
      display_name: 'Web Search & Intelligence',
      description: 'Pencarian web terindeks, pengambilan ringkasan informasi pasar, dan scraping data publik.',
      category: 'search',
      input_schema: JSON.stringify({ query: 'string', limit: 'number' }),
      output_schema: JSON.stringify({ results: 'array', total: 'number' }),
      risk_level: 'low',
      requires_approval: 0,
      enabled: 1,
    },
    {
      id: 'tool_db_query',
      name: 'database_query',
      display_name: 'Database Query (Safe Read-Only)',
      description: 'Menjalankan query database analitik (SELECT) dengan batasan kuota untuk mencegah kebocoran data.',
      category: 'data',
      input_schema: JSON.stringify({ query: 'string', table: 'string' }),
      output_schema: JSON.stringify({ rows: 'array', count: 'number' }),
      risk_level: 'high',
      requires_approval: 1,
      enabled: 1,
    },
    {
      id: 'tool_file_reader',
      name: 'file_reader',
      display_name: 'File Reader',
      description: 'Membaca konten file dokumen, CSV, JSON, atau log dari storage kantor.',
      category: 'filesystem',
      input_schema: JSON.stringify({ path: 'string', format: 'string' }),
      output_schema: JSON.stringify({ content: 'string', size: 'number' }),
      risk_level: 'low',
      requires_approval: 0,
      enabled: 1,
    },
    {
      id: 'tool_file_writer',
      name: 'file_writer',
      display_name: 'File Writer',
      description: 'Menyimpan laporan, hasil analisa, atau ringkasan tugas ke dalam direktori artefak kantor.',
      category: 'filesystem',
      input_schema: JSON.stringify({ filename: 'string', content: 'string' }),
      output_schema: JSON.stringify({ path: 'string', bytes: 'number' }),
      risk_level: 'medium',
      requires_approval: 0,
      enabled: 1,
    },
    {
      id: 'tool_seo_analysis',
      name: 'seo_analysis',
      display_name: 'SEO & Content Analysis',
      description: 'Menganalisis kepadatan kata kunci, readability, meta tags, dan rekomendasi optimasi konten Zelvira.',
      category: 'marketing',
      input_schema: JSON.stringify({ text: 'string', target_keywords: 'array' }),
      output_schema: JSON.stringify({ score: 'number', recommendations: 'array' }),
      risk_level: 'low',
      requires_approval: 0,
      enabled: 1,
    },
    {
      id: 'tool_knowledge_search',
      name: 'knowledge_search',
      display_name: 'Knowledge Base Search',
      description: 'Pencarian semantik di arsip rapat, memo internal, dan kanban task kantor virtual Zelvira.',
      category: 'internal',
      input_schema: JSON.stringify({ query: 'string', scope: 'string' }),
      output_schema: JSON.stringify({ snippets: 'array' }),
      risk_level: 'low',
      requires_approval: 0,
      enabled: 1,
    },
    {
      id: 'tool_email_dispatch',
      name: 'email_notification',
      display_name: 'Email Dispatch & Notification',
      description: 'Mengirimkan notifikasi email, surat pemberitahuan alur kerja, atau ringkasan tugas ke stakeholder internal Zelvira.',
      category: 'communication',
      input_schema: JSON.stringify({ to: 'string', subject: 'string', body: 'string' }),
      output_schema: JSON.stringify({ sent: 'boolean', messageId: 'string', timestamp: 'string' }),
      risk_level: 'low',
      requires_approval: 0,
      enabled: 1,
    },
  ]

  const insert = db.prepare(`
    INSERT OR IGNORE INTO workflow_tools (id, name, display_name, description, category, input_schema, output_schema, risk_level, requires_approval, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const t of defaultTools) {
    insert.run(
      t.id,
      t.name,
      t.display_name,
      t.description,
      t.category,
      t.input_schema,
      t.output_schema,
      t.risk_level,
      t.requires_approval,
      t.enabled,
    )
  }
}

function seedInitialWorkflow() {
  const db = officeDb()
  const count = (db.prepare('SELECT COUNT(*) as count FROM workflows').get() as { count: number })?.count ?? 0
  if (count > 0) return

  const now = new Date().toISOString()
  const wfId = 'wf_content_publishing'

  db.prepare(`
    INSERT INTO workflows (id, name, description, status, config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    wfId,
    'Siklus Publikasi Konten & Validasi Multi-Agent',
    'Workflow orkestrasi kolaborasi: Pembuatan draf oleh Content Creator, optimasi SEO oleh Marketing, persetujuan manajerial, dan rilis publikasi.',
    'active',
    JSON.stringify({ parallelLimit: 3, retryPolicy: { maxRetries: 2, backoffSeconds: 5 } }),
    now,
    now,
  )

  const steps = [
    {
      id: 'step_cp_1',
      workflow_id: wfId,
      step_order: 1,
      name: 'Penyusunan Draf Konten & Visual',
      step_type: 'sequential',
      agent_name: 'jun',
      tool_id: 'tool_file_writer',
      instructions: 'Riset tren terkini mengenai Zelvira AI Virtual Office dan susun draf materi edukasi atau postingan yang menarik.',
      input_config: JSON.stringify({ topic: 'Zelvira Virtual Office Multi-Agent System' }),
      output_config: JSON.stringify({ format: 'markdown', targetKey: 'draft_article' }),
      timeout_seconds: 90,
      retry_count: 1,
      requires_approval: 0,
    },
    {
      id: 'step_cp_2',
      workflow_id: wfId,
      step_order: 2,
      name: 'Audit SEO & Rekomendasi Tagar',
      step_type: 'handoff',
      agent_name: 'mkt-1',
      tool_id: 'tool_seo_analysis',
      instructions: 'Periksa draf artikel dari step sebelumnya. Analisis kata kunci, struktur heading, dan tambahkan rekomendasi tagar relevan.',
      input_config: JSON.stringify({ sourceStep: 'step_cp_1' }),
      output_config: JSON.stringify({ seoScoreThreshold: 75 }),
      timeout_seconds: 60,
      retry_count: 1,
      requires_approval: 0,
    },
    {
      id: 'step_cp_3',
      workflow_id: wfId,
      step_order: 3,
      name: 'Otorisasi Publikasi Media Sosial',
      step_type: 'approval',
      agent_name: 'ceo',
      tool_id: null,
      instructions: 'Persetujuan manual dari Manager/CEO sebelum artikel dan grafis diterbitkan ke saluran eksternal.',
      input_config: JSON.stringify({ requiresAdminReview: true }),
      output_config: JSON.stringify({ publishApproved: true }),
      timeout_seconds: 300,
      retry_count: 0,
      requires_approval: 1,
    },
    {
      id: 'step_cp_4',
      workflow_id: wfId,
      step_order: 4,
      name: 'Distribusi & Pencatatan Log Rilis',
      step_type: 'sequential',
      agent_name: 'jun',
      tool_id: 'tool_http_request',
      instructions: 'Kirimkan konten yang telah disetujui ke API endpoint distribusi eksternal dan simpan bukti tautan ke file log.',
      input_config: JSON.stringify({ endpoint: 'https://api.zelixa.my.id/v1/broadcast' }),
      output_config: JSON.stringify({ status: 'published' }),
      timeout_seconds: 60,
      retry_count: 2,
      requires_approval: 0,
    },
  ]

  const insertStep = db.prepare(`
    INSERT INTO workflow_steps (
      id, workflow_id, step_order, name, step_type, agent_name, tool_id,
      instructions, input_config, output_config, condition_expr,
      timeout_seconds, retry_count, requires_approval
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const s of steps) {
    insertStep.run(
      s.id,
      s.workflow_id,
      s.step_order,
      s.name,
      s.step_type,
      s.agent_name,
      s.tool_id,
      s.instructions,
      s.input_config,
      s.output_config,
      null,
      s.timeout_seconds,
      s.retry_count,
      s.requires_approval,
    )
  }
}

// ------------------------------------------------------------- CRUD: WORKFLOWS

export function listWorkflows(): Workflow[] {
  initWorkflowDb()
  const db = officeDb()

  const rows = db.prepare(`
    SELECT w.*, 
      (SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = w.id) as step_count
    FROM workflows w
    ORDER BY w.updated_at DESC
  `).all() as (Record<string, unknown> & { step_count: number })[]

  const result: Workflow[] = []
  for (const r of rows) {
    const id = String(r.id)
    const lastExec = db.prepare(`
      SELECT id, status, started_at, duration_ms
      FROM workflow_executions
      WHERE workflow_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `).get(id) as { id: string; status: ExecutionStatus; started_at: string; duration_ms: number | null } | undefined

    let cfg = {}
    try {
      cfg = JSON.parse(String(r.config || '{}'))
    } catch {}

    result.push({
      id,
      name: String(r.name),
      description: String(r.description || ''),
      status: String(r.status) as 'active' | 'inactive',
      config: cfg,
      stepCount: Number(r.step_count || 0),
      lastExecution: lastExec
        ? {
            id: lastExec.id,
            status: lastExec.status,
            startedAt: lastExec.started_at,
            durationMs: lastExec.duration_ms,
          }
        : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    })
  }

  return result
}

export function getWorkflow(id: string): Workflow | null {
  initWorkflowDb()
  const db = officeDb()

  const row = db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id) as Record<string, unknown> | undefined
  if (!row) return null

  const stepsRows = db.prepare(`
    SELECT * FROM workflow_steps
    WHERE workflow_id = ?
    ORDER BY step_order ASC
  `).all(id) as Record<string, unknown>[]

  const steps: WorkflowStep[] = stepsRows.map((s) => ({
    id: String(s.id),
    workflowId: String(s.workflow_id),
    stepOrder: Number(s.step_order),
    name: String(s.name),
    stepType: String(s.step_type) as WorkflowStep['stepType'],
    agentName: String(s.agent_name || ''),
    toolId: s.tool_id ? String(s.tool_id) : null,
    instructions: String(s.instructions || ''),
    inputConfig: JSON.parse(String(s.input_config || '{}')),
    outputConfig: JSON.parse(String(s.output_config || '{}')),
    conditionExpr: s.condition_expr ? String(s.condition_expr) : null,
    timeoutSeconds: Number(s.timeout_seconds || 60),
    retryCount: Number(s.retry_count || 0),
    requiresApproval: Number(s.requires_approval) === 1,
  }))

  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description || ''),
    status: String(row.status) as 'active' | 'inactive',
    config: JSON.parse(String(row.config || '{}')),
    steps,
    stepCount: steps.length,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function saveWorkflow(wf: {
  id?: string
  name: string
  description?: string
  status?: 'active' | 'inactive'
  config?: Record<string, unknown>
  steps?: Partial<WorkflowStep>[]
}): Workflow {
  initWorkflowDb()
  const db = officeDb()
  const now = new Date().toISOString()
  const id = wf.id || `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

  const existing = db.prepare('SELECT id FROM workflows WHERE id = ?').get(id)

  if (existing) {
    db.prepare(`
      UPDATE workflows
      SET name = ?, description = ?, status = ?, config = ?, updated_at = ?
      WHERE id = ?
    `).run(
      wf.name,
      wf.description || '',
      wf.status || 'active',
      JSON.stringify(wf.config || {}),
      now,
      id,
    )
  } else {
    db.prepare(`
      INSERT INTO workflows (id, name, description, status, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      wf.name,
      wf.description || '',
      wf.status || 'active',
      JSON.stringify(wf.config || {}),
      now,
      now,
    )
  }

  // Replace steps if provided
  if (Array.isArray(wf.steps)) {
    db.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').run(id)

    const insertStep = db.prepare(`
      INSERT INTO workflow_steps (
        id, workflow_id, step_order, name, step_type, agent_name, tool_id,
        instructions, input_config, output_config, condition_expr,
        timeout_seconds, retry_count, requires_approval
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (let i = 0; i < wf.steps.length; i++) {
      const s = wf.steps[i]
      const stepId = s.id || `step_${id}_${i + 1}`
      insertStep.run(
        stepId,
        id,
        s.stepOrder ?? i + 1,
        s.name || `Langkah ${i + 1}`,
        s.stepType || 'sequential',
        s.agentName || '',
        s.toolId || null,
        s.instructions || '',
        JSON.stringify(s.inputConfig || {}),
        JSON.stringify(s.outputConfig || {}),
        s.conditionExpr || null,
        s.timeoutSeconds ?? 60,
        s.retryCount ?? 0,
        s.requiresApproval ? 1 : 0,
      )
    }
  }

  logWorkflowEvent({
    workflowId: id,
    event: existing ? 'workflow_updated' : 'workflow_created',
    message: existing ? `Workflow "${wf.name}" diperbarui` : `Workflow "${wf.name}" dibuat`,
  })

  return getWorkflow(id)!
}

export function deleteWorkflow(id: string): boolean {
  initWorkflowDb()
  const db = officeDb()
  const wf = getWorkflow(id)
  if (!wf) return false

  db.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').run(id)
  db.prepare('DELETE FROM workflows WHERE id = ?').run(id)

  logWorkflowEvent({
    workflowId: id,
    event: 'workflow_deleted',
    message: `Workflow "${wf.name}" dihapus`,
  })

  return true
}

export function duplicateWorkflow(id: string): Workflow | null {
  const orig = getWorkflow(id)
  if (!orig) return null

  return saveWorkflow({
    name: `${orig.name} (Salinan)`,
    description: orig.description,
    status: 'inactive',
    config: orig.config,
    steps: orig.steps?.map((s) => ({
      ...s,
      id: undefined,
    })),
  })
}

// ------------------------------------------------------------- EXECUTIONS

export function listExecutions(limit = 50): WorkflowExecution[] {
  initWorkflowDb()
  const db = officeDb()

  const rows = db.prepare(`
    SELECT * FROM workflow_executions
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit) as Record<string, unknown>[]

  return rows.map((r) => ({
    id: String(r.id),
    workflowId: String(r.workflow_id),
    workflowName: String(r.workflow_name),
    status: String(r.status) as ExecutionStatus,
    currentStepId: r.current_step_id ? String(r.current_step_id) : null,
    triggerType: String(r.trigger_type) as WorkflowExecution['triggerType'],
    inputData: JSON.parse(String(r.input_data || '{}')),
    outputData: JSON.parse(String(r.output_data || '{}')),
    errorMessage: r.error_message ? String(r.error_message) : null,
    startedAt: String(r.started_at),
    completedAt: r.completed_at ? String(r.completed_at) : null,
    durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
  }))
}

export function getExecution(id: string): WorkflowExecution | null {
  initWorkflowDb()
  const db = officeDb()

  const row = db.prepare(`SELECT * FROM workflow_executions WHERE id = ?`).get(id) as Record<string, unknown> | undefined
  if (!row) return null

  const stepRows = db.prepare(`
    SELECT * FROM workflow_step_executions
    WHERE execution_id = ?
    ORDER BY started_at ASC
  `).all(id) as Record<string, unknown>[]

  const steps: WorkflowStepExecution[] = stepRows.map((s) => ({
    id: String(s.id),
    executionId: String(s.execution_id),
    stepId: String(s.step_id),
    stepName: String(s.step_name),
    agentName: String(s.agent_name || ''),
    stepType: String(s.step_type) as WorkflowStepExecution['stepType'],
    status: String(s.status) as WorkflowStepExecution['status'],
    inputData: JSON.parse(String(s.input_data || '{}')),
    outputData: JSON.parse(String(s.output_data || '{}')),
    errorMessage: s.error_message ? String(s.error_message) : null,
    startedAt: String(s.started_at),
    completedAt: s.completed_at ? String(s.completed_at) : null,
    durationMs: s.duration_ms != null ? Number(s.duration_ms) : null,
  }))

  const logRows = db.prepare(`
    SELECT * FROM workflow_logs
    WHERE execution_id = ?
    ORDER BY timestamp ASC
  `).all(id) as Record<string, unknown>[]

  const logs: WorkflowLog[] = logRows.map((l) => ({
    id: String(l.id),
    executionId: l.execution_id ? String(l.execution_id) : null,
    workflowId: l.workflow_id ? String(l.workflow_id) : null,
    stepId: l.step_id ? String(l.step_id) : null,
    event: String(l.event),
    message: String(l.message),
    details: JSON.parse(String(l.details || '{}')),
    timestamp: String(l.timestamp),
  }))

  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    workflowName: String(row.workflow_name),
    status: String(row.status) as ExecutionStatus,
    currentStepId: row.current_step_id ? String(row.current_step_id) : null,
    triggerType: String(row.trigger_type) as WorkflowExecution['triggerType'],
    inputData: JSON.parse(String(row.input_data || '{}')),
    outputData: JSON.parse(String(row.output_data || '{}')),
    errorMessage: row.error_message ? String(row.error_message) : null,
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    steps,
    logs,
  }
}

export function createExecution(params: {
  workflowId: string
  workflowName: string
  triggerType?: 'manual' | 'scheduled' | 'webhook'
  inputData?: Record<string, unknown>
}): WorkflowExecution {
  initWorkflowDb()
  const db = officeDb()
  const id = `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO workflow_executions (
      id, workflow_id, workflow_name, status, trigger_type, input_data, started_at
    ) VALUES (?, ?, ?, 'running', ?, ?, ?)
  `).run(
    id,
    params.workflowId,
    params.workflowName,
    params.triggerType || 'manual',
    JSON.stringify(params.inputData || {}),
    now,
  )

  logWorkflowEvent({
    executionId: id,
    workflowId: params.workflowId,
    event: 'workflow_started',
    message: `Eksekusi workflow "${params.workflowName}" dimulai`,
  })

  return getExecution(id)!
}

export function updateExecution(
  id: string,
  updates: Partial<WorkflowExecution>,
): void {
  initWorkflowDb()
  const db = officeDb()
  const existing = getExecution(id)
  if (!existing) return

  const status = updates.status || existing.status
  const currentStepId = updates.currentStepId !== undefined ? updates.currentStepId : existing.currentStepId
  const outputData = updates.outputData ? JSON.stringify(updates.outputData) : JSON.stringify(existing.outputData)
  const errorMessage = updates.errorMessage !== undefined ? updates.errorMessage : existing.errorMessage
  const completedAt = updates.completedAt || existing.completedAt
  const durationMs = updates.durationMs !== undefined ? updates.durationMs : existing.durationMs

  db.prepare(`
    UPDATE workflow_executions
    SET status = ?, current_step_id = ?, output_data = ?, error_message = ?, completed_at = ?, duration_ms = ?
    WHERE id = ?
  `).run(
    status,
    currentStepId ?? null,
    outputData,
    errorMessage ?? null,
    completedAt ?? null,
    durationMs ?? null,
    id,
  )
}

export function recordStepExecution(stepExec: {
  id?: string
  executionId: string
  stepId: string
  stepName: string
  agentName: string
  stepType: string
  status: string
  inputData?: Record<string, unknown>
  outputData?: Record<string, unknown>
  errorMessage?: string | null
  startedAt: string
  completedAt?: string | null
  durationMs?: number | null
}): string {
  initWorkflowDb()
  const db = officeDb()
  const id = stepExec.id || `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

  db.prepare(`
    INSERT INTO workflow_step_executions (
      id, execution_id, step_id, step_name, agent_name, step_type,
      status, input_data, output_data, error_message, started_at, completed_at, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    stepExec.executionId,
    stepExec.stepId,
    stepExec.stepName,
    stepExec.agentName,
    stepExec.stepType,
    stepExec.status,
    JSON.stringify(stepExec.inputData || {}),
    JSON.stringify(stepExec.outputData || {}),
    stepExec.errorMessage || null,
    stepExec.startedAt,
    stepExec.completedAt || null,
    stepExec.durationMs != null ? stepExec.durationMs : null,
  )

  return id
}

// ------------------------------------------------------------- APPROVALS

export function listApprovals(statusFilter?: ApprovalStatus): WorkflowApproval[] {
  initWorkflowDb()
  const db = officeDb()

  let query = `
    SELECT a.*, w.name as workflow_name, s.agent_name
    FROM workflow_approvals a
    LEFT JOIN workflow_executions e ON a.execution_id = e.id
    LEFT JOIN workflows w ON e.workflow_id = w.id
    LEFT JOIN workflow_steps s ON a.step_id = s.id
  `
  const params: (string | number | bigint | null)[] = []
  if (statusFilter) {
    query += ` WHERE a.status = ?`
    params.push(statusFilter)
  }
  query += ` ORDER BY a.requested_at DESC`

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[]

  return rows.map((r) => ({
    id: String(r.id),
    executionId: String(r.execution_id),
    stepId: String(r.step_id),
    title: String(r.title),
    description: String(r.description || ''),
    status: String(r.status) as ApprovalStatus,
    requestedBy: String(r.requested_by),
    reviewedBy: r.reviewed_by ? String(r.reviewed_by) : null,
    reviewComment: r.review_comment ? String(r.review_comment) : null,
    requestedAt: String(r.requested_at),
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    workflowName: r.workflow_name ? String(r.workflow_name) : undefined,
    agentName: r.agent_name ? String(r.agent_name) : undefined,
  }))
}

export function createApproval(params: {
  executionId: string
  stepId: string
  title: string
  description?: string
  requestedBy?: string
}): WorkflowApproval {
  initWorkflowDb()
  const db = officeDb()
  const id = `appr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO workflow_approvals (
      id, execution_id, step_id, title, description, status, requested_by, requested_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    params.executionId,
    params.stepId,
    params.title,
    params.description || '',
    params.requestedBy || 'workflow_engine',
    now,
  )

  logWorkflowEvent({
    executionId: params.executionId,
    stepId: params.stepId,
    event: 'approval_requested',
    message: `Permintaan approval dibuat: "${params.title}"`,
  })

  return {
    id,
    executionId: params.executionId,
    stepId: params.stepId,
    title: params.title,
    description: params.description || '',
    status: 'pending',
    requestedBy: params.requestedBy || 'workflow_engine',
    requestedAt: now,
  }
}

export function reviewApproval(
  id: string,
  decision: 'approved' | 'rejected',
  reviewer: string,
  comment?: string,
): boolean {
  initWorkflowDb()
  const db = officeDb()
  const now = new Date().toISOString()

  const res = db.prepare(`
    UPDATE workflow_approvals
    SET status = ?, reviewed_by = ?, review_comment = ?, reviewed_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(decision, reviewer, comment || '', now, id) as { changes: number }

  if (res.changes > 0) {
    const appr = db.prepare('SELECT execution_id, step_id, title FROM workflow_approvals WHERE id = ?').get(id) as { execution_id: string; step_id: string; title: string } | undefined
    if (appr) {
      logWorkflowEvent({
        executionId: appr.execution_id,
        stepId: appr.step_id,
        event: decision === 'approved' ? 'approval_granted' : 'approval_rejected',
        message: `Approval "${appr.title}" ${decision === 'approved' ? 'DISETUJUI' : 'DITOLAK'} oleh ${reviewer}`,
      })
    }
    return true
  }
  return false
}

// ------------------------------------------------------------- TOOLS & PERMISSIONS

export function listTools(): WorkflowTool[] {
  initWorkflowDb()
  const db = officeDb()

  const rows = db.prepare(`SELECT * FROM workflow_tools ORDER BY name ASC`).all() as Record<string, unknown>[]

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    displayName: String(r.display_name),
    description: String(r.description || ''),
    category: String(r.category || 'general'),
    inputSchema: JSON.parse(String(r.input_schema || '{}')),
    outputSchema: JSON.parse(String(r.output_schema || '{}')),
    riskLevel: String(r.risk_level) as WorkflowTool['riskLevel'],
    requiresApproval: Number(r.requires_approval) === 1,
    enabled: Number(r.enabled) === 1,
  }))
}

export function getToolPermissions(toolId?: string): { id: string; toolId: string; agentName: string; allowed: boolean }[] {
  initWorkflowDb()
  const db = officeDb()

  let query = `SELECT * FROM workflow_tool_permissions`
  const params: (string | number | bigint | null)[] = []
  if (toolId) {
    query += ` WHERE tool_id = ?`
    params.push(toolId)
  }

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: String(r.id),
    toolId: String(r.tool_id),
    agentName: String(r.agent_name),
    allowed: Number(r.allowed) === 1,
  }))
}

export function setToolPermission(toolId: string, agentName: string, allowed: boolean): void {
  initWorkflowDb()
  const db = officeDb()
  const id = `perm_${toolId}_${agentName}`

  db.prepare(`
    INSERT INTO workflow_tool_permissions (id, tool_id, agent_name, allowed)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tool_id, agent_name) DO UPDATE SET allowed = excluded.allowed
  `).run(id, toolId, agentName, allowed ? 1 : 0)
}

// ------------------------------------------------------------- AUDIT LOGS

export function logWorkflowEvent(entry: {
  executionId?: string | null
  workflowId?: string | null
  stepId?: string | null
  event: string
  message: string
  details?: Record<string, unknown>
}): void {
  try {
    initWorkflowDb()
    const db = officeDb()
    const id = `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const now = new Date().toISOString()

    // Mask sensitive info
    const cleanMessage = maskSensitiveInfo(entry.message)
    const cleanDetails = maskObject(entry.details || {})

    db.prepare(`
      INSERT INTO workflow_logs (id, execution_id, workflow_id, step_id, event, message, details, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.executionId || null,
      entry.workflowId || null,
      entry.stepId || null,
      entry.event,
      cleanMessage,
      JSON.stringify(cleanDetails),
      now,
    )
  } catch (err) {
    console.error('Failed to write workflow log:', err)
  }
}

export function listWorkflowLogs(filter?: { executionId?: string; event?: string; limit?: number }): WorkflowLog[] {
  initWorkflowDb()
  const db = officeDb()

  let query = `SELECT * FROM workflow_logs`
  const params: (string | number | bigint | null)[] = []
  const conditions: string[] = []

  if (filter?.executionId) {
    conditions.push(`execution_id = ?`)
    params.push(filter.executionId)
  }
  if (filter?.event) {
    conditions.push(`event = ?`)
    params.push(filter.event)
  }

  if (conditions.length) {
    query += ` WHERE ` + conditions.join(' AND ')
  }
  query += ` ORDER BY timestamp DESC LIMIT ?`
  params.push(filter?.limit || 100)

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: String(r.id),
    executionId: r.execution_id ? String(r.execution_id) : null,
    workflowId: r.workflow_id ? String(r.workflow_id) : null,
    stepId: r.step_id ? String(r.step_id) : null,
    event: String(r.event),
    message: String(r.message),
    details: JSON.parse(String(r.details || '{}')),
    timestamp: String(r.timestamp),
  }))
}

// ------------------------------------------------------------- DASHBOARD STATS

export function getWorkflowDashboardStats(): WorkflowDashboardStats {
  initWorkflowDb()
  const db = officeDb()

  const totalWorkflows = (db.prepare('SELECT COUNT(*) as c FROM workflows').get() as { c: number })?.c || 0
  const activeWorkflows = (db.prepare("SELECT COUNT(*) as c FROM workflows WHERE status = 'active'").get() as { c: number })?.c || 0
  const totalExecutions = (db.prepare('SELECT COUNT(*) as c FROM workflow_executions').get() as { c: number })?.c || 0
  const runningExecutions = (db.prepare("SELECT COUNT(*) as c FROM workflow_executions WHERE status = 'running'").get() as { c: number })?.c || 0
  const completedExecutions = (db.prepare("SELECT COUNT(*) as c FROM workflow_executions WHERE status = 'completed'").get() as { c: number })?.c || 0
  const failedExecutions = (db.prepare("SELECT COUNT(*) as c FROM workflow_executions WHERE status = 'failed'").get() as { c: number })?.c || 0
  const waitingApproval = (db.prepare("SELECT COUNT(*) as c FROM workflow_approvals WHERE status = 'pending'").get() as { c: number })?.c || 0

  const recentActivities = listWorkflowLogs({ limit: 12 })

  return {
    totalWorkflows,
    activeWorkflows,
    totalExecutions,
    runningExecutions,
    completedExecutions,
    failedExecutions,
    waitingApproval,
    recentActivities,
  }
}

// ------------------------------------------------------------- SENSITIVE DATA MASKING

export function maskSensitiveInfo(str: string): string {
  if (!str) return ''
  return str
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{8,}/gi, '$1***MASKED***')
    .replace(/(api[_-]?key["':\s=]+)[A-Za-z0-9_\-]{8,}/gi, '$1***MASKED***')
    .replace(/(password["':\s=]+)[^"\s,}{]+/gi, '$1***MASKED***')
    .replace(/(secret["':\s=]+)[A-Za-z0-9_\-]{8,}/gi, '$1***MASKED***')
}

export function maskObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const keyLower = k.toLowerCase()
    if (keyLower.includes('key') || keyLower.includes('token') || keyLower.includes('password') || keyLower.includes('secret')) {
      result[k] = '***MASKED***'
    } else if (typeof v === 'string') {
      result[k] = maskSensitiveInfo(v)
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = maskObject(v as Record<string, unknown>)
    } else {
      result[k] = v
    }
  }
  return result
}
