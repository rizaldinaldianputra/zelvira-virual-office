import { NextRequest, NextResponse } from 'next/server'
import { listWorkflows, saveWorkflow } from '@/lib/workflow/db'
import { assertLocalWriteRequest } from '@/lib/local-guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const workflows = listWorkflows()
    return NextResponse.json({ success: true, workflows })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'fetch_error', message: (err as Error).message } },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied

  try {
    const body = (await req.json()) as {
      name?: string
      description?: string
      status?: 'active' | 'inactive'
      config?: Record<string, unknown>
      steps?: unknown[]
    }

    if (!body?.name?.trim()) {
      return NextResponse.json(
        { error: { code: 'invalid_input', message: 'Nama workflow wajib diisi' } },
        { status: 400 },
      )
    }

    const wf = saveWorkflow({
      name: body.name.trim(),
      description: body.description?.trim(),
      status: body.status || 'active',
      config: body.config,
      steps: body.steps as any,
    })

    return NextResponse.json({ success: true, workflow: wf }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'create_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
