/**
 * Integrasi Proyek & Server Zelvira untuk AI Agent Hermes.
 *
 * Mengelola pengetahuan proyek (/var/www/ecommerce), kredensial database PostgreSQL,
 * dan portal admin (admin.zelvira.my.id) agar agent memahami konteks nyata proyek
 * dan memiliki batasan keamanan yang ketat.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { officeDb } from '@/lib/office/db'
import { hermesHome, listProfiles } from './kanban'
import { parseSoulMarker, soulFor } from './soul'
import type { AgentDivision, AgentRole } from '@/types/hermes'

export interface ProjectIntegrationConfig {
  // Lokasi Proyek Server
  ecommercePath: string
  framework: string
  serverHost: string
  projectDescription: string

  // Database PostgreSQL
  dbEnabled: boolean
  dbHost: string
  dbPort: number
  dbName: string
  dbUser: string
  dbPassword?: string
  dbReadOnly: boolean
  dbKeyTables: string

  // Portal Admin Zelvira
  adminPortalUrl: string
  adminAuthType: 'api_token' | 'credentials'
  adminToken?: string
  adminUsername?: string
  adminPassword?: string
  adminContentEndpoint: string
  adminForceDraft: boolean

  // Keamanan & Akses
  allowBashExecution: boolean
  requireConfirmationForDestructive: boolean
  updatedAt: string
}

export const DEFAULT_PROJECT_CONFIG: ProjectIntegrationConfig = {
  ecommercePath: '/var/www/ecommerce',
  framework: 'Next.js / Node.js / PostgreSQL',
  serverHost: 'VM-32-155-ubuntu (127.0.0.1)',
  projectDescription: 'Zelvira E-Commerce Ecosystem (Storefront, Keranjang Belanja, Katalog Produk, & Blog)',

  dbEnabled: true,
  dbHost: '127.0.0.1',
  dbPort: 5432,
  dbName: 'ecommerce',
  dbUser: 'postgres',
  dbPassword: '',
  dbReadOnly: true,
  dbKeyTables: 'products, categories, articles, content_posts, users, orders',

  adminPortalUrl: 'https://admin.zelvira.my.id',
  adminAuthType: 'api_token',
  adminToken: '',
  adminUsername: 'content_creator',
  adminPassword: '',
  adminContentEndpoint: '/api/articles',
  adminForceDraft: true,

  allowBashExecution: true,
  requireConfirmationForDestructive: true,
  updatedAt: new Date().toISOString(),
}

/** Inisialisasi tabel konfigurasi integrasi di database kantor */
function ensureTable() {
  const db = officeDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_integration (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

const CONFIG_KEY = 'zelvira_project_integration'

/** Membaca konfigurasi integrasi proyek */
export async function getProjectContext(includeSecrets = false): Promise<ProjectIntegrationConfig> {
  ensureTable()
  const db = officeDb()

  let raw = ''
  try {
    const row = db.prepare('SELECT value FROM project_integration WHERE key = ?').get(CONFIG_KEY) as { value: string } | undefined
    if (row?.value) {
      raw = row.value
    }
  } catch {}

  // Fallback membaca dari file json jika di DB belum ada
  if (!raw) {
    const jsonPaths = [
      path.join(hermesHome(), 'project-context.json'),
      path.join(process.cwd(), 'data', 'project-context.json'),
    ]
    for (const p of jsonPaths) {
      if (existsSync(p)) {
        try {
          raw = await readFile(p, 'utf8')
          break
        } catch {}
      }
    }
  }

  let config: ProjectIntegrationConfig = { ...DEFAULT_PROJECT_CONFIG }
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      config = { ...DEFAULT_PROJECT_CONFIG, ...parsed }
    } catch {}
  }

  if (!includeSecrets) {
    return {
      ...config,
      dbPassword: config.dbPassword ? '••••••••' : '',
      adminToken: config.adminToken ? '••••••••' : '',
      adminPassword: config.adminPassword ? '••••••••' : '',
    }
  }

  return config
}

