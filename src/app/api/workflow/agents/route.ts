import { NextResponse } from 'next/server'
import { listAgents, listAssignees, listProfiles, listTasks } from '@/lib/hermes/kanban'
import { listWorkflows } from '@/lib/workflow/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [profiles, tasks, assignees, workflows] = await Promise.all([
      listProfiles().catch(() => ['default']),
      listTasks().catch(() => []),
      listAssignees().catch(() => []),
      Promise.resolve(listWorkflows()),
    ])

    const agents = await listAgents(tasks, assignees).catch(() => [])

    // Map each agent to workflows they participate in
    const agentWorkflows = new Map<string, { id: string; name: string; stepName: string }[]>()
    for (const wf of workflows) {
      for (const step of wf.steps || []) {
        if (!step.agentName) continue
        const existing = agentWorkflows.get(step.agentName) || []
        existing.push({ id: wf.id, name: wf.name, stepName: step.name })
        agentWorkflows.set(step.agentName, existing)
      }
    }

    // Combine profile data
    const registry = profiles.map((pName) => {
      const live = agents.find((a) => a.name === pName)
      const associated = agentWorkflows.get(pName) || []

      return {
        name: pName,
        displayName: live?.displayName || pName,
        role: live?.role || 'staff',
        division: live?.division || 'engineering',
        status: live?.status || 'idle',
        currentTaskId: live?.currentTaskId || null,
        assignedWorkflows: associated,
        workflowCount: associated.length,
      }
    })

    return NextResponse.json({ success: true, agents: registry })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'fetch_error', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
