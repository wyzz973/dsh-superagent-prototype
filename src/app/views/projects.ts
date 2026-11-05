/**
 * The projects page: each project with its checkout, how its tickets' checkouts are made ready and how the latest ones went,
 * its open work by stage, and the project memory people confirm. Derived from settings, stored Tickets and workspace states.
 */
import { liveTicket } from '../../core/index.ts'
import { KV } from '../../kv.ts'
import { workspaceState, workspaceView, type ProjectMemory } from '../projects.ts'
import type { Store } from '../store.ts'
import { snapshot, type Snapshot, type ViewHost } from './records.ts'
import { boardColumn, delivered, type BoardColumn } from './team.ts'
import { preview } from './text.ts'

const DAY = 86_400_000
/** A binding by its Source and, where the Source knows it, the chat's name. */
function bindingView(store: Pick<Store, 'get'>, binding: string) {
  const [source = '', id = ''] = binding.split(':')
  const name = id ? store.get(KV.sources.labels(source))?.[id] : undefined
  return { key: binding, source, ...name ? { name } : {} }
}
function memoryView(view: Snapshot, entry: ProjectMemory) {
  const ticket = entry.from.ticketId ? view.store.tickets.get(entry.from.ticketId) : undefined
  const trigger = entry.from.triggerId ? view.store.triggers.get(entry.from.triggerId) : undefined
  return { ...entry, ...entry.from.actor ? { actor: view.actor(entry.from.actor, true) } : {},
    ...ticket ? { ticket: { id: ticket.id, title: ticket.title } } : {}, ...trigger ? { quote: preview(trigger.text, 200) } : {} }
}
export type MemoryView = ReturnType<typeof memoryView>

/** Every project with its work and checkouts, the memory that waits for a person first, and what the rest of it became. */
export function projectsView(host: ViewHost, now = Date.now()) {
  const view = snapshot(host)
  const { store } = view
  const settings = store.settings()
  const since = new Date(now - 7 * DAY).toISOString()
  const tickets = store.tickets.list()
  const memory = (store.get(KV.projects.memory) ?? []).map(entry => memoryView(view, entry))
  const projects = settings.projects.projects.map(project => {
    const own = tickets.filter(ticket => ticket.project === project.id)
    const open = own.filter(liveTicket)
    const at = (column: BoardColumn) => open.filter(ticket => boardColumn(ticket) === column).length
    const stages = { queued: at('queued'), working: at('working'), person: at('person'), idle: at('idle') }
    const checkouts = own.flatMap(ticket => {
      const state = workspaceState(store, ticket.id)
      return state ? [{ ticket: { id: ticket.id, title: ticket.title, open: liveTicket(ticket) }, ...workspaceView(state) }] : []
    }).sort((a, b) => b.at.localeCompare(a.at))
    return { ...project, bindings: project.bindings.map(binding => bindingView(store, binding)), open: open.length, stages,
      delivered: own.filter(ticket => ticket.ended && ticket.ended.at >= since && delivered(ticket.ended.outcome)).length,
      checkouts: checkouts.slice(0, 6), problems: checkouts.filter(item => item.ticket.open && item.state === 'failed').length,
      memory: { proposed: memory.filter(entry => entry.project === project.id && entry.state === 'proposed').length,
        hints: memory.filter(entry => entry.project === project.id && entry.kind === 'hint' && entry.state === 'confirmed') } }
  })
  const order: Record<ProjectMemory['state'], number> = { proposed: 0, confirmed: 1, rejected: 2, superseded: 3 }
  return { revision: store.blockRevision('projects'), projects,
    /** Open tickets of no project, such as those accepted before there were projects. */
    unassigned: tickets.filter(ticket => liveTicket(ticket) && !ticket.project).length,
    memory: memory.sort((a, b) => order[a.state] - order[b.state] || b.at.localeCompare(a.at)) }
}
export type ProjectsView = ReturnType<typeof projectsView>
export type ProjectView = ProjectsView['projects'][number]
