/**
 * Projects: which project a request is for, where its tickets' checkouts live and the ports they hold, how each checkout was
 * made ready, and the project memory people confirm: routing hints a person stated, and workspace changes a worker proposed.
 */
import { join } from 'node:path'
import { z } from 'zod'
import { UserError, key, liveTicket, threadKey, type ActorRef, type Ticket, type Trigger } from '../core/index.ts'
import { KV } from '../kv.ts'
import { WorkspaceSchema, allowedSender, type Project, type Settings as SettingsValue, type Workspace } from '../policy.ts'
import { executionRoot } from './execution-environment.ts'
import type { Settings } from './settings.ts'
import type { Store } from './store.ts'

type WithProjects = Pick<SettingsValue, 'projects'>
export const projectOf = (settings: WithProjects, id: string | undefined): Project | undefined =>
  id === undefined ? undefined : settings.projects.projects.find(project => project.id === id)

/** Whether a Thread key falls under a binding: the binding is the key itself, or a prefix of it up to a `:`. */
const under = (thread: string, binding: string): boolean =>
  thread === binding || thread.startsWith(binding.endsWith(':') ? binding : `${binding}:`)
/** The projects whose bindings one of a Trigger's Threads falls under, such as every project bound to its Feishu chat. */
export function boundProjects(settings: WithProjects, trigger: Pick<Trigger, 'threads'>): Project[] {
  const threads = trigger.threads.map(threadKey)
  return settings.projects.projects.filter(project => project.bindings.some(binding => threads.some(thread => under(thread, binding))))
}
/**
 * The project an accepted request works on, checked against the projects there are: the one the main Session names, which
 * must be one of them; else the one project the request's Threads are bound to; else the only project. Without projects a
 * request has none.
 * @throws UserError (`unknownProject`) for a name that is no project, or (`projectNeeded`) when nothing settles which.
 */
export function resolveProject(settings: WithProjects, trigger: Pick<Trigger, 'threads'> | undefined, requested?: string | null): string | undefined {
  const { projects } = settings.projects
  if (!projects.length) return undefined
  const ids = projects.map(project => project.id)
  if (requested) {
    if (!ids.includes(requested)) throw new UserError('unknownProject', { project: requested, projects: ids.join(', ') })
    return requested
  }
  const bound = trigger ? boundProjects(settings, trigger) : []
  if (bound.length === 1) return bound[0]!.id
  if (projects.length === 1) return projects[0]!.id
  throw new UserError('projectNeeded', { projects: (bound.length ? bound : projects).map(project => project.id).join(', ') })
}
/** A ticket's directory: `<root>/<project>/<name>` for a ticket of a project, `<root>/<name>` without one. */
export const ticketDirectory = (settings: SettingsValue, stateDir: string, project: string | undefined, name: string): string =>
  project ? join(executionRoot(settings, stateDir), project, name) : join(executionRoot(settings, stateDir), name)

/** The step of making a checkout ready: a project's own prepare command, or the git worktree, then copies, clones, bootstrap commands and the check. */
export type WorkspaceStep = 'prepare' | 'worktree' | 'copy' | 'clone' | 'bootstrap' | 'verify'
/** How a ticket's checkout was made ready: under way, ready, or failed at a step with its output; and the ports it holds. */
export interface WorkspaceState {
  state: 'preparing' | 'ready' | 'failed'
  at: string
  /** The directory it was made in; a ticket moved to another project is made ready again in its new one. */
  directory: string
  step?: WorkspaceStep
  output?: string
  ports?: Record<string, number>
  /** The revision the worktree was made from. */
  base?: string
}
export const workspaceState = (store: Pick<Store, 'get'>, ticketId: string): WorkspaceState | undefined => store.get(KV.projects.workspace(ticketId))
/** The first port tickets' ports start from, and how many ports each ticket's block holds (a project names at most that many). */
export const PORT_BASE = 20000, PORT_BLOCK = 10
/** Ports of their own for a ticket: the lowest block of `PORT_BLOCK` ports that no ticket in `taken` holds, one per name in order. */
export function allocatePorts(names: readonly string[], taken: Iterable<Record<string, number>>): Record<string, number> {
  const used = new Set([...taken].flatMap(ports => Object.values(ports).map(port => Math.floor((port - PORT_BASE) / PORT_BLOCK))))
  let block = 0
  while (used.has(block)) block++
  return Object.fromEntries(names.map((name, index) => [name, PORT_BASE + block * PORT_BLOCK + index]))
}

/** What a ticket's checkout went through, for people: where it is or failed, with the end of what the failing command said. */
export function workspaceView(state: WorkspaceState) {
  return { state: state.state, at: state.at, ...state.step ? { step: state.step } : {}, ...state.base ? { base: state.base } : {},
    ...state.ports ? { ports: state.ports } : {}, ...state.output ? { output: state.output.slice(-1500) } : {} }
}
export type WorkspaceView = ReturnType<typeof workspaceView>
/**
 * A ticket's project, by id and name, and while it is open, the state of its checkout unless it is ready: under way, or failed
 * at a step, which the board shows as an environment problem.
 */
