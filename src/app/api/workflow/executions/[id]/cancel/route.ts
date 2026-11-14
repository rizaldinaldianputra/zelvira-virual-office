import { NextRequest, NextResponse } from 'next/server'
import { cancelWorkflowExecution } from '@/lib/workflow/engine'
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
    const ok = cancelWorkflowExecution(id)
    return NextResponse.json({ success: ok, id })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'cancel_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
