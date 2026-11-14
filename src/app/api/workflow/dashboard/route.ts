import { NextResponse } from 'next/server'
import { getWorkflowDashboardStats } from '@/lib/workflow/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const stats = getWorkflowDashboardStats()
    return NextResponse.json({ success: true, stats })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'dashboard_error', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