export function ticketProject(store: Pick<Store, 'settings' | 'get'>, ticket: Ticket): { project?: { id: string; name: string; gone?: true }; workspace?: WorkspaceView } {
  if (!ticket.project) return {}
  const project = projectOf(store.settings(), ticket.project)
  const state = liveTicket(ticket) ? workspaceState(store, ticket.id) : undefined
  return { project: { id: ticket.project, name: project?.name ?? ticket.project, ...project ? {} : { gone: true as const } },
    ...state && state.state !== 'ready' ? { workspace: workspaceView(state) } : {} }
}
/** A change to a project's workspace a worker proposes: entries to add to its lists, and a check that replaces the current one. */
export const WorkspaceChangeSchema = z.object({
  copy: WorkspaceSchema.shape.copy.unwrap().optional(),
  clone: WorkspaceSchema.shape.clone.unwrap().optional(),
  bootstrap: WorkspaceSchema.shape.bootstrap.unwrap().optional(),
  verify: z.string().trim().min(1).max(1000).optional(),
  ports: WorkspaceSchema.shape.ports.unwrap().optional(),
}).strict().refine(change => Object.values(change).some(value => value !== undefined && (!Array.isArray(value) || value.length > 0)),
  'Propose at least one entry')
export type WorkspaceChange = z.infer<typeof WorkspaceChangeSchema>
const union = (current: readonly string[], added: readonly string[] = []): string[] => [...current, ...added.filter(item => !current.includes(item))]
/** A workspace with `change` applied: its entries added to the lists, and its check in place of the current one. */
export const changedWorkspace = (workspace: Workspace, change: WorkspaceChange): Workspace => WorkspaceSchema.parse({
  copy: union(workspace.copy, change.copy), clone: union(workspace.clone, change.clone), bootstrap: union(workspace.bootstrap, change.bootstrap),
  verify: change.verify ?? workspace.verify, ports: union(workspace.ports, change.ports) })

export type MemoryState = 'proposed' | 'confirmed' | 'rejected' | 'superseded'
/**
 * Something the team taught the agent about a project, which applies only once a person confirms it in the panel: a routing
 * hint an allowed sender stated, such as what a name means in their group, or a change to the project's workspace a worker
 * proposed after making its checkout work. A confirmed hint reaches the main Session with the project; memory never grants
 * authority. A later hint can replace an earlier one, which is kept as superseded.
 */
export interface ProjectMemory {
  id: string
  project: string
  kind: 'hint' | 'workspace'
  text: string
  change?: WorkspaceChange
  /** Who taught it: the person whose message stated a hint, or the ticket whose worker proposed a change. */
  from: { actor?: ActorRef; triggerId?: string; ticketId?: string }
  at: string
  state: MemoryState
  /** The earlier hint this one replaces once confirmed. */
  replaces?: string
  decidedAt?: string
}
/** How many memory entries are kept; beyond it the oldest rejected or superseded ones go first. */
const MEMORY_LIMIT = 300
/** Host dependencies used by `ProjectMemories`. */
export interface ProjectMemoriesHost {
  readonly store: Pick<Store, 'get' | 'set' | 'settings' | 'triggers' | 'tickets' | 'atomic' | 'blockRevision'>
  /** Saves a project's workspace when a person confirms a change to it. */
  readonly settings: Pick<Settings, 'save'>
  now?(): string
}
/**
 * Project memory: proposed by the main Session (hints, from an allowed sender's message) or a worker (workspace changes),
 * and confirmed or rejected by a person in the panel. A confirmed workspace change is saved to the project as the panel would.
 */
