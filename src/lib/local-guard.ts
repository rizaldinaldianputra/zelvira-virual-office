import { NextResponse } from 'next/server'

/**
 * Write guard for the office's mutating endpoints.
 *
 * WHY THIS FILE EXISTS: every action that changes something — kill, spawn, hide,
 * create a task, send a chat, start a meeting, rename the office — goes through
 * here. The office is normally opened at its PUBLIC address, but this guard once
 * allowed only loopback names, so every write from a real browser was answered
 * 403. Reads worked, which is exactly why the app looked alive but felt dead:
 * nothing you clicked did anything.
 *
 * TWO checks, and both are needed:
 *
 *   1. SAME-ORIGIN. The `Origin` header must name the very host being requested.
 *      This is the CSRF defence: a page on evil.example sends
 *      `Origin: http://evil.example`, which can never equal our `Host`.
 *
 *   2. A TRUSTED HOST. That host must be loopback or explicitly listed in
 *      `ALLOWED_ORIGINS`. This is the DNS-rebinding defence: an attacker who
 *      points evil.example at our IP gets `Host` and `Origin` to agree, but
 *      evil.example is not on the list.
 *
 * WHAT THIS DOES **NOT** DO: it does not authenticate anyone. A person who opens
 * the office URL in a browser IS same-origin, so they can write. On a public port
 * that means anyone who knows the URL can act. This guard stops cross-site
 * attacks, not visitors. Real protection needs a token — see docs/API-SPEC.md.
 */

/** Loopback names, always trusted. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Extra hosts allowed to write, from `ALLOWED_ORIGINS` in `.env.local`.
 *
 * Comma-separated `host[:port]` entries; a scheme prefix is tolerated so an
 * operator can paste a full origin. Example:
 *
 *   ALLOWED_ORIGINS=203.0.113.10:3300,office.example.com
 */
function rawConfiguredEntries(): string[] {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function configuredHosts(): string[] {
  return rawConfiguredEntries()
    .map((s) => s.replace(/^https?:\/\//, '').replace(/\/+$/, ''))
    .filter(Boolean)
}

/** Strip a trailing `:port`, leaving the bare host (handles `[::1]:3000`). */
function bareHost(host: string): string {
  return host.replace(/:\d+$/, '')
}

function trustedHost(host: string): boolean {
  if (LOOPBACK.has(bareHost(host))) return true
  const bare = bareHost(host)
  return configuredHosts().some((entry) => entry === host || entry === bare)
}

export function localOriginAllowed(hostHeader: string | null, originHeader: string | null): boolean {
  if (!hostHeader || !originHeader) return false

  try {
    const host = new URL(`http://${hostHeader}`)
    const origin = new URL(originHeader)
    // 1. same-origin: the Origin names the host being requested
    if (origin.host !== host.host) return false
    // 2. and that host is one we trust
    if (!trustedHost(host.host)) return false

    // HTTP is always allowed for trusted hosts
    if (origin.protocol === 'http:') return true

    // HTTPS: allowed for public domain deployments or when explicitly configured
    if (origin.protocol === 'https:') {
      const bare = bareHost(host.host)
      // Disallow loopback localhost over https (preserves scheme mismatch check)
      if (LOOPBACK.has(bare)) return false
      // Disallow plain IP addresses unless explicitly configured with https://
      const isPlainIp = /^\d+\.\d+\.\d+\.\d+/.test(bare)
      if (isPlainIp) {
        const raw = rawConfiguredEntries()
        return raw.some((e) => e.startsWith('https://') && (e.includes(host.host) || e.includes(bare)))
      }
      // For any configured domain name (e.g. office.zelixa.my.id, office.example.com):
      return true
    }

    return false
  } catch {
    return false
  }
}

export function assertLocalWriteRequest(req: Request): NextResponse | null {
  const host = req.headers.get('host')
  const origin = req.headers.get('origin')
  if (localOriginAllowed(host, origin)) return null
  // The message names the fix, because a silent 403 here is indistinguishable
  // from a broken button — which is precisely how this bug hid for so long.
  return NextResponse.json(
    {
      error: {
        code: 'forbidden_origin',
        message:
          `origin "${origin ?? '(tidak ada)'}" tidak diizinkan menulis. ` +
          `Tambahkan "${origin ?? host ?? 'host ini'}" ke ALLOWED_ORIGINS di .env.local, lalu restart.`,
        status: 403,
      },
    },
    { status: 403 },
  )
}
