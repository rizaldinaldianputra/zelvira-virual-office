import { NextRequest, NextResponse } from 'next/server'
import { reviewApproval } from '@/lib/workflow/db'
import { resumeWorkflowAfterApproval } from '@/lib/workflow/engine'
import { assertLocalWriteRequest } from '@/lib/local-guard'
import { officeDb } from '@/lib/office/db'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied

  try {
    const { id } = await params
    const body = (await req.json()) as {
      decision?: 'approved' | 'rejected'
      reviewer?: string
      comment?: string
    }

    if (!body?.decision || (body.decision !== 'approved' && body.decision !== 'rejected')) {
      return NextResponse.json(
        { error: { code: 'invalid_decision', message: 'Decision harus "approved" atau "rejected"' } },
        { status: 400 },
      )
    }

    const db = officeDb()
    const appr = db.prepare('SELECT execution_id, step_id FROM workflow_approvals WHERE id = ?').get(id) as
      | { execution_id: string; step_id: string }
      | undefined

    if (!appr) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Approval "${id}" tidak ditemukan` } },
        { status: 404 },
      )
    }

    const reviewer = body.reviewer?.trim() || 'Admin'
    const success = reviewApproval(id, body.decision, reviewer, body.comment)
    if (!success) {
      return NextResponse.json(
        { error: { code: 'already_reviewed', message: 'Approval sudah pernah ditinjau' } },
        { status: 409 },
      )
    }

    // If approved, resume the execution
    if (body.decision === 'approved') {
      void resumeWorkflowAfterApproval(appr.execution_id, appr.step_id)
    }

    return NextResponse.json({ success: true, id, decision: body.decision })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'review_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
