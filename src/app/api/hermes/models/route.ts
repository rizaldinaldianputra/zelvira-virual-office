import { NextRequest, NextResponse } from 'next/server'
import {
  getHermesDefaultModel,
  listModels,
  listProfiles,
  profileModel,
  saveCustomProviderAndModel,
  setHermesDefaultModel,
  setProfileModel,
  syncAllProfilesToDefault,
} from '@/lib/hermes/kanban'
import { assertLocalWriteRequest } from '@/lib/local-guard'

export const dynamic = 'force-dynamic'

/**
 * Model catalogue & settings for Hermes Virtual Office.
 * Reads from CLI and config.yaml, allowing setting default models or custom providers.
 */
export async function GET() {
  try {
    const [models, def, profiles] = await Promise.all([
      listModels().catch(() => []),
      getHermesDefaultModel().catch(() => ({ model: null, provider: null })),
      listProfiles().catch(() => []),
    ])

    const profileDetails = await Promise.all(
      profiles.map(async (name) => {
        const pm = await profileModel(name).catch(() => ({ model: null, provider: null }))
        return {
          name,
          model: pm.model,
          provider: pm.provider,
          isDefault: !pm.model || pm.model === def.model,
        }
      }),
    )

    return NextResponse.json({
      models,
      defaultModel: def.model,
      defaultProvider: def.provider,
      profiles: profileDetails,
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'hermes_unavailable', message: (err as Error).message, status: 503 } },
      { status: 503 },
    )
  }
}

export async function POST(req: NextRequest) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || '').trim()

    switch (action) {
      case 'setDefault': {
        const model = String(body?.model || '').trim()
        const provider = body?.provider ? String(body.provider).trim() : null
        const applyToAll = !!body?.applyToAllProfiles

        if (!model) {
          return NextResponse.json(
            { error: { code: 'invalid_request', message: 'model wajib diisi', status: 400 } },
            { status: 400 },
          )
        }

        await setHermesDefaultModel(model, provider)
        let updated: string[] = []
        if (applyToAll) {
          const res = await syncAllProfilesToDefault(model, provider)
          updated = res.profilesUpdated
        }

        return NextResponse.json({
          success: true,
          action,
          model,
          provider,
          appliedToProfiles: updated,
        })
      }

      case 'setCustomProvider': {
        const name = String(body?.name || '').trim()
        const apiKey = String(body?.apiKey || '').trim()
        const baseUrl = body?.baseUrl ? String(body.baseUrl).trim() : undefined
        const model = String(body?.model || '').trim()
        const setAsDefault = body?.setAsDefault !== false
        const applyToAll = !!body?.applyToAllProfiles

        if (!model) {
          return NextResponse.json(
            { error: { code: 'invalid_request', message: 'model wajib diisi', status: 400 } },
            { status: 400 },
          )
        }
        if (!apiKey) {
          return NextResponse.json(
            { error: { code: 'invalid_request', message: 'apiKey wajib diisi', status: 400 } },
            { status: 400 },
          )
        }

        const res = await saveCustomProviderAndModel({
          name: name || 'custom',
          apiKey,
          baseUrl,
          model,
          setAsDefault,
          applyToAllProfiles: applyToAll,
        })

        return NextResponse.json({
          success: true,
          action,
          ...res,
        })
      }

      case 'syncAll': {
        const res = await syncAllProfilesToDefault()
        return NextResponse.json({
          success: true,
          action,
          defaultModel: res.model,
          defaultProvider: res.provider,
          profilesUpdated: res.profilesUpdated,
        })
      }

      case 'setProfileModel': {
        const name = String(body?.name || '').trim()
        const model = String(body?.model || '').trim()
        const provider = body?.provider ? String(body.provider).trim() : null

        if (!name || !model) {
          return NextResponse.json(
            { error: { code: 'invalid_request', message: 'name dan model wajib diisi', status: 400 } },
            { status: 400 },
          )
        }

        await setProfileModel(name, model, provider)
        return NextResponse.json({
          success: true,
          action,
          name,
          model,
          provider,
        })
      }

      default:
        return NextResponse.json(
          { error: { code: 'invalid_request', message: `action tidak dikenal: ${action}`, status: 400 } },
          { status: 400 },
        )
    }
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'action_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