/** Menyimpan konfigurasi integrasi proyek */
export async function saveProjectContext(
  updates: Partial<ProjectIntegrationConfig>,
): Promise<ProjectIntegrationConfig> {
  ensureTable()
  const current = await getProjectContext(true)

  // Tangani field terselubung agar tidak ter-overwrite oleh masked value "••••••••"
  const sanitized: ProjectIntegrationConfig = {
    ...current,
    ...updates,
    dbPassword:
      updates.dbPassword && updates.dbPassword !== '••••••••'
        ? updates.dbPassword
        : current.dbPassword || '',
    adminToken:
      updates.adminToken && updates.adminToken !== '••••••••'
        ? updates.adminToken
        : current.adminToken || '',
    adminPassword:
      updates.adminPassword && updates.adminPassword !== '••••••••'
        ? updates.adminPassword
        : current.adminPassword || '',
    updatedAt: new Date().toISOString(),
  }

  const jsonStr = JSON.stringify(sanitized, null, 2)
  const db = officeDb()
  db.prepare(`
    INSERT INTO project_integration (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(CONFIG_KEY, jsonStr, sanitized.updatedAt)

  // Mirror ke file sistem agar tools CLI / script fallback juga bisa membaca
  const homePath = path.join(hermesHome(), 'project-context.json')
  const localDataPath = path.join(process.cwd(), 'data', 'project-context.json')
  await writeFile(homePath, jsonStr, 'utf8').catch(() => {})
  await writeFile(localDataPath, jsonStr, 'utf8').catch(() => {})

  // Sinkronkan ke ~/.hermes/.env untuk runtime tools jika ada DB / token
  await syncToHermesEnv(sanitized).catch(() => {})

  return sanitized
}

/** Sinkronkan variabel penting ke file ~/.hermes/.env */
async function syncToHermesEnv(cfg: ProjectIntegrationConfig): Promise<void> {
  const envPath = path.join(hermesHome(), '.env')
  let existing = ''
  try {
    if (existsSync(envPath)) {
      existing = await readFile(envPath, 'utf8')
    }
  } catch {}

  const lines = existing ? existing.split('\n') : []
  const map = new Map<string, string>()

  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq !== -1) {
      map.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim())
    }
  }

  map.set('ZELVIRA_PROJECT_PATH', cfg.ecommercePath)
  map.set('ZELVIRA_ADMIN_URL', cfg.adminPortalUrl)
  if (cfg.adminToken && cfg.adminToken !== '••••••••') {
    map.set('ZELVIRA_ADMIN_TOKEN', cfg.adminToken)
  }
  if (cfg.dbEnabled && cfg.dbHost && cfg.dbName) {
    const passPart = cfg.dbPassword && cfg.dbPassword !== '••••••••' ? `:${cfg.dbPassword}` : ''
    map.set('DATABASE_URL', `postgresql://${cfg.dbUser}${passPart}@${cfg.dbHost}:${cfg.dbPort}/${cfg.dbName}`)
  }

  const out = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('\n')
  await writeFile(envPath, out + '\n', 'utf8')
}

/**
 * Format string konteks proyek untuk disuntikkan ke prompt LLM (System Prompt).
 */
