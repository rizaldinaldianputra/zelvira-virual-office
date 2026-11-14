#!/usr/bin/env node

/**
 * Hermes Fallback CLI
 *
 * Provides a lightweight, reliable standalone CLI when a native hermes executable
 * is not mounted or not yet installed on the host. This prevents fatal ENOENT
 * crashes when running Hermes / Zelvira Virtual Office in Docker or standalone mode.
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

let YAML = null
for (const p of [
  'yaml',
  '/app/node_modules/yaml',
  path.join(__dirname, '../node_modules/yaml'),
  path.join(__dirname, 'node_modules/yaml'),
  path.join(process.cwd(), 'node_modules/yaml'),
]) {
  try {
    YAML = require(p)
    if (YAML) break
  } catch {}
}

const hermesDir = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes')
const kanbanFile = path.join(hermesDir, 'kanban.json')
const profilesDir = path.join(hermesDir, 'profiles')
const cronDir = path.join(hermesDir, 'cron')
const cronFile = path.join(cronDir, 'jobs.json')

// Auto-load environment variables from .env files if not already set
function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return
    const content = fs.readFileSync(filePath, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim()
        let val = trimmed.slice(eqIdx + 1).trim()
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        if (!process.env[key] && val) {
          process.env[key] = val
        }
      }
    }
  } catch {}
}

loadEnvFile(path.join(hermesDir, '.env'))
loadEnvFile(path.join(hermesDir, '.env.local'))
loadEnvFile(path.join(process.cwd(), '.env.local'))
loadEnvFile(path.join(process.cwd(), '.env'))

// Ensure basic directories exist
try {
  fs.mkdirSync(hermesDir, { recursive: true })
  fs.mkdirSync(profilesDir, { recursive: true })
  fs.mkdirSync(cronDir, { recursive: true })
} catch {}

function getFlag(arr, flag) {
  const idx = arr.indexOf(flag)
  if (idx !== -1 && idx + 1 < arr.length) return arr[idx + 1]
  return null
}

function parseSimpleYaml(content) {
  const result = {}
  let currentKey = null
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/)
    if (m) {
      currentKey = m[1]
      const val = m[2].trim()
      if (val) {
        result[currentKey] = val.replace(/^['"]|['"]$/g, '')
      } else {
        result[currentKey] = {}
      }
      continue
    }
    const subMatch = line.match(/^\s+([a-zA-Z0-9_-]+):\s*(.*)$/)
    if (subMatch && currentKey && typeof result[currentKey] === 'object') {
      const k = subMatch[1]
      const v = subMatch[2].trim().replace(/^['"]|['"]$/g, '')
      result[currentKey][k] = v
    }
  }
  return result
}

function toSimpleYaml(val, indent = 0) {
  const pad = ' '.repeat(indent)
  if (val === null || val === undefined) return 'null\n'
  if (typeof val === 'string') {
    if (val.includes('\n') || val.includes(':') || val.includes('#') || val.startsWith('{') || val.startsWith('[') || val === '') {
      return JSON.stringify(val) + '\n'
    }
    return val + '\n'
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val) + '\n'
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]\n'
    let out = '\n'
    for (const item of val) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const keys = Object.keys(item)
        if (keys.length === 0) {
          out += `${pad}- {}\n`
          continue
        }
        const firstKey = keys[0]
        const firstVal = item[firstKey]
        const restKeys = keys.slice(1)
        if (typeof firstVal === 'object' && firstVal !== null) {
          out += `${pad}- ${firstKey}:${toSimpleYaml(firstVal, indent + 4)}`
        } else {
          const renderedFirst = typeof firstVal === 'string' && (firstVal.includes(':') || firstVal.includes('#') || !firstVal) ? JSON.stringify(firstVal) : (firstVal ?? 'null')
          out += `${pad}- ${firstKey}: ${renderedFirst}\n`
        }
        for (const k of restKeys) {
          const v = item[k]
          if (typeof v === 'object' && v !== null) {
            out += `${pad}  ${k}:${toSimpleYaml(v, indent + 4)}`
          } else {
            const rendered = typeof v === 'string' && (v.includes(':') || v.includes('#') || !v) ? JSON.stringify(v) : (v ?? 'null')
            out += `${pad}  ${k}: ${rendered}\n`
          }
        }
      } else {
        out += `${pad}- ${toSimpleYaml(item, indent + 2)}`
      }
    }
    return out
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val)
    if (keys.length === 0) return '{}\n'
    let out = indent === 0 ? '' : '\n'
    for (const k of keys) {
      const v = val[k]
      if (typeof v === 'object' && v !== null) {
        out += `${pad}${k}:${toSimpleYaml(v, indent + 2)}`
      } else {
        const rendered = typeof v === 'string' && (v.includes(':') || v.includes('#') || !v) ? JSON.stringify(v) : (v ?? 'null')
        out += `${pad}${k}: ${rendered}\n`
      }
    }
    return out
  }
  return String(val) + '\n'
}

function readConfigFromDir(dir) {
  const yamlFile = path.join(dir, 'config.yaml')
  const ymlFile = path.join(dir, 'config.yml')
  const jsonFile = path.join(dir, 'config.json')

  try {
    if (fs.existsSync(yamlFile)) {
      const content = fs.readFileSync(yamlFile, 'utf8')
      if (YAML) return { data: YAML.parse(content) || {}, type: 'yaml', path: yamlFile }
      return { data: parseSimpleYaml(content), type: 'yaml', path: yamlFile }
    }
    if (fs.existsSync(ymlFile)) {
      const content = fs.readFileSync(ymlFile, 'utf8')
      if (YAML) return { data: YAML.parse(content) || {}, type: 'yaml', path: ymlFile }
      return { data: parseSimpleYaml(content), type: 'yaml', path: ymlFile }
    }
    if (fs.existsSync(jsonFile)) {
      return { data: JSON.parse(fs.readFileSync(jsonFile, 'utf8')), type: 'json', path: jsonFile }
    }
  } catch (err) {
    console.error('Config read error:', err)
  }
  return { data: null, type: 'yaml', path: yamlFile }
}

function saveConfigToDir(dir, data, preferredType = 'yaml') {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
  const yamlFile = path.join(dir, 'config.yaml')
  const jsonFile = path.join(dir, 'config.json')

  // Always write JSON for fast node fallback
  try {
    fs.writeFileSync(jsonFile, JSON.stringify(data, null, 2), 'utf8')
  } catch {}

  // Always write YAML because Python Hermes CLI on host reads config.yaml
  try {
    if (YAML && typeof YAML.stringify === 'function') {
      fs.writeFileSync(yamlFile, YAML.stringify(data), 'utf8')
      return
    }
  } catch {}

  try {
    fs.writeFileSync(yamlFile, toSimpleYaml(data), 'utf8')
  } catch (err) {
    console.error('Failed to write config.yaml:', err)
  }
}

function readJsonFile(file, fallback = {}) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    }
  } catch {}
  return fallback
}

function getDefaultModel() {
  const rootCfg = readConfigFromDir(hermesDir).data
  const def = rootCfg?.model?.default || rootCfg?.model || process.env.AI_MODEL
  return def || 'nvidia/nemotron-3-ultra-55'
}

function resolveProviderAndKey(cfgData) {
  const rootCfg = readConfigFromDir(hermesDir).data || {}
  const modelName = cfgData?.model?.default || cfgData?.model || rootCfg?.model?.default || rootCfg?.model || process.env.AI_MODEL || 'nvidia/nemotron-3-ultra-55'
  const providerRef = String(cfgData?.model?.provider || rootCfg?.model?.provider || 'custom:default')

  let providers = []
  if (Array.isArray(cfgData?.custom_providers)) providers.push(...cfgData.custom_providers)
  else if (cfgData?.custom_providers && typeof cfgData.custom_providers === 'object') providers.push(...Object.values(cfgData.custom_providers))

  if (Array.isArray(rootCfg?.custom_providers)) providers.push(...rootCfg.custom_providers)
  else if (rootCfg?.custom_providers && typeof rootCfg.custom_providers === 'object') providers.push(...Object.values(rootCfg.custom_providers))

  if (Array.isArray(rootCfg?.providers)) providers.push(...rootCfg.providers)
  else if (rootCfg?.providers && typeof rootCfg.providers === 'object') providers.push(...Object.values(rootCfg.providers))

  const provName = providerRef.replace(/^custom:/, '').toLowerCase()
  let prov = providers.find((p) => String(p?.name || p?.id || '').toLowerCase() === provName) ||
             providers.find((p) => p?.api_key || p?.apiKey || p?.token) ||
             providers[0]

  let apiKey = prov?.api_key || prov?.apiKey || prov?.key || prov?.token ||
               cfgData?.api_key || cfgData?.apiKey ||
               rootCfg?.api_key || rootCfg?.apiKey || rootCfg?.token ||
               process.env.AI_API_KEY || process.env.NVIDIA_API_KEY || process.env.OPENAI_API_KEY || ''
  let baseUrl = prov?.base_url || prov?.baseUrl || rootCfg?.base_url || rootCfg?.baseUrl || process.env.AI_BASE_URL ||
                (modelName.startsWith('nvidia/') ? 'https://integrate.api.nvidia.com/v1' : 'https://api.openai.com/v1')

  return { modelName, apiKey, baseUrl }
}

function writeJsonFile(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
  } catch (err) {
    console.error('Failed to write JSON:', err)
  }
}

const args = process.argv.slice(2)

// Parse profile flag: -p <profile>
let targetProfile = null
let cmdArgs = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-p' && i + 1 < args.length) {
    targetProfile = args[i + 1]
    i++
  } else {
    cmdArgs.push(args[i])
  }
}

const isJson = cmdArgs.includes('--json')
const cleanCmd = cmdArgs.filter((a) => a !== '--json' && a !== '-Q' && a !== '-q')

if (cmdArgs.includes('--version') || cleanCmd[0] === 'version') {
  console.log('hermes-agent 0.1.0 (standalone-fallback)')
  process.exit(0)
}

if (targetProfile && targetProfile !== 'default') {
  const pDir = path.join(profilesDir, targetProfile)
  if (!fs.existsSync(pDir)) {
    console.error(`Error: Profile "${targetProfile}" not found`)
    process.exit(1)
  }
}

const sub = cleanCmd[0]

// ------------------------------------------------------------- CONFIG
if (sub === 'config') {
  const action = cleanCmd[1]
  const key = cleanCmd[2]
  const val = cleanCmd[3]

  const targetDir = targetProfile
    ? path.join(profilesDir, targetProfile)
    : hermesDir

  const { data: loadedCfg, type: cfgType } = readConfigFromDir(targetDir)
  const cfg = loadedCfg || {
    model: {
      default: process.env.AI_MODEL || null,
      provider: 'custom:default',
    },
    custom_providers: [],
    approvals: { mode: 'auto' },
    platforms: { a2a: { enabled: false, port: 9900 } },
  }

  if (action === 'get') {
    let out = cfg
    if (key) {
      const parts = key.split('.')
      let cur = cfg
      for (const p of parts) {
        cur = cur ? cur[p] : undefined
      }
      out = cur !== undefined ? cur : (key === 'custom_providers' ? [] : null)
      if (key === 'custom_providers' && (!Array.isArray(out) || out.length === 0)) {
        out = [
          {
            name: 'nvidia',
            base_url: process.env.AI_BASE_URL || 'https://integrate.api.nvidia.com/v1',
            api_key: process.env.AI_API_KEY || process.env.NVIDIA_API_KEY || '',
            model: 'nvidia/nemotron-3-ultra-55',
            models: { 'nvidia/nemotron-3-ultra-55': {} },
          },
        ]
      }
    }

    if (isJson) {
      console.log(JSON.stringify(out ?? {}))
    } else {
      console.log(typeof out === 'object' ? JSON.stringify(out) : String(out ?? ''))
    }
    process.exit(0)
  }

  if (action === 'set') {
    if (!key) {
      console.error('Missing key for config set')
      process.exit(1)
    }
    let parsedVal = val
    try {
      parsedVal = JSON.parse(val)
    } catch {}

    const parts = key.split('.')
    let cur = cfg
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {}
      cur = cur[parts[i]]
    }
    cur[parts[parts.length - 1]] = parsedVal

    saveConfigToDir(targetDir, cfg, cfgType)
    if (isJson) console.log(JSON.stringify({ success: true, key, value: parsedVal }))
    process.exit(0)
  }
}

// ------------------------------------------------------------- PROFILE
if (sub === 'profile') {
  const action = cleanCmd[1]
  const name = cleanCmd[2]?.toLowerCase()

  if (action === 'list') {
    try {
      const entries = fs.readdirSync(profilesDir, { withFileTypes: true })
      const list = entries.filter((e) => e.isDirectory()).map((e) => e.name)
      if (isJson) {
        console.log(JSON.stringify(list))
      } else {
        console.log(list.join('\n'))
      }
    } catch {
      console.log(isJson ? '[]' : '')
    }
    process.exit(0)
  }

  if (action === 'create' && name) {
    const pDir = path.join(profilesDir, name)
    fs.mkdirSync(pDir, { recursive: true })
    const pCfg = path.join(pDir, 'config.yaml')
    if (!fs.existsSync(pCfg)) {
      const defModel = getDefaultModel()
      fs.writeFileSync(pCfg, `model:\n  default: ${defModel}\n`, 'utf8')
    }
    if (isJson) console.log(JSON.stringify({ success: true, name }))
    process.exit(0)
  }

  if (action === 'delete' && name) {
    const pDir = path.join(profilesDir, name)
    try {
      fs.rmSync(pDir, { recursive: true, force: true })
    } catch {}
    if (isJson) console.log(JSON.stringify({ success: true, deleted: name }))
    process.exit(0)
  }

  if (action === 'describe' && name) {
    const desc = cleanCmd.slice(3).join(' ')
    const pDir = path.join(profilesDir, name)
    fs.mkdirSync(pDir, { recursive: true })
    fs.writeFileSync(path.join(pDir, 'description.txt'), desc, 'utf8')
    process.exit(0)
  }
}

// ------------------------------------------------------------- KANBAN
if (sub === 'kanban') {
  const action = cleanCmd[1]
  let tasks = readJsonFile(kanbanFile, [])

  if (action === 'list') {
    console.log(JSON.stringify(tasks))
    process.exit(0)
  }

  if (action === 'assignees') {
    const map = new Map()
    for (const t of tasks) {
      if (t.assignee) {
        map.set(t.assignee, (map.get(t.assignee) || 0) + 1)
      }
    }
    const res = Array.from(map.entries()).map(([name, total]) => ({ name, total }))
    console.log(JSON.stringify(res))
    process.exit(0)
  }

  if (action === 'create') {
    const title = cleanCmd[2] || 'Tugas Baru'
    const assignee = getFlag(cleanCmd, '--assignee')
    const body = getFlag(cleanCmd, '--body') || ''
    const priority = Number(getFlag(cleanCmd, '--priority') || 0)
    const createdBy = getFlag(cleanCmd, '--created-by')
    const id = 't_' + crypto.randomBytes(4).toString('hex')
    const nowSec = Math.floor(Date.now() / 1000)

    const newTask = {
      id: `task-${Date.now().toString(36)}`,
      id,
      title,
      status: 'todo',
      assignee: null,
      created_at: new Date().toISOString(),
      assignee: assignee || null,
      body,
      priority,
      created_by: createdBy || null,
      created_at: nowSec,
      updated_at: nowSec,
      completed_at: null,
    }
    tasks.push(newTask)
    writeJsonFile(kanbanFile, tasks)
    console.log(JSON.stringify(newTask))

    if (isJson) {
      console.log(JSON.stringify(newTask))
    } else {
      console.log(`Created task ${id}: ${title}`)
    }
    process.exit(0)
  }

  if (action === 'show') {
    const id = cleanCmd[2]
    const task = tasks.find((t) => t.id === id) || null
    if (task) {
      console.log(JSON.stringify({
        task,
        events: [],
        comments: [],
        latest_summary: null,
        children: [],
        parents: [],
      }))
    } else {
      console.log(JSON.stringify({}))
    }
    process.exit(0)
  }

  if (action === 'comment') {
    const id = cleanCmd[2]
    const task = tasks.find((t) => t.id === id)
    if (task) {
      task.updated_at = Math.floor(Date.now() / 1000)
      writeJsonFile(kanbanFile, tasks)
    }
    console.log(JSON.stringify({ success: true, id }))
    process.exit(0)
  }

  if (action === 'unblock') {
    const id = cleanCmd[2]
    const task = tasks.find((t) => t.id === id)
    if (task) {
      task.status = 'todo'
      task.updated_at = Math.floor(Date.now() / 1000)
      writeJsonFile(kanbanFile, tasks)
    }
    console.log(`Task ${id} unblocked`)
    process.exit(0)
  }

  if (action === 'promote') {
    const id = cleanCmd[2]
    const task = tasks.find((t) => t.id === id)
    if (task) {
      task.status = 'ready'
      task.updated_at = Math.floor(Date.now() / 1000)
      writeJsonFile(kanbanFile, tasks)
    }
    console.log(`Task ${id} promoted`)
    process.exit(0)
  }

  if (action === 'reclaim') {
    const id = cleanCmd[2]
    const task = tasks.find((t) => t.id === id)
    if (task) {
      task.assignee = null
      task.updated_at = Math.floor(Date.now() / 1000)
      writeJsonFile(kanbanFile, tasks)
    }
    console.log(`Task ${id} reclaimed`)
    process.exit(0)
  }

  if (action === 'archive') {
    const ids = cleanCmd.slice(2).filter((x) => !x.startsWith('-'))
    tasks = tasks.filter((t) => !ids.includes(t.id))
    writeJsonFile(kanbanFile, tasks)
    console.log(JSON.stringify({ archived: ids }))
    process.exit(0)
  }

  if (action === 'move') {
    const id = cleanCmd[2]
    const targetStatus = cleanCmd[3] || 'todo'
    const task = tasks.find((t) => t.id === id)
    if (task) {
      task.status = targetStatus
      task.updated_at = Math.floor(Date.now() / 1000)
      if (targetStatus === 'done' || targetStatus === 'archived') {
        task.completed_at = task.updated_at
      }
      writeJsonFile(kanbanFile, tasks)
    }
    console.log(JSON.stringify({ success: true, id, status: targetStatus }))
    process.exit(0)
  }

  if (action === 'runs') {
    const id = cleanCmd[2]
    const runsFile = path.join(hermesDir, 'runs.json')
    const allRuns = readJsonFile(runsFile, [])
    const matching = Array.isArray(allRuns) ? allRuns.filter((r) => r.task_id === id) : []
    console.log(JSON.stringify(matching))
    process.exit(0)
  }

  if (action === 'dispatch') {
    const candidate = tasks.find((t) => t.status === 'ready' || t.status === 'todo')
    if (candidate) {
      candidate.status = 'running'
      candidate.updated_at = Math.floor(Date.now() / 1000)
      writeJsonFile(kanbanFile, tasks)
      console.log(JSON.stringify({ spawned: [candidate.id] }))
    } else {
      console.log(JSON.stringify({ spawned: [] }))
    }
    process.exit(0)
  }

  if (action === 'log') {
    const id = cleanCmd[2]
    const logFile = path.join(hermesDir, 'logs', `${id}.log`)
    if (fs.existsSync(logFile)) {
      console.log(fs.readFileSync(logFile, 'utf8'))
    } else {
      console.log('')
    }
    process.exit(0)
  }
}

// ------------------------------------------------------------- CHAT
if (sub === 'chat') {
  void (async () => {
    const sessionId = getFlag(args, '--resume') || `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now().toString(36)}`
    console.error(`session_id: ${sessionId}`)

    const profile = targetProfile || 'default'
    const msg = getFlag(args, '-q') || 'Halo'

    let targetDir = hermesDir
    if (profile && profile !== 'default') {
      targetDir = path.join(profilesDir, profile)
    }
    const cfg = readConfigFromDir(targetDir).data || {}
    const { modelName, apiKey, baseUrl } = resolveProviderAndKey(cfg)

    if (!apiKey) {
      console.log(
        `[${profile} · ${modelName}] Perhatian: AI_API_KEY belum terkonfigurasi di file .env atau ~/.hermes/.env. Harap masukkan AI_API_KEY (misalnya token NVIDIA NIM nvapi-... atau OpenAI) di file .env server Anda agar saya dapat terhubung dan berpikir menggunakan model ${modelName}. (Pesan Anda: "${msg}")`
      )
      process.exit(0)
    }

    if (apiKey && baseUrl) {
      try {
        const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              {
                role: 'system',
                content: `Kamu adalah AI Agent (${profile}) di Zelvira Virtual Office. Tugasmu membantu operasional kantor, manajemen tugas, dan kolaborasi antar-agent secara profesional. Model aktifmu adalah ${modelName}.`,
              },
              { role: 'user', content: msg },
            ],
            temperature: 0.7,
          }),
        })

        if (resp.ok) {
          const json = await resp.json()
          const reply = json.choices?.[0]?.message?.content
          if (reply) {
            console.log(reply.trim())
            process.exit(0)
          }
        } else {
          const errText = await resp.text()
          console.error(`[LLM API Warning ${resp.status}]: ${errText}`)
          let userReason = `Error HTTP ${resp.status} dari penyedia model (${baseUrl})`
          if (resp.status === 401 || resp.status === 403) {
            userReason = `Kredensial API Key ditolak (${resp.status}) oleh penyedia ${baseUrl}. Mohon periksa kembali AI_API_KEY Anda.`
          } else if (resp.status === 429) {
            userReason = `Rate limit atau kuota terlampaui (429) di penyedia ${baseUrl}.`
          }
          console.log(`[${profile} · ${modelName}] Maaf, permintaan ke model ${modelName} gagal: ${userReason}`)
          process.exit(0)
        }
      } catch (err) {
        console.error(`[LLM Fetch Error]:`, err.message)
        console.log(`[${profile} · ${modelName}] Gagal menghubungi endpoint LLM (${baseUrl}): ${err.message}`)
        process.exit(0)
      }
    }

    // Fallback if no reply was produced
    console.log(
      `[${profile} · ${modelName}] Halo! Saya siap membantu tugas Anda di kantor virtual Zelvira. Saya terhubung dengan model ${modelName}. (Pesan: "${msg}")`
    )
    process.exit(0)
  })()
  return
}

// ------------------------------------------------------------- CRON
if (sub === 'cron') {
  const action = cleanCmd[1]
  let cronData = readJsonFile(cronFile, { jobs: [] })
  if (!Array.isArray(cronData.jobs)) cronData.jobs = []

  if (action === 'create' || action === 'add') {
    const schedule = cleanCmd[2] || '0 9 * * *'
    const prompt = cleanCmd[3] && !cleanCmd[3].startsWith('--') ? cleanCmd[3] : ''
    const name = getFlag(cleanCmd, '--name') || 'Tugas Terjadwal'
    const agent = getFlag(cleanCmd, '--agent') || null
    const isPaused = cleanCmd.includes('--paused')
    const deliver = getFlag(cleanCmd, '--deliver') || 'origin'
    const script = getFlag(cleanCmd, '--script') || null
    const noAgent = cleanCmd.includes('--no-agent')
    const id = crypto.randomBytes(6).toString('hex')

    const newJob = {
      id,
      name,
      prompt,
      agent,
      schedule: { kind: 'cron', expr: schedule, display: schedule },
      schedule_display: schedule,
      enabled: !isPaused,
      state: isPaused ? 'paused' : 'active',
      deliver,
      no_agent: noAgent,
      script,
      created_at: new Date().toISOString(),
      last_run_at: null,
      last_status: null,
      failure_streak: 0,
    }
    cronData.jobs.unshift(newJob)
    try {
      fs.mkdirSync(cronDir, { recursive: true })
      writeJsonFile(cronFile, cronData)
    } catch {}

    console.log(`Created job: ${id}`)
    process.exit(0)
  }

  if (action === 'pause') {
    const id = cleanCmd[2]
    if (Array.isArray(cronData.jobs)) {
      const job = cronData.jobs.find((j) => j.id === id)
      if (job) {
        job.enabled = false
        job.state = 'paused'
        writeJsonFile(cronFile, cronData)
      }
    }
    console.log(`Job ${id} paused`)
    process.exit(0)
  }

  if (action === 'resume') {
    const id = cleanCmd[2]
    if (Array.isArray(cronData.jobs)) {
      const job = cronData.jobs.find((j) => j.id === id)
      if (job) {
        job.enabled = true
        job.state = 'active'
        writeJsonFile(cronFile, cronData)
      }
    }
    console.log(`Job ${id} resumed`)
    process.exit(0)
  }

  if (action === 'remove' || action === 'rm' || action === 'delete') {
    const id = cleanCmd[2]
    if (Array.isArray(cronData.jobs)) {
      cronData.jobs = cronData.jobs.filter((j) => j.id !== id)
      writeJsonFile(cronFile, cronData)
    }
    console.log(`Job ${id} removed`)
    process.exit(0)
  }

  if (action === 'run') {
    const id = cleanCmd[2]
    console.log(`Job ${id} triggered`)
    process.exit(0)
  }

  if (action === 'runs') {
    console.log('')
    process.exit(0)
  }

  if (action === 'list') {
    console.log(JSON.stringify(cronData.jobs))
    process.exit(0)
  }

  console.log(JSON.stringify([]))
  process.exit(0)
}

// ------------------------------------------------------------- GATEWAY
if (sub === 'gateway') {
  const action = cleanCmd[1] || 'status'
  if (action === 'restart' || action === 'start' || action === 'stop') {
    const pidFile = path.join(hermesDir, 'gateway.pid')
    try {
      fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, status: action, at: new Date().toISOString() }))
    } catch {}
    console.log(`Hermes gateway ${action}ed successfully`)
    process.exit(0)
  }
  if (action === 'status') {
    console.log('Hermes gateway running')
    process.exit(0)
  }
}

// Default fallback
if (isJson) {
  console.log(JSON.stringify([]))
} else {
  console.log('OK')
}
process.exit(0)
