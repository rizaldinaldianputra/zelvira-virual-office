import { NextRequest, NextResponse } from 'next/server'
import { createExecution, getWorkflow } from '@/lib/workflow/db'
import { executeWorkflow } from '@/lib/workflow/engine'
import { assertLocalWriteRequest } from '@/lib/local-guard'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied

  try {
    const { id } = await params
    const wf = getWorkflow(id)
    if (!wf) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Workflow "${id}" tidak ditemukan` } },
        { status: 404 },
      )
    }

    let inputData: Record<string, unknown> = {}
    try {
      const body = (await req.json()) as { inputData?: Record<string, unknown> }
      if (body?.inputData && typeof body.inputData === 'object') {
        inputData = body.inputData
      }
    } catch {}

    const execution = createExecution({
      workflowId: wf.id,
      workflowName: wf.name,
      triggerType: 'manual',
      inputData,
    })

    // Trigger engine execution
    const live = await executeWorkflow(execution.id)

    return NextResponse.json({ success: true, execution: live }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'execute_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
