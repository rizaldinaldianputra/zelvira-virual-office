import { NextRequest, NextResponse } from 'next/server'
import { duplicateWorkflow } from '@/lib/workflow/db'
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
    const cloned = duplicateWorkflow(id)
    if (!cloned) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Workflow "${id}" tidak ditemukan` } },
        { status: 404 },
      )
    }
    return NextResponse.json({ success: true, workflow: cloned }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'duplicate_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
