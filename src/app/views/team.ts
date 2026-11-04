/**
 * Team views: the board of Tickets by column, the people who ask the agent for work, the agent's own profile, the team's
 * activity and its delivery figures. Every view is derived from stored Tickets, Triggers, Decisions and outbox receipts;
 * none adds state of its own.
 */
import { latestReport, liveTicket, ticketStage, type ActorRef, type ReportState, type Ticket, type TicketEndBy,
  type TicketOutcome } from '../../core/index.ts'
import { decisionView, newestFirst, snapshot, ticketLine, type ActorView, type Snapshot, type ViewHost } from './records.ts'
import { preview } from './text.ts'

const DAY = 86_400_000
/** The board's columns, in the order work moves through them; `person` holds every Ticket that waits for a person. */
export const BOARD_COLUMNS = ['queued', 'working', 'person', 'idle', 'done'] as const
export type BoardColumn = typeof BOARD_COLUMNS[number]
/** Reports a worker makes that the team can see as a step of the work; `progress` and `waiting` stay internal. */
const VISIBLE_REPORTS: readonly ReportState[] = ['ready', 'blocked', 'failed', 'dropped']

export function boardColumn(ticket: Ticket): BoardColumn {
  const stage = ticketStage(ticket)
  if (stage.stage === 'ended') return 'done'
  if (stage.stage === 'working') return stage.action === 'queued' ? 'queued' : 'working'
  return stage.stage
}
/** Identity of a requester across the views: their Source and their id on it, as the Policy's allowed lists name them. */
export const actorKey = (actor: ActorRef): string => `${actor.source}:${actor.id}`
/** A Ticket delivered its result: its pull request merged, or it completed without one. */
export const delivered = (outcome: TicketOutcome | undefined): boolean => outcome === 'merged' || outcome === 'completed'
const span = (from: string, to: string): number => Math.max(0, Date.parse(to) - Date.parse(from))
export function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = values.slice().sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}
const since = (days: number, now: number): string => new Date(now - days * DAY).toISOString()
/** A person's messages that reached the Ticket on its own Threads after it started: how often someone had to come back to it. */
const followups = (ticket: Ticket): number => ticket.inputs.filter(input => input.kind === 'trigger' && input.human && !input.context).length
const requester = (view: Snapshot, ticket: Ticket): ActorView & { key: string } =>
  ({ key: actorKey(ticket.mandate.actor), ...view.actor(ticket.mandate.actor, ticket.mandate.basis.via !== 'bot') })

function card(view: Snapshot, ticket: Ticket, sent: Record<string, number>) {
  const report = latestReport(ticket)
  return { ...ticketLine(view, ticket), column: boardColumn(ticket), requester: requester(view, ticket),
    report: report ? { state: report.state, at: report.at, preview: preview(report.summary.split('\n')[0] ?? '', 140) } : undefined,
    followups: followups(ticket), messages: sent[ticket.id] ?? 0, ...ticket.ended ? { leadMs: span(ticket.createdAt, ticket.ended.at) } : {} }
}
export type BoardCardView = ReturnType<typeof card>

/** The board: every open Ticket in the column of its stage, and the Tickets that ended in the last `days` under Done. */
export function board(host: ViewHost, days = 7, now = Date.now()) {
  const view = snapshot(host)
  const from = since(days, now)
  const sent = view.store.read.sentByTicket()
  const tickets = view.store.tickets.list().filter(ticket => liveTicket(ticket) || ticket.ended!.at >= from).sort(newestFirst)
  const cards = tickets.map(ticket => card(view, ticket, sent))
  const people = new Map(cards.map(item => [item.requester.key, item.requester]))
  return { days, columns: BOARD_COLUMNS.map(id => ({ id, cards: cards.filter(item => item.column === id) })), people: [...people.values()] }
}
export type BoardView = ReturnType<typeof board>

/** The steps every Ticket goes through, in order; a step is reached once its time is known. */
export const JOURNEY_STEPS = ['received', 'accepted', 'working', 'review', 'ended'] as const
export type JourneyStep = typeof JOURNEY_STEPS[number]
export type StepState = 'done' | 'current' | 'idle' | 'waiting' | 'problem' | 'todo'
/** Who a message of a Ticket's flow came from: a person on the Source, the agent's replies, the worker's reports, or the host. */
export type Lane = 'person' | 'agent' | 'worker' | 'host'
export interface FlowMessage { id: string; lane: Lane; at?: string; kind: string; text: string; actor?: ActorView; source?: string; pending?: true
  /** When its writer withdrew it; its text is gone. */
  retracted?: string }

