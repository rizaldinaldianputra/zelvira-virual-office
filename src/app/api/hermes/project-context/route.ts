import { NextRequest, NextResponse } from 'next/server'
import {
  getProjectContext,
  saveProjectContext,
  syncProjectContextToAllProfiles,
  testProjectIntegration,
  type ProjectIntegrationConfig,
} from '@/lib/hermes/project-context'
import { assertLocalWriteRequest } from '@/lib/local-guard'

export const dynamic = 'force-dynamic'

/**
 * Endpoint Pengaturan Integrasi Proyek & Server Zelvira.
 *
 * GET: Mengambil konfigurasi aktif (password/token disamarkan) & status uji
 * POST: Simpan konfigurasi, sinkronkan ke SOUL.md profil agent, atau uji koneksi
 */
export async function GET(req: NextRequest) {
  try {
    const config = await getProjectContext(false)
    const url = new URL(req.url)
    const runTest = url.searchParams.get('test') === '1'

    let testResult = null
    if (runTest) {
      testResult = await testProjectIntegration()
    }

    return NextResponse.json({
      success: true,
      config,
      test: testResult,
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'fetch_failed', message: (err as Error).message, status: 500 } },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'save').trim()

    switch (action) {
      case 'save': {
        const updates: Partial<ProjectIntegrationConfig> = body?.config || {}
        const saved = await saveProjectContext(updates)
        return NextResponse.json({
          success: true,
          action,
          config: {
            ...saved,
            dbPassword: saved.dbPassword ? '••••••••' : '',
            adminToken: saved.adminToken ? '••••••••' : '',
            adminPassword: saved.adminPassword ? '••••••••' : '',
          },
        })
      }

      case 'sync': {
        const syncResult = await syncProjectContextToAllProfiles()
        return NextResponse.json({
          success: true,
          action,
          profilesUpdated: syncResult.profilesUpdated,
          details: syncResult.details,
          message: `Berhasil menyinkronkan pengetahuan proyek Zelvira ke ${syncResult.profilesUpdated.length} profil agen.`,
        })
      }

      case 'test': {
        const testResult = await testProjectIntegration()
        return NextResponse.json({
          success: true,
          action,
          result: testResult,
        })
      }

      default:
        return NextResponse.json(
          { error: { code: 'unknown_action', message: `Action "${action}" tidak dikenali`, status: 400 } },
          { status: 400 },
        )
    }
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'operation_failed', message: (err as Error).message, status: 500 } },
      { status: 500 },
    )
  }
}
