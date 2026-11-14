import { NextRequest, NextResponse } from 'next/server'
import { listApprovals } from '@/lib/workflow/db'
import type { ApprovalStatus } from '@/lib/workflow/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const status = url.searchParams.get('status') as ApprovalStatus | null
    const approvals = listApprovals(status || undefined)
    return NextResponse.json({ success: true, approvals })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'fetch_error', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
