import { NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { LOGO_BASE64 } from '@/lib/office/logoBase64'

export const dynamic = 'force-static'
export const revalidate = 86400

export async function GET() {
  try {
    const publicPath = path.join(process.cwd(), 'public', 'logo.png')
    let buffer: Buffer
    if (existsSync(publicPath)) {
      buffer = readFileSync(publicPath)
    } else {
      buffer = Buffer.from(LOGO_BASE64, 'base64')
    }

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (err) {
    const fallbackBuffer = Buffer.from(LOGO_BASE64, 'base64')
    return new Response(new Uint8Array(fallbackBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  }
}