/**
 * A Ticket's journey for people: each step with when it was reached and whether it is done, current, waiting for a person
 * or in trouble, and its message flow, the people's messages, the agent's replies, the worker's reports and the host's
 * notices in time order. Replies queued before receipts recorded their time follow the message the Ticket started from.
 */
export function journey(host: ViewHost, ticket: Ticket) {
  const view = snapshot(host)
  const { store } = view
  const origin = store.triggers.get(ticket.origin.triggerId)
  const decision = store.decisions.get(ticket.decisionId)
  const started = ticket.assignments.find(assignment => assignment.startedAt)?.startedAt
  const reports = ticket.assignments.flatMap(assignment => assignment.report ? [assignment.report] : [])
  const ready = reports.filter(report => report.state === 'ready').at(-1)
  const stage = ticketStage(ticket)
  const current: JourneyStep = ticket.ended ? 'ended' : stage.stage === 'person' && stage.action === 'review' ? 'review'
    : stage.stage === 'working' && stage.action === 'queued' ? 'accepted' : 'working'
  const trouble = stage.stage === 'person' && stage.action !== 'review'
  const at: Record<JourneyStep, string | undefined> = { received: origin?.at ?? ticket.createdAt, accepted: decision?.at ?? ticket.createdAt,
    working: started, review: ready?.at, ended: ticket.ended?.at }
  const index = JOURNEY_STEPS.indexOf(current)
  const steps = JOURNEY_STEPS.map((key, position): { key: JourneyStep; at?: string; state: StepState } => {
    const state: StepState = position < index || (ticket.ended && key === 'ended') ? 'done' : position > index ? 'todo'
      : trouble ? stage.action === 'failed' ? 'problem' : 'waiting' : key === 'review' ? 'waiting' : stage.stage === 'idle' ? 'idle' : 'current'
    return { key, state, ...at[key] && (state !== 'todo') ? { at: at[key] } : {} }
  })
  const messages: FlowMessage[] = []
  const withdrawn = (id: string) => { const at = store.triggers.disposition(id)?.retracted?.at; return at ? { retracted: at } : {} }
  if (origin) messages.push({ id: origin.id, lane: origin.human ? 'person' : 'host', at: origin.at, kind: 'origin', text: preview(origin.text, 600),
    actor: view.actor(origin.actor, origin.human), source: origin.source, ...withdrawn(origin.id) })
  for (const input of ticket.inputs) {
    if (input.kind === 'trigger') {
      const trigger = store.triggers.get(input.triggerId)
      if (!trigger || trigger.id === origin?.id) continue
      const revision = ticket.retraction?.revisedBy === trigger.id
      messages.push({ id: input.id, lane: trigger.human ? 'person' : 'host', at: input.at, kind: revision ? 'revision' : input.context ? 'context' : 'followup',
        text: preview(trigger.text, 600), actor: view.actor(trigger.actor, trigger.human), source: trigger.source, ...withdrawn(trigger.id) })
    } else if (input.kind === 'note' || input.kind === 'text') messages.push({ id: input.id, lane: 'host', at: input.at, kind: input.kind, text: preview(input.text, 600) })
    else if (input.kind === 'policy-changed') messages.push({ id: input.id, lane: 'host', at: input.at, kind: 'policy', text: '' })
    else if (input.kind === 'retracted' && !input.origin) messages.push({ id: input.id, lane: 'host', at: input.at, kind: 'retracted', text: '' })
  }
  for (const assignment of ticket.assignments) {
    for (const [index, report] of [...assignment.earlier ?? [], ...assignment.report ? [assignment.report] : []].entries())
      messages.push({ id: `${assignment.id}:report:${report.at}:${index}`, lane: 'worker', at: report.at, kind: report.state, text: preview(report.summary, 600) })
  }
  for (const receipt of store.read.ticketMessages(ticket.id)) {
    messages.push({ id: receipt.id, lane: 'agent', at: receipt.sentAt ?? receipt.queuedAt ?? origin?.at, kind: receipt.kind,
      text: preview(receipt.text, 600), source: receipt.channel.source, ...receipt.status === 'pending' ? { pending: true as const } : {} })
  }
  if (ticket.attention) messages.push({ id: ticket.attention.id, lane: 'worker', kind: 'question', text: preview(ticket.attention.question, 600),
    at: latestReport(ticket)?.at ?? ticket.updatedAt, pending: true })
  // The withdrawal of the request: waiting for a revision, revised, or settled as the grace ran out.
  if (ticket.retraction) messages.push({ id: `${ticket.id}:withdrawn`, lane: 'host', at: ticket.retraction.at, text: '',
    kind: ticket.retraction.revisedBy ? 'withdrawn.revised' : ticket.retraction.settled ? `withdrawn.${ticket.retraction.settled}` : 'withdrawn.grace',
    ...!ticket.retraction.revisedBy && !ticket.retraction.settled ? { pending: true as const } : {} })
  if (ticket.ended) messages.push({ id: `${ticket.id}:ended`, lane: 'host', at: ticket.ended.at, kind: `ended.${ticket.ended.outcome}`, text: '' })
  // A stable sort keeps the order messages were recorded in among those that share a time.
  messages.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
  return { steps, messages }
}
export type JourneyView = ReturnType<typeof journey>

