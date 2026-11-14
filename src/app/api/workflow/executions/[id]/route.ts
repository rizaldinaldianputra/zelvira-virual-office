import { NextRequest, NextResponse } from 'next/server'
import { getExecution } from '@/lib/workflow/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const execution = getExecution(id)
    if (!execution) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Execution "${id}" tidak ditemukan` } },
        { status: 404 },
      )
    }
    return NextResponse.json({ success: true, execution })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'fetch_error', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
