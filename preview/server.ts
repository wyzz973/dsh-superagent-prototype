/**
 * Preview server: the panel on demo records, outside DeepSeek Harness. It answers the management API from a temporary
 * Store through the real views, serves the panel bundle with DSH's design tokens, and moves the demo work along every few
 * seconds (pass `--still` to keep it still). Pages the preview does not serve show the panel's own error.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store } from '../src/app/store.ts'
import { board, engine, journey, team } from '../src/app/views/team.ts'
import { overview } from '../src/app/views/overview.ts'
import { settingsView } from '../src/app/views/settings.ts'
import { sourcesStatus } from '../src/app/views/sources.ts'
import { decisionList, search, threadDetail, threadList } from '../src/app/views/threads.ts'
import { executorLoad, ticketDetail, ticketList } from '../src/app/views/tickets.ts'
import type { ViewHost } from '../src/app/views/records.ts'
import { policyHistory } from '../src/app/settings-history.ts'
import { SKILL_NAME, SKILL_PREFIX, TEAM_SECTIONS, builtInBase, builtInParts, defaultPrompts } from '../src/app/prompts.ts'
import { policyVersion } from '../src/policy.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { feishuKind } from '../src/sources/feishu.ts'
import { githubKind } from '../src/sources/github.ts'
import { seedDemo, simulate } from './demo.ts'

// The bundle runs from `preview/dist`; the page and the tokens are one level up.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT ?? 4173)
const store = new Store(join(mkdtempSync(join(tmpdir(), 'dsh-superagent-preview-')), 'preview.sqlite'))
seedDemo(store)
const sources = new SourceRegistry(() => store.settings())
sources.register(feishuKind); sources.register(githubKind)
const host: ViewHost = { store, sources, links: channel => ({ url: channel.source === 'github'
  ? `https://github.com/acme/widgets/issues/${channel.address.number ?? ''}` : '', label: { zh: '原消息', en: 'Original message' } }) }
const running = () => store.tickets.list().filter(ticket => ticket.assignments.at(-1)?.state === 'running' && !ticket.ended
  && ticket.assignments.at(-1)?.report?.state === 'progress').length
const load = () => executorLoad(store, running())
// Every Source part reports ready, as a healthy deployment would.
const health = Object.fromEntries([...feishuKind.health, ...githubKind.health].map(name => [name, { state: 'ready' as const, detail: '' }]))
const setup = {}
const blank = { revision: 0, previousRevision: null, savedAt: '', source: 'defaults' }
const prompts = () => ({ masterId: 'master', current: { ...blank, config: defaultPrompts() }, defaults: defaultPrompts(), sections: TEAM_SECTIONS,
  skillName: SKILL_NAME.source, builtin: ['feishu', 'github'], skillPrefix: SKILL_PREFIX, defaultChanged: [], sessions: [],
  notificationPending: false, parts: Object.entries(builtInParts()).map(([key, part]) => ({ key, ...part, base: builtInBase(part.text) })),
  revisions: [{ ...blank, changed: [] }], next_offset: null })
const models = { default: { provider: 'host', model: 'default' }, routableProviders: [], failures: [], groups: [{ id: 'deepseek',
  name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] }] }
const agent = () => { const now = load(); return { account: 'agent-bot', maxWorkers: 4, paused: false, ...now, running: Math.min(4, now.running) } }

const answer = (path: string, query: URLSearchParams): unknown => {
  const [head, id] = path.split('/') as [string, string | undefined]
  const offset = Number(query.get('offset') ?? 0), limit = Number(query.get('limit') ?? 20)
  switch (head) {
    case 'state': return { setup: { machine: { stateDir: '/srv/dsh-superagent', promptMaxChars: 100000, admissionContextMaxPages: 10,
      admissionContextTimeoutMs: 15000 }, problem: null, feishuProblem: null, accounts: { repository: 'acme/widgets', agent: 'agent-bot',
      feishu: { appId: 'cli_demo', brand: 'feishu', botId: 'ou_bot', name: 'Superagent' } } },
      load: { ...load(), maxWorkers: 4 }, masterId: 'master', paused: false, health: {} }
    case 'board': return board(host, Number(query.get('days') ?? 7))
    case 'team': return team(host, agent(), Number(query.get('days') ?? 14))
    case 'engine': return engine(host, agent(), Number(query.get('days') ?? 1))
    case 'overview': return overview(host, health, 'demo', load())
    case 'sources': return sourcesStatus(host, health, setup)
    case 'settings': return settingsView(store, sources, health, setup, '/srv/dsh-superagent')
    case 'search': return search(host, query.get('q') ?? '', { entries: () => new Map<string, string>().entries() })
    case 'policy': return id === 'history' ? policyHistory(store, sources, policyVersion(store.settings())) : undefined
    case 'models': return models
    case 'prompts': return prompts()
    case 'tickets': {
      if (!id) return ticketList(host, (query.get('state') ?? 'open') as 'open', offset, limit)
      const ticket = store.tickets.get(id), detail = ticketDetail(host, id)
      return ticket && detail ? { ...detail, journey: journey(host, ticket), environment: [] } : undefined
    }
    case 'threads': return id ? threadDetail(host, decodeURIComponent(id), undefined, 50) : threadList(host,
      (query.get('filter') ?? 'subscribed') as 'subscribed', offset, limit)
    case 'decisions': return decisionList(host, (query.get('kind') ?? '').split(',').filter(Boolean), offset, Number(query.get('limit') ?? 30), '')
    default: return undefined
  }
}
const send = (res: ServerResponse, status: number, type: string, body: string | Buffer) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body)
}
createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/orchestrator/api/')) {
    try {
      const value = req.method === 'GET' ? answer(url.pathname.slice('/orchestrator/api/'.length), url.searchParams) : undefined
      if (value === undefined) send(res, 404, 'application/json', JSON.stringify({ error: '预览模式不提供这一项 · Not available in the preview' }))
      else send(res, 200, 'application/json', JSON.stringify(value))
    } catch (error) { send(res, 500, 'application/json', JSON.stringify({ error: String(error) })) }
    return
  }
  const files: Record<string, [string, string]> = { '/': ['index.html', 'text/html; charset=utf-8'], '/main.js': ['dist/main.iife.js', 'text/javascript'],
    '/vendor/design-platform.css': ['vendor/design-platform.css', 'text/css'], '/vendor/base.css': ['vendor/base.css', 'text/css'],
    '/vendor/gradient-shadow-text.css': ['vendor/gradient-shadow-text.css', 'text/css'] }
  const file = files[url.pathname]
  if (!file) { send(res, 404, 'text/plain', 'Not found'); return }
  send(res, 200, file[1], readFileSync(join(root, file[0])))
}).listen(port, '127.0.0.1', () => { console.log(`dsh-superagent preview: http://127.0.0.1:${port}/`) })

if (!process.argv.includes('--still')) {
  let step = 0
  setInterval(() => { simulate(store, step++) }, Number(process.env.STEP_MS ?? 6000))
}