/**
 * The engine map: how much passed each stage of the chain in the last `days`, and what is in each stage now. Sources receive
 * messages; the Source filters some; people's messages on a Ticket's Threads go straight to it (fan-out); the rest are
 * evaluated, accepted as Tickets or ignored; Tickets wait for a slot, run, wait for a person or deliver; and replies go back.
 */
export function engine(host: ViewHost, agent: AgentState, days = 1, now = Date.now()) {
  const { store, sources } = host
  const from = since(days, now)
  const stats = store.read.triggerStats(from)
  const counts = store.read.engineCounts(from)
  const received = Object.values(stats).reduce((sum, item) => sum + item.received, 0)
  const filtered = Object.values(stats).reduce((sum, item) => sum + item.filtered, 0)
  const listening = sources.instances().filter(instance => instance.enabled && instance.installed)
    .map(instance => ({ id: instance.id, title: sources.kind(instance.kind)?.title ?? { zh: instance.id, en: instance.id },
      received: stats[instance.id]?.received ?? 0 }))
  const threads = store.threads.active()
  const tickets = store.tickets.list()
  const open = tickets.filter(liveTicket)
  const column = (id: BoardColumn) => open.filter(ticket => boardColumn(ticket) === id).length
  const ended = tickets.filter(ticket => ticket.ended && ticket.ended.at >= from)
  const decided = (kind: string) => counts.decisions[kind] ?? 0
  return {
    days, sources: listening, received, filtered, passed: received - filtered, fanout: counts.fanout, retracted: counts.retracted,
    eval: { evaluating: threads.filter(thread => thread.evaluating).length, queued: threads.filter(thread => !thread.evaluating && thread.pending.length).length,
      judged: Object.values(counts.decisions).reduce((sum, value) => sum + value, 0), accepted: decided('accept') + decided('reopen'),
      ignored: decided('ignore'), wouldAccept: counts.wouldAccept, unavailable: decided('unavailable'), stopped: decided('stop') },
    tickets: { open: open.length, created: tickets.filter(ticket => ticket.createdAt >= from).length, queued: column('queued'),
      working: column('working'), person: column('person'), idle: column('idle') },
    executor: agent,
    ended: { delivered: ended.filter(ticket => delivered(ticket.ended!.outcome)).length, other: ended.filter(ticket => !delivered(ticket.ended!.outcome)).length },
    replies: counts.sent,
  }
}
export type EngineView = ReturnType<typeof engine>

/** The agent as the team sees it: who it acts as, how busy it is, and how its work went over the window. */
export interface AgentState { account: string; running: number; queued: number; maxWorkers: number; paused: boolean }

type Activity =
  | { kind: 'created'; at: string; ticket: { id: string; title: string }; actor: ActorView; strength: Ticket['mandate']['strength'] }
  | { kind: 'followup'; at: string; ticket: { id: string; title: string }; actor: ActorView; preview: string }
  | { kind: 'report'; at: string; ticket: { id: string; title: string }; state: ReportState; preview: string }
  | { kind: 'ended'; at: string; ticket: { id: string; title: string }; outcome: TicketOutcome; by: TicketEndBy }