export class ProjectMemories {
  constructor(private readonly host: ProjectMemoriesHost) {}
  private now(): string { return this.host.now?.() ?? new Date().toISOString() }
  list(): ProjectMemory[] { return this.host.store.get(KV.projects.memory) ?? [] }
  /** The confirmed hints of `project`, oldest first, which reach the main Session with it. */
  hints(project: string): ProjectMemory[] { return this.list().filter(entry => entry.project === project && entry.kind === 'hint' && entry.state === 'confirmed') }
  private save(entries: ProjectMemory[]): void {
    const kept = entries.length <= MEMORY_LIMIT ? entries : (() => {
      const settled = entries.filter(entry => entry.state === 'rejected' || entry.state === 'superseded').map(entry => entry.id)
      const drop = new Set(settled.slice(0, entries.length - MEMORY_LIMIT))
      return entries.filter(entry => !drop.has(entry.id))
    })()
    this.host.store.set(KV.projects.memory, kept)
  }
  private propose(entry: Omit<ProjectMemory, 'id' | 'at' | 'state'>): ProjectMemory {
    if (!this.host.store.settings().projects.projects.some(project => project.id === entry.project)) {
      throw new UserError('unknownProject', { project: entry.project, projects: this.host.store.settings().projects.projects.map(project => project.id).join(', ') })
    }
    const entries = this.list()
    const same = entries.find(item => item.project === entry.project && item.kind === entry.kind && item.text === entry.text
      && JSON.stringify(item.change) === JSON.stringify(entry.change) && (item.state === 'proposed' || item.state === 'confirmed'))
    if (same) return same
    const at = this.now()
    const created: ProjectMemory = { ...entry, id: key('memory', entry.project, entry.kind, entry.text, at).slice(0, 16), at, state: 'proposed' }
    this.save([...entries, created])
    return created
  }
  /**
   * Records a routing hint that an allowed sender's message stated, such as which project a name in their group means, for a
   * person to confirm; `replaces` names an earlier hint it corrects.
   * @throws UserError when the project or the trigger is unknown, or the trigger is not an allowed sender's message.
   */
  hint(project: string, text: string, triggerId: string, replaces?: string): ProjectMemory {
    const trigger = this.host.store.triggers.get(triggerId)
    if (!trigger || !trigger.human || !allowedSender(this.host.store.settings(), trigger.actor)) throw new UserError('hintNotAllowed')
    if (replaces && !this.list().some(entry => entry.id === replaces && entry.project === project && entry.kind === 'hint')) {
      throw new UserError('unknownMemory', { id: replaces })
    }
    return this.propose({ project, kind: 'hint', text, from: { actor: trigger.actor, triggerId }, ...replaces ? { replaces } : {} })
  }
  /**
   * Records a change to the workspace of `ticket`'s project that its worker proposes, with why, for a person to confirm.
   * @throws UserError (`unknownProject`) when the ticket has no project, or its project is gone.
   */
  workspace(ticket: Pick<Ticket, 'id' | 'project'>, change: WorkspaceChange, reason: string): ProjectMemory {
    if (!ticket.project) throw new UserError('unknownProject', { project: '', projects: this.host.store.settings().projects.projects.map(project => project.id).join(', ') })
    return this.propose({ project: ticket.project, kind: 'workspace', text: reason, change: WorkspaceChangeSchema.parse(change), from: { ticketId: ticket.id } })
  }
  private pending(id: string): { entries: ProjectMemory[]; entry: ProjectMemory } {
    const entries = this.list()
    const entry = entries.find(item => item.id === id)
    if (!entry) throw new UserError('unknownMemory', { id })
    if (entry.state !== 'proposed') throw new UserError('memoryDecided')
    return { entries, entry }
  }
  /**
   * A person confirms a proposed entry: a workspace change is saved to its project, as the panel saves settings; a hint that
   * replaces an earlier one supersedes it.
   * @throws UserError when the entry is unknown or decided, or its project is gone; SettingsConflict when projects changed meanwhile.
   */
  async confirm(id: string): Promise<ProjectMemory> {
    const { entry } = this.pending(id)
    if (entry.kind === 'workspace' && entry.change) {
      const settings = this.host.store.settings()
      const project = settings.projects.projects.find(item => item.id === entry.project)
      if (!project) throw new UserError('unknownProject', { project: entry.project, projects: settings.projects.projects.map(item => item.id).join(', ') })
      const projects = settings.projects.projects.map(item => item.id === project.id ? { ...item, workspace: changedWorkspace(item.workspace, entry.change!) } : item)
      await this.host.settings.save('projects', { projects }, this.host.store.blockRevision('projects'), 'panel')
    }
    const { entries } = this.pending(id)
    const at = this.now()
    this.save(entries.map(item => item.id === id ? { ...item, state: 'confirmed', decidedAt: at }
      : item.id === entry.replaces && item.state === 'confirmed' ? { ...item, state: 'superseded', decidedAt: at } : item))
    return this.list().find(item => item.id === id)!
  }
  /**
   * A person rejects a proposed entry, which stays in the history.
   * @throws UserError when the entry is unknown or already decided.
   */
  reject(id: string): ProjectMemory {
    const { entries } = this.pending(id)
    const at = this.now()
    this.save(entries.map(item => item.id === id ? { ...item, state: 'rejected', decidedAt: at } : item))
    return this.list().find(item => item.id === id)!
  }
}

/** One line per project for the main Session: its id, name, description, other names, bindings and confirmed hints. */
export function projectLines(settings: WithProjects, hints: (project: string) => readonly ProjectMemory[]): string {
  const line = (text: string) => text.replace(/\s+/g, ' ').trim()
  return settings.projects.projects.map(project => {
    const parts = [`- ${project.id}: ${line(project.name)}`, project.description ? ` — ${line(project.description)}` : '',
      project.aliases.length ? `; also called ${project.aliases.map(line).join(', ')}` : '',
      project.bindings.length ? `; requests on ${project.bindings.join(', ')} are its own unless they name another` : '',
      ...hints(project.id).map(hint => `; hint: ${line(hint.text)}`)]
    return parts.join('')
  }).join('\n')
}
