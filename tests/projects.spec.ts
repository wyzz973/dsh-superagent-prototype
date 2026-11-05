// Projects: which project a request is for, ports, project memory, a ticket's checkout, and the main Session's Projects part.
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserError, type Trigger } from '../src/core/index.ts'
import { ProjectMemories, allocatePorts, boundProjects, changedWorkspace, resolveProject, ticketDirectory, ticketProject } from '../src/app/projects.ts'
import { policySection } from '../src/app/prompts.ts'
import { Store } from '../src/app/store.ts'
import { KV } from '../src/kv.ts'
import { ProjectSchema, SettingsSchema, type Project } from '../src/policy.ts'
import { WorkspaceFailed, prepareWorkspace, type WorkspaceRun } from '../src/executor/workspace.ts'

const project = (id: string, fields: Record<string, unknown> = {}): Project => ProjectSchema.parse({ id, name: id.toUpperCase(), ...fields })
const settings = (...projects: Project[]) => SettingsSchema.parse({ projects: { projects },
  policy: { sources: { feishu: { allowed: [{ id: 'ou_alice', name: 'Alice' }] } } } })
const on = (...threads: string[]): Pick<Trigger, 'threads'> => ({ threads: threads.map(key => {
  const [source = '', ...rest] = key.split(':'); return { source, id: rest.join(':') } }) })

describe('which project a request is for', () => {
  const web = project('web', { bindings: ['feishu:oc_team'] }), api = project('api', { bindings: ['github'] }), app = project('app')
  it('takes a project the main Session names only when there is one by that id', () => {
    expect(resolveProject(settings(web, api), on('feishu:oc_team:om_1'), 'api')).toBe('api')
    expect(() => resolveProject(settings(web, api), on('feishu:oc_team:om_1'), 'orders'))
      .toThrow(new UserError('unknownProject', { project: 'orders', projects: 'web, api' }))
  })
  it('falls back to the one project the request\'s thread is bound to, then to the only project, and otherwise asks for one', () => {
    expect(resolveProject(settings(web, api, app), on('feishu:oc_team:om_1'))).toBe('web')
    expect(resolveProject(settings(web, api, app), on('github:42'))).toBe('api')
    expect(resolveProject(settings(app), on('feishu:oc_other:om_1'))).toBe('app')
    expect(() => resolveProject(settings(web, api, app), on('feishu:oc_other:om_1'))).toThrow(new UserError('projectNeeded', { projects: 'web, api, app' }))
    const twice = project('mobile', { bindings: ['feishu:oc_team'] })
    expect(() => resolveProject(settings(web, twice, app), on('feishu:oc_team:om_1'))).toThrow(new UserError('projectNeeded', { projects: 'web, mobile' }))
    // Without projects, a request has none.
    expect(resolveProject(settings(), on('feishu:oc_team:om_1'), 'web')).toBeUndefined()
  })
  it('binds a thread key prefix only up to a separator, so a chat binds its own threads and no chat whose id it begins', () => {
    expect(boundProjects(settings(web), on('feishu:oc_team')).map(item => item.id)).toEqual(['web'])
    expect(boundProjects(settings(web), on('feishu:oc_teammates:om_1'))).toEqual([])
    expect(boundProjects(settings(project('any', { bindings: ['feishu:'] })), on('feishu:oc_x:om_1')).map(item => item.id)).toEqual(['any'])
  })
  it('puts a ticket of a project in a directory of the project', () => {
    expect(ticketDirectory(settings(), '/state', 'web', 'fix-a-1')).toBe('/state/work/web/fix-a-1')
    expect(ticketDirectory(settings(), '/state', undefined, 'fix-a-1')).toBe('/state/work/fix-a-1')
  })
})

describe('ports and workspace changes', () => {
  it('gives a ticket the lowest block of ports no other ticket holds', () => {
    expect(allocatePorts(['web', 'grpc'], [])).toEqual({ web: 20000, grpc: 20001 })
    expect(allocatePorts(['web'], [{ web: 20000 }, { web: 20020, grpc: 20021 }])).toEqual({ web: 20010 })
    expect(allocatePorts([], [{ web: 20000 }])).toEqual({})
  })
  it('adds a proposed change\'s entries once each, and its check replaces the current one', () => {
    const workspace = project('web', { workspace: { copy: ['.env.local'], bootstrap: ['pnpm install'], verify: 'pnpm test' } }).workspace
    expect(changedWorkspace(workspace, { copy: ['.env.local', '.env.sandbox'], verify: 'make check', ports: ['web'] }))
      .toEqual({ copy: ['.env.local', '.env.sandbox'], clone: [], bootstrap: ['pnpm install'], verify: 'make check', ports: ['web'] })
  })
})