export function formatProjectContextPrompt(
  cfg: ProjectIntegrationConfig,
  agentRole?: string,
  agentName?: string,
): string {
  const isContent =
    agentRole === 'content' ||
    agentName?.toLowerCase().includes('content') ||
    agentName?.toLowerCase().includes('creator')
  const isSeo = agentRole === 'seo' || agentName?.toLowerCase().includes('seo')
  const isTech =
    agentRole === 'backend' ||
    agentRole === 'devops' ||
    agentRole === 'tech' ||
    agentRole === 'manager'

  const lines: string[] = [
    `## 🏢 KONTEKS PROYEK RESMI ZELVIRA (Server & Infrastruktur)`,
    `- Lokasi Codebase: \`${cfg.ecommercePath}\` (${cfg.framework})`,
    `- Server Host: \`${cfg.serverHost}\``,
    `- Deskripsi: ${cfg.projectDescription}`,
  ]

  if (cfg.dbEnabled) {
    lines.push(
      `- Database PostgreSQL: \`${cfg.dbHost}:${cfg.dbPort}\` (Database: \`${cfg.dbName}\`, User: \`${cfg.dbUser}\`)`,
      `- Tabel Kunci Database: \`${cfg.dbKeyTables}\``,
      cfg.dbReadOnly
        ? `- Keamanan Database: [READ-ONLY QUERY SAFE MODE]. Hanya gunakan query SELECT analitik. Dilarang keras query DROP TABLE atau DELETE sembarangan.`
        : `- Keamanan Database: Berhati-hati dalam manipulasi data. Selalu gunakan transaksi dan parameter aman.`,
    )
  }

  lines.push(
    `- Portal Admin Zelvira: \`${cfg.adminPortalUrl}\``,
    `- Endpoint Pembuatan Konten: \`${cfg.adminContentEndpoint}\``,
  )

  if (isContent) {
    lines.push(
      ``,
      `### ✍️ SOP KHUSUS CONTENT CREATOR UNTUK ADMIN ZELVIRA:`,
      `1. Portal Tujuan: \`${cfg.adminPortalUrl}\` (Endpoint API: \`${cfg.adminContentEndpoint}\`).`,
      `2. Kredensial: Menggunakan akun resmi content (\`${cfg.adminUsername}\`) atau API Token yang tersedia di sistem.`,
      `3. ⚠️ ATURAN KEAMANAN KONTEN (PENTING): Setiap konten yang dibuat WAJIB memiliki status "draft" (\`"status": "draft"\`). DILARANG langsung mengubah status menjadi "published" tanpa persetujuan tim review manusia.`,
      `4. Struktur Payload Konten Standar:`,
      `   \`\`\`json`,
      `   {`,
      `     "title": "Judul Menarik & Relevan",`,
      `     "slug": "judul-menarik-relevan",`,
      `     "excerpt": "Ringkasan konten 1-2 kalimat pemikat",`,
      `     "content": "Isi lengkap format Markdown / HTML...",`,
      `     "category": "Kategori yang relevan",`,
      `     "tags": ["zelvira", "ecommerce"],`,
      `     "status": "draft"`,
      `   }`,
      `   \`\`\``,
      `5. Setiap kali menerima instruksi membuat konten, susun artikel secara mendalam, sertakan payload JSON di atas, dan laporkan bahwa draf konten siap dikirim ke portal admin Zelvira.`,
    )
  }

  if (isSeo) {
    lines.push(
      ``,
      `### 🔍 SOP KHUSUS SEO AGENT:`,
      `1. Analisa kata kunci dan tren untuk produk & artikel Zelvira di \`${cfg.adminPortalUrl}\`.`,
      `2. Pastikan setiap artikel/produk memiliki Meta Title (< 60 char), Meta Description (< 160 char), Focus Keyword, dan hierarki heading (H1, H2, H3) yang rapi.`,
      `3. Optimasi struktur URL slug agar ringkas, deskriptif, dan ramah mesin pencari.`,
    )
  }

  if (isTech) {
    lines.push(
      ``,
      `### ⚙️ SOP TEKNIS (BACKEND & DEVOPS):`,
      `1. Akses folder \`${cfg.ecommercePath}\` secara teratur untuk memeriksa routing, komponen, dan skema database.`,
      `2. Pastikan query ke database PostgreSQL \`${cfg.dbName}\` terindeks dengan baik dan tidak menimbulkan bottleneck.`,
    )
  }

  lines.push(
    ``,
    `### 🛡️ PRINSIP KEAMANAN:`,
    `- DILARANG menjalankan perintah sistem destruktif (\`rm -rf\`, penghapusan file kunci, pembongkaran konfigurasi).`,
    `- Selalu sertakan bukti hasil kerja konkret (log, output JSON, atau status eksekusi).`,
  )

  return lines.join('\n')
}

/**
 * Sinkronkan Konteks Proyek ke semua file SOUL.md profil Hermes di disk (~/.hermes/profiles/.../SOUL.md)
 */
