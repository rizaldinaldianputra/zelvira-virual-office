import { NextRequest, NextResponse } from 'next/server'
import { officeDb } from '@/lib/office/db'
import { initWorkflowDb } from '@/lib/workflow/db'
import { assertLocalWriteRequest } from '@/lib/local-guard'

export const dynamic = 'force-dynamic'

const DEFAULT_SETTINGS: Record<string, string> = {
  max_parallel_executions: '5',
  default_step_timeout_seconds: '60',
  default_retry_count: '2',
  auto_cleanup_logs_days: '30',
  require_approval_high_risk: 'true',
  notify_approval_email: '',
}

export async function GET() {
  try {
    initWorkflowDb()
    const db = officeDb()
    const rows = db.prepare('SELECT key, value FROM workflow_settings').all() as { key: string; value: string }[]
    const settings = { ...DEFAULT_SETTINGS }
    for (const r of rows) {
      settings[r.key] = r.value
    }
    return NextResponse.json({ success: true, settings })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'fetch_error', message: (err as Error).message } },
      { status: 500 },
    )
  }
}

export async function PUT(req: NextRequest) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied

  try {
    initWorkflowDb()
    const db = officeDb()
    const body = (await req.json()) as Record<string, unknown>
    const now = new Date().toISOString()

    const upsert = db.prepare(`
      INSERT INTO workflow_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)

    for (const [key, val] of Object.entries(body)) {
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        upsert.run(key, String(val), now)
      }
    }

    return NextResponse.json({ success: true, updated: true })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'update_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