describe('project memory', () => {
  let directory: string, store: Store
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-projects-'))
    store = new Store(join(directory, 'db.sqlite'))
    store.saveSettings(settings(project('api', { workspace: { copy: ['.env.local'] } }), project('web')))
    const said = (id: string, actor: string): Trigger => ({ id, source: 'feishu', threads: [{ source: 'feishu', id: 'oc_team:om_1' }],
      actor: { source: 'feishu', id: actor }, human: true, at: '2026-11-04T00:00:00Z', text: '后台指订单服务', meta: {} })
    store.triggers.save(said('t-alice', 'ou_alice')); store.triggers.save(said('t-guest', 'ou_guest'))
  })
  afterEach(() => { store.close() })
  const memories = (save = vi.fn(async (_block: string, value: unknown) => {
    store.saveSettings({ ...store.settings(), projects: value as ReturnType<Store['settings']>['projects'] })
    return { saved: true as const, revision: 1, policy_changed: false, restarting: false, context_delivery: 'injected' as const }
  })) => ({ save, memory: new ProjectMemories({ store, settings: { save }, now: () => '2026-11-04T01:00:00Z' }) })

  it('records a hint only from an allowed sender\'s message, once, and keeps it proposed until a person confirms it', () => {
    const { memory } = memories()
    expect(() => memory.hint('api', 'the backend is api', 't-guest')).toThrow(new UserError('hintNotAllowed'))
    expect(() => memory.hint('orders', 'the backend is api', 't-alice')).toThrow(expect.objectContaining({ code: 'unknownProject' }))
    const hint = memory.hint('api', '「后台」指订单服务', 't-alice')
    expect(memory.hint('api', '「后台」指订单服务', 't-alice').id).toBe(hint.id)
    expect(hint).toMatchObject({ state: 'proposed', kind: 'hint', from: { actor: { source: 'feishu', id: 'ou_alice' }, triggerId: 't-alice' } })
    expect(memory.hints('api')).toEqual([])
  })
  it('saves a confirmed workspace change to its project as the panel would, and a rejected one changes nothing', async () => {
    const { memory, save } = memories()
    const change = memory.workspace({ id: 'tk1', project: 'api' }, { copy: ['.env.sandbox'], verify: 'make check' }, 'the sandbox key lives there')
    const other = memory.workspace({ id: 'tk2', project: 'api' }, { bootstrap: ['pnpm install'] }, 'online install')
    expect(() => memory.workspace({ id: 'tk3' }, { copy: ['x'] }, 'no project')).toThrow(expect.objectContaining({ code: 'unknownProject' }))
    await memory.confirm(change.id)
    expect(save).toHaveBeenCalledWith('projects', expect.anything(), expect.any(Number), 'panel')
    expect(store.settings().projects.projects[0]!.workspace).toMatchObject({ copy: ['.env.local', '.env.sandbox'], verify: 'make check' })
    expect(memory.reject(other.id).state).toBe('rejected')
    expect(store.settings().projects.projects[0]!.workspace.bootstrap).toEqual([])
    await expect(memory.confirm(change.id)).rejects.toThrow(new UserError('memoryDecided'))
    expect(() => memory.reject('nope')).toThrow(new UserError('unknownMemory', { id: 'nope' }))
  })
  it('supersedes the hint a confirmed hint replaces, and the main Session reads only confirmed hints with their project', async () => {
    const { memory } = memories()
    const first = memory.hint('api', '「后台」指订单服务', 't-alice')
    await memory.confirm(first.id)
    const second = memory.hint('api', '「后台」现在指网关', 't-alice', first.id)
    expect(policySection(store.settings(), undefined, memory.list()).text).toContain('hint: 「后台」指订单服务')
    await memory.confirm(second.id)
    expect(memory.list().find(entry => entry.id === first.id)!.state).toBe('superseded')
    const text = policySection(store.settings(), undefined, memory.list()).text
    expect(text).toContain('## Projects')
    expect(text).toContain('- api: API')
    expect(text).toContain('hint: 「后台」现在指网关')
    expect(text).not.toContain('指订单服务')
    expect(policySection(settings()).text).not.toContain('## Projects')
  })
  it('shows a ticket\'s project, and its checkout while it is not ready', () => {
    store.set(KV.projects.workspace('tk1'), { state: 'failed', at: '2026-11-04T00:00:00Z', directory: '/w', step: 'verify', output: 'boom' })
    const ticket = { id: 'tk1', project: 'api', ended: undefined } as Parameters<typeof ticketProject>[1]
    expect(ticketProject(store, ticket)).toEqual({ project: { id: 'api', name: 'API' }, workspace: { state: 'failed', at: '2026-11-04T00:00:00Z', step: 'verify', output: 'boom' } })
    store.set(KV.projects.workspace('tk1'), { state: 'ready', at: '2026-11-04T00:00:00Z', directory: '/w' })
    expect(ticketProject(store, ticket)).toEqual({ project: { id: 'api', name: 'API' } })
    expect(ticketProject(store, { ...ticket, project: 'gone' })).toEqual({ project: { id: 'gone', name: 'gone', gone: true } })
  })
})

