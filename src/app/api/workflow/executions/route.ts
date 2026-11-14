import { NextRequest, NextResponse } from 'next/server'
import { listExecutions } from '@/lib/workflow/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)
    const executions = listExecutions(limit)
    return NextResponse.json({ success: true, executions })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'fetch_error', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
