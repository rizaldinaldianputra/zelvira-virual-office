import { NextRequest, NextResponse } from 'next/server'
import { deleteWorkflow, getWorkflow, saveWorkflow } from '@/lib/workflow/db'
import { assertLocalWriteRequest } from '@/lib/local-guard'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const wf = getWorkflow(id)
    if (!wf) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Workflow "${id}" tidak ditemukan` } },
        { status: 404 },
      )
    }
    return NextResponse.json({ success: true, workflow: wf })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'fetch_error', message: (err as Error).message } },
      { status: 500 },
    )
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied

  try {
    const { id } = await params
    const existing = getWorkflow(id)
    if (!existing) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Workflow "${id}" tidak ditemukan` } },
        { status: 404 },
      )
    }

    const body = (await req.json()) as {
      name?: string
      description?: string
      status?: 'active' | 'inactive'
      config?: Record<string, unknown>
      steps?: unknown[]
    }

    const updated = saveWorkflow({
      id,
      name: body.name?.trim() || existing.name,
      description: body.description !== undefined ? body.description.trim() : existing.description,
      status: body.status || existing.status,
      config: body.config !== undefined ? body.config : existing.config,
      steps: body.steps as any,
    })

    return NextResponse.json({ success: true, workflow: updated })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'update_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied

  try {
    const { id } = await params
    const ok = deleteWorkflow(id)
    if (!ok) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Workflow "${id}" tidak ditemukan` } },
        { status: 404 },
      )
    }
    return NextResponse.json({ success: true, deleted: id })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'delete_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