describe('a ticket\'s checkout', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workspace-'))
    await mkdir(join(root, 'checkout/node_modules/pkg'), { recursive: true })
    await writeFile(join(root, 'checkout/.env.local'), 'TOKEN=1')
    await writeFile(join(root, 'checkout/node_modules/pkg/index.js'), 'module.exports = 1')
  })
  /** Runs nothing but records each command; `git worktree add` makes the directory, and `fail` names a command that fails. */
  const runner = (fail?: string) => {
    const calls: { argv: string[]; cwd: string; env?: Record<string, string> }[] = []
    const run: WorkspaceRun = async (argv, cwd, env) => {
      calls.push({ argv, cwd, ...env ? { env } : {} })
      if (argv[0] === 'git' && argv[1] === 'worktree') await mkdir(argv[5]!, { recursive: true })
      if (argv[0] === 'git' && argv[1] === 'rev-parse' && argv.at(-1) === 'origin/HEAD^{commit}') throw new Error('no remote')
      if (argv[0] === 'cp') throw new Error('no clonefile here')
      if (fail && argv.join(' ').includes(fail)) throw new Error(`${fail}: REDIS_URL is not set`)
      return ''
    }
    return { calls, run }
  }
  const input = (fields: Record<string, unknown> = {}, run: WorkspaceRun) => ({ directory: join(root, 'work/fix-1'), name: 'fix-1', env: { DSH_SUPERAGENT_PORT_WEB: '20000' }, run,
    platform: 'darwin' as const, project: project('web', { checkout: join(root, 'checkout'),
      workspace: { copy: ['.env.local', 'missing.yml'], clone: ['node_modules'], bootstrap: ['pnpm install --offline'], verify: 'pnpm test:smoke' }, ...fields }) })

  it('makes a worktree from the checkout\'s current revision without a remote, copies what git ignores, clones dependencies and runs the steps', async () => {
    const { calls, run } = runner()
    const steps: string[] = []
    expect(await prepareWorkspace({ ...input({}, run), onStep: step => steps.push(step) })).toEqual({ base: 'HEAD' })
    expect(steps).toEqual(['worktree', 'copy', 'clone', 'bootstrap', 'verify'])
    // A stale worktree whose directory is gone is pruned first, so its branch can be made again.
    expect(calls.findIndex(call => call.argv.join(' ') === 'git worktree prune')).toBeLessThan(calls.findIndex(call => call.argv[2] === 'add'))
    expect(calls.find(call => call.argv[2] === 'add')).toMatchObject({ argv: ['git', 'worktree', 'add', '-B', 'superagent/fix-1', join(root, 'work/fix-1'), 'HEAD'],
      cwd: join(root, 'checkout') })
    expect(await readFile(join(root, 'work/fix-1/.env.local'), 'utf8')).toBe('TOKEN=1')
    // A clone falls back to a copy where the file system clones nothing.
    expect(calls.some(call => call.argv.join(' ') === `cp -cR ${join(root, 'checkout/node_modules')} ${join(root, 'work/fix-1/node_modules')}`)).toBe(true)
    expect(await readFile(join(root, 'work/fix-1/node_modules/pkg/index.js'), 'utf8')).toBe('module.exports = 1')
    expect(calls.filter(call => call.argv[0] === 'sh').map(call => [call.argv[2], call.cwd, call.env?.DSH_SUPERAGENT_PORT_WEB]))
      .toEqual([['pnpm install --offline', join(root, 'work/fix-1'), '20000'], ['pnpm test:smoke', join(root, 'work/fix-1'), '20000']])
  })
  it('keeps what the worktree has on a retry: no new worktree, no copy over a changed file, and the steps run again', async () => {
    const first = runner()
    await prepareWorkspace(input({ base: 'origin/main' }, first.run))
    await writeFile(join(root, 'work/fix-1/.env.local'), 'TOKEN=changed')
    const again = runner()
    expect(await prepareWorkspace(input({ base: 'origin/main' }, again.run))).toEqual({})
    expect(again.calls.some(call => call.argv[1] === 'worktree')).toBe(false)
    expect(await readFile(join(root, 'work/fix-1/.env.local'), 'utf8')).toBe('TOKEN=changed')
    expect(again.calls.filter(call => call.argv[0] === 'sh')).toHaveLength(2)
  })
  it('names the step that failed with what its command said', async () => {
    const { run } = runner('pnpm test:smoke')
    await expect(prepareWorkspace(input({}, run))).rejects.toEqual(new WorkspaceFailed('verify', 'pnpm test:smoke: REDIS_URL is not set'))
  })
  it('runs a project\'s own prepare command in place of the worktree, beside the ticket directory', async () => {
    const { calls, run } = runner()
    await mkdir(join(root, 'work'), { recursive: true })
    await prepareWorkspace(input({ prepare: 'git clone "$REPO" "$DSH_SUPERAGENT_DIR"', workspace: { copy: [], clone: [], bootstrap: [], verify: '', ports: [] } }, run))
    expect(calls.map(call => [call.argv.join(' '), call.cwd])).toEqual([['sh -c git clone "$REPO" "$DSH_SUPERAGENT_DIR"', join(root, 'work')]])
  })
})
