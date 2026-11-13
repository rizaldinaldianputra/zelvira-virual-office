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

const hermesDir = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes')
const configFile = path.join(hermesDir, 'config.json')
const kanbanFile = path.join(hermesDir, 'kanban.json')
const profilesDir = path.join(hermesDir, 'profiles')

// Ensure basic directories exist
try {
  fs.mkdirSync(hermesDir, { recursive: true })
  fs.mkdirSync(profilesDir, { recursive: true })
} catch {}

function readJsonFile(file, fallback = {}) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    }
  } catch {}
  return fallback
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

  const cfgFile = targetProfile
    ? path.join(profilesDir, targetProfile, 'config.json')
    : configFile

  const cfg = readJsonFile(cfgFile, {
    model: {
      default: process.env.AI_MODEL || 'gpt-4o-mini',
      provider: 'custom:default',
    },
    custom_providers: [],
    approvals: { mode: 'auto' },
    platforms: { a2a: { enabled: false, port: 9900 } },
  })

  if (action === 'get') {
    let out = cfg
    if (key) {
      const parts = key.split('.')
      let cur = cfg
      for (const p of parts) {
        cur = cur ? cur[p] : undefined
      }
      out = cur !== undefined ? cur : (key === 'custom_providers' ? [] : null)
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

    writeJsonFile(cfgFile, cfg)
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
      fs.writeFileSync(pCfg, 'model:\n  default: gpt-4o-mini\n', 'utf8')
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
    const newTask = {
      id: `task-${Date.now().toString(36)}`,
      title,
      status: 'todo',
      assignee: null,
      created_at: new Date().toISOString(),
    }
    tasks.push(newTask)
    writeJsonFile(kanbanFile, tasks)
    console.log(JSON.stringify(newTask))
    process.exit(0)
  }
}

// ------------------------------------------------------------- CHAT
if (sub === 'chat') {
  const sessionId = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now().toString(36)}`
  console.error(`session_id: ${sessionId}`)
  console.log(`Halo! Saya siap membantu tugas Anda di kantor virtual.`)
  process.exit(0)
}

// ------------------------------------------------------------- CRON
if (sub === 'cron') {
  console.log(JSON.stringify([]))
  process.exit(0)
}

// Default fallback
if (isJson) {
  console.log(JSON.stringify([]))
} else {
  console.log('OK')
}
process.exit(0)