export async function syncProjectContextToAllProfiles(): Promise<{
  profilesUpdated: string[]
  details: Record<string, string>
}> {
  const cfg = await getProjectContext(true)
  const listed = await listProfiles()
  // Pastikan profil inti (default, contencreator, seo) selalu terjangkau saat sinkronisasi
  const targetProfiles = Array.from(new Set([...listed, 'default', 'contencreator', 'seo']))
  const profilesUpdated: string[] = []
  const details: Record<string, string> = {}

  const home = hermesHome()

  for (const name of targetProfiles) {
    try {
      const isDefault = name === 'default'
      const dir = isDefault ? home : path.join(home, 'profiles', name)
      const soulPath = path.join(dir, 'SOUL.md')

      let oldSoul = ''
      if (existsSync(soulPath)) {
        oldSoul = await readFile(soulPath, 'utf8')
      }

      let defaultRole: AgentRole = 'backend'
      let defaultDivision: AgentDivision = 'tech'
      if (name === 'contencreator' || name.includes('content')) {
        defaultRole = 'content'
        defaultDivision = 'content'
      } else if (name === 'seo') {
        defaultRole = 'seo'
        defaultDivision = 'growth'
      }

      const parsedMarker = parseSoulMarker(oldSoul)
      const role = parsedMarker.role || defaultRole
      const division = parsedMarker.division || defaultDivision
      const domains = parsedMarker.domains
      const baseSoul = soulFor(role as AgentRole, name, division as AgentDivision, domains)

      // Pisahkan bagian marker agar konteks disuntikkan sebelum marker
      const markerRe = /<!--\s*office:\s*role=.*?-->/i
      const markerMatch = markerRe.exec(baseSoul)
      const markerText = markerMatch
        ? markerMatch[0]
        : `<!-- office: role=${role} division=${division} -->`

      const contextSection = formatProjectContextPrompt(cfg, role, name)

      const enrichedSoul = [
        `# ${name} — ${role.toUpperCase()}`,
        ``,
        `Kamu adalah **${name}**, agen resmi di Zelvira Virtual Office.`,
        ``,
        contextSection,
        ``,
        `## 📋 CARA KERJA & INTEGRITAS:`,
        `- Eksekusi langsung: perintah → aksi nyata → hasil terukur.`,
        `- Setiap tugas wajib disertakan bukti nyata (output JSON, cuplikan kode, atau log aksi).`,
        `- Bahasa: Indonesia profesional, ringkas, dan jelas.`,
        ``,
        markerText,
      ].join('\n')

      await mkdir(dir, { recursive: true }).catch(() => {})
      await writeFile(soulPath, enrichedSoul, 'utf8')

      profilesUpdated.push(name)
      details[name] = `Berhasil disinkronkan dengan konteks proyek Zelvira (Role: ${role})`
    } catch (err) {
      details[name] = `Gagal sinkron: ${(err as Error).message}`
    }
  }

  return { profilesUpdated, details }
}

/** Uji koneksi dan integritas konfigurasi integrasi */
export async function testProjectIntegration(): Promise<{
  ecommerceFolderExists: boolean
  adminPortalReachable: boolean
  adminPortalStatus: string
  dbConfigValid: boolean
  dbSummary: string
  message: string
}> {
  const cfg = await getProjectContext(true)

  // 1. Cek folder ecommerce (pada environment lokal/server)
  const ecommerceFolderExists = existsSync(cfg.ecommercePath)

  // 2. Cek apakah admin.zelvira.my.id bisa dijangkau via HTTP
  let adminPortalReachable = false
  let adminPortalStatus = 'Belum diuji'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    const resp = await fetch(cfg.adminPortalUrl, {
      method: 'HEAD',
      signal: controller.signal,
    }).catch(async () => {
      // Coba GET jika HEAD ditolak
      return await fetch(cfg.adminPortalUrl, {
        method: 'GET',
        signal: controller.signal,
      })
    })
    clearTimeout(timeout)
    adminPortalReachable = resp.ok || resp.status < 500
    adminPortalStatus = `HTTP ${resp.status} ${resp.statusText || 'OK'}`
  } catch (e) {
    adminPortalStatus = `Gagal dihubungi: ${(e as Error).message}`
  }

  // 3. Cek DB config
  const dbConfigValid = !!(cfg.dbHost && cfg.dbPort && cfg.dbName && cfg.dbUser)
  const dbSummary = dbConfigValid
    ? `PostgreSQL ${cfg.dbUser}@${cfg.dbHost}:${cfg.dbPort}/${cfg.dbName} (${cfg.dbReadOnly ? 'Read-Only Safe' : 'Read-Write'})`
    : 'Konfigurasi DB belum lengkap'

  return {
    ecommerceFolderExists,
    adminPortalReachable,
    adminPortalStatus,
    dbConfigValid,
    dbSummary,
    message: 'Pengujian konfigurasi integrasi selesai',
  }
}
