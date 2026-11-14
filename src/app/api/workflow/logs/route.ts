import { NextRequest, NextResponse } from 'next/server'
import { listWorkflowLogs } from '@/lib/workflow/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const executionId = url.searchParams.get('executionId') || undefined
    const event = url.searchParams.get('event') || undefined
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500)

    const logs = listWorkflowLogs({ executionId, event, limit })
    return NextResponse.json({ success: true, logs })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'fetch_error', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