function activities(view: Snapshot, ticket: Ticket, from: string): Activity[] {
  const ref = { id: ticket.id, title: ticket.title }
  const events: Activity[] = [{ kind: 'created', at: ticket.createdAt, ticket: ref, actor: requester(view, ticket),
    strength: ticket.mandate.strength }]
  for (const input of ticket.inputs) {
    if (input.kind !== 'trigger' || !input.human || input.context) continue
    const trigger = view.store.triggers.get(input.triggerId)
    if (trigger) events.push({ kind: 'followup', at: input.at, ticket: ref, actor: view.actor(trigger.actor, true), preview: preview(trigger.text, 120) })
  }
  for (const assignment of ticket.assignments) {
    const report = assignment.report
    if (report && VISIBLE_REPORTS.includes(report.state)) events.push({ kind: 'report', at: report.at, ticket: ref, state: report.state,
      preview: preview(report.summary.split('\n')[0] ?? '', 140) })
  }
  // A Ticket that completed or had nothing to do already said so in its last report; a merge, a close or a stop is news of its own.
  if (ticket.ended && !['completed', 'dropped'].includes(ticket.ended.outcome)) events.push({ kind: 'ended', at: ticket.ended.at, ticket: ref,
    outcome: ticket.ended.outcome, by: ticket.ended.by })
  return events.filter(event => event.at >= from)
}

/**
 * The team page: the people who asked for work with what is theirs, the agent's profile, the activity of the last `days`
 * newest first, and the window's figures: what was asked and delivered, how long delivery took, and how much attention it cost.
 */
export function team(host: ViewHost, agent: AgentState, days = 14, now = Date.now()) {
  const view = snapshot(host)
  const { store } = view
  const from = since(days, now)
  const sent = store.read.sentByTicket()
  const tickets = store.tickets.list()
  const recent = tickets.filter(ticket => ticket.createdAt >= from)
  const ended = tickets.filter(ticket => ticket.ended && ticket.ended.at >= from)
  const done = ended.filter(ticket => delivered(ticket.ended!.outcome))
  const members = new Map<string, { key: string; actor: ActorView; requested: number; open: number; waiting: number; delivered: number
    inferred: number; lastAt: string }>()
  for (const ticket of tickets) {
    const who = requester(view, ticket)
    const member = members.get(who.key) ?? { key: who.key, actor: who, requested: 0, open: 0, waiting: 0, delivered: 0, inferred: 0, lastAt: '' }
    member.requested++
    if (liveTicket(ticket)) member.open++
    if (ticketStage(ticket).stage === 'person') member.waiting++
    if (delivered(ticket.ended?.outcome)) member.delivered++
    if (ticket.mandate.strength === 'inferred') member.inferred++
    if (ticket.updatedAt > member.lastAt) member.lastAt = ticket.updatedAt
    members.set(who.key, member)
  }
  const outcomes = (outcome: TicketOutcome) => ended.filter(ticket => ticket.ended!.outcome === outcome).length
  const merged = outcomes('merged'), closed = outcomes('closed')
  const wouldAccept = store.read.decisionsOfKinds(['ignore'], 500).filter(decision => decision.at >= from)
    .filter(decision => decisionView(view, decision).outcome === 'wouldAccept').length
  const sources: Record<string, number> = {}
  for (const ticket of recent) {
    const source = store.triggers.get(ticket.origin.triggerId)?.source ?? ticket.mandate.actor.source
    sources[source] = (sources[source] ?? 0) + 1
  }
  const open = tickets.filter(liveTicket)
  return {
    days,
    agent: { ...agent, open: open.length, waiting: open.filter(ticket => ticketStage(ticket).stage === 'person').length,
      delivered: done.length, total: tickets.length },
    members: [...members.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
    activity: tickets.flatMap(ticket => activities(view, ticket, from)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40),
    insights: {
      created: recent.length, delivered: done.length, merged, closed, stopped: outcomes('stopped'), dropped: outcomes('dropped'),
      mergeRate: merged + closed ? merged / (merged + closed) : undefined,
      leadMs: median(done.map(ticket => span(ticket.createdAt, ticket.ended!.at))),
      // Delivered without anyone coming back to it: the share of results that took no follow-up from a person.
      firstPass: done.length ? done.filter(ticket => !followups(ticket)).length / done.length : undefined,
      messagesPerTicket: recent.length ? recent.reduce((sum, ticket) => sum + (sent[ticket.id] ?? 0), 0) / recent.length : undefined,
      proactive: recent.filter(ticket => ticket.mandate.strength === 'inferred').length, wouldAccept, sources,
      // Times only: the panel buckets them by the viewer's own days.
      series: { created: recent.map(ticket => ticket.createdAt), delivered: done.map(ticket => ticket.ended!.at) },
    },
  }
}
export type TeamView = ReturnType<typeof team>
