import { NextRequest, NextResponse } from 'next/server'
import { getToolPermissions, listTools, setToolPermission } from '@/lib/workflow/db'
import { assertLocalWriteRequest } from '@/lib/local-guard'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const toolId = url.searchParams.get('toolId') || undefined
    const tools = listTools()
    const permissions = getToolPermissions(toolId)
    return NextResponse.json({ success: true, tools, permissions })
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
      toolId?: string
      agentName?: string
      allowed?: boolean
    }

    if (!body?.toolId || !body?.agentName) {
      return NextResponse.json(
        { error: { code: 'invalid_input', message: 'toolId dan agentName wajib diisi' } },
        { status: 400 },
      )
    }

    setToolPermission(body.toolId, body.agentName, body.allowed !== false)
    return NextResponse.json({ success: true, toolId: body.toolId, agentName: body.agentName, allowed: body.allowed !== false })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'update_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
