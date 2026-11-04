import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { Assignment, Ticket, Trigger } from '../src/core/index.ts'
import { Store } from '../src/app/store.ts'
import { board, engine, journey, median, team } from '../src/app/views/team.ts'
import type { ViewHost } from '../src/app/views/records.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { feishuKind } from '../src/sources/feishu.ts'

const NOW = Date.parse('2026-11-03T12:00:00Z')
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()
const AGENT = { account: 'agent-bot', running: 1, queued: 0, maxWorkers: 4, paused: false }

function host() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'team-')), 'db.sqlite'))
  store.saveSettings({ policy: { sources: { feishu: { allowed: [{ id: 'ou_a', name: '张伟' }, { id: 'ou_b', name: 'Li Na' }] } } } })
  const sources = new SourceRegistry(() => store.settings())
  sources.register(feishuKind)
  const view: ViewHost = { store, sources, links: () => ({ url: '', label: { zh: '', en: '' } }) }
  return { store, view }
}
const message = (id: string, actor: string, minutes: number, text = `message ${id}`): Trigger => ({ id, source: 'feishu', human: true,
  threads: [{ source: 'feishu', id: `oc_1:${id}` }], actor: { source: 'feishu', id: actor }, at: at(minutes), text, meta: {},
  channel: { source: 'feishu', thread: 'feishu:oc_1', address: { chatId: 'oc_1', messageId: id } } })
/** A Ticket asked for by `actor` `minutes` ago, at the stage its Assignment and end give it. */
function ticket(store: Store, id: string, actor: string, minutes: number, fields: Partial<Ticket> & { assignment?: Partial<Assignment> } = {}) {
  const origin = message(`m-${id}`, actor, minutes)
  store.triggers.save(origin)
  const { assignment, ...rest } = fields
  const value: Ticket = { id, title: `Ticket ${id}`, decisionId: `d-${id}`, channels: [origin.channel!], inputs: [], undelivered: [],
    mandate: { strength: 'explicit', policyVersion: 'v', actor: { source: 'feishu', id: actor }, scope: '', basis: { via: 'addressed', addressed: 'mention' } },
    assignments: [{ id: `${id}-a`, state: 'running', createdAt: at(minutes), startedAt: at(minutes - 1), ...assignment }],
    createdAt: at(minutes), updatedAt: at(minutes - 2), origin: { triggerId: origin.id, triggerIds: [origin.id] }, ...rest }
  store.tickets.save(value)
  return value
}
const sent = (store: Store, id: string, ticketId: string, text = 'ok') => {
  const reply = { id, channel: { source: 'feishu', thread: 'feishu:oc_1', address: { chatId: 'oc_1', messageId: 'm' } }, text,
    kind: 'reply' as const, ticketId }
  store.receipts.add(reply); store.receipts.settle(reply, 'sent')
}

it('lays the board out by stage, with Done holding only the window, and each card naming its requester and what it cost', () => {
  const { store, view } = host()
  ticket(store, 'queued', 'ou_a', 10, { assignment: { state: 'pending', startedAt: undefined } })
  ticket(store, 'working', 'ou_b', 20, { assignment: { report: { state: 'progress', summary: 'reading\nmore', at: at(15) } } })
  ticket(store, 'review', 'ou_a', 30, { assignment: { report: { state: 'ready', summary: 'PR is ready', at: at(25) } } })
  ticket(store, 'merged', 'ou_a', 120, { ended: { at: at(60), by: 'executor', outcome: 'merged' } })
  ticket(store, 'old', 'ou_b', 20 * 24 * 60, { ended: { at: at(19 * 24 * 60), by: 'executor', outcome: 'merged' } })
  sent(store, 'r1', 'review'); sent(store, 'r2', 'review')
  const view7 = board(view, 7, NOW)
  expect(view7.columns.map(column => [column.id, column.cards.map(card => card.id)]))
    .toEqual([['queued', ['queued']], ['working', ['working']], ['person', ['review']], ['idle', []], ['done', ['merged']]])
  const review = view7.columns[2]!.cards[0]!
  expect(review).toMatchObject({ requester: { key: 'feishu:ou_a', name: { zh: '张伟' } }, messages: 2, report: { state: 'ready', preview: 'PR is ready' } })
  expect(view7.columns[1]!.cards[0]!.report?.preview).toBe('reading')
  expect(view7.columns[4]!.cards[0]!.leadMs).toBe(60 * 60_000)
  expect(view7.people.map(person => person.key).sort()).toEqual(['feishu:ou_a', 'feishu:ou_b'])
})

it('sums up the team: who asked, what is theirs to do, the window\'s figures, and activity without a repeated ending', () => {
  const { store, view } = host()
  ticket(store, 'a', 'ou_a', 300, { ended: { at: at(240), by: 'executor', outcome: 'merged' } })
  const followed = ticket(store, 'b', 'ou_a', 200, { ended: { at: at(80), by: 'executor', outcome: 'completed' },
    assignment: { report: { state: 'ready', summary: 'done', at: at(80) } } })
  const reply = message('f-b', 'ou_a', 150, 'one more thing')
  store.triggers.save(reply)
  store.tickets.save({ ...followed, inputs: [{ id: 'i1', kind: 'trigger', triggerId: reply.id, at: reply.at, human: true }] })
  ticket(store, 'c', 'ou_b', 50, { ended: { at: at(30), by: 'executor', outcome: 'closed' } })
  ticket(store, 'd', 'ou_b', 20, { attention: { id: 'q', question: 'Which one?' } })
  sent(store, 'r1', 'd'); sent(store, 'r2', 'd'); sent(store, 'r3', 'a')
  const result = team(view, AGENT, 14, NOW)
  expect(result.agent).toMatchObject({ account: 'agent-bot', open: 1, waiting: 1, delivered: 2, total: 4 })
  expect(result.members.map(member => [member.key, member.requested, member.open, member.waiting, member.delivered]))
    .toEqual([['feishu:ou_b', 2, 1, 1, 0], ['feishu:ou_a', 2, 0, 0, 2]])
  expect(result.insights).toMatchObject({ created: 4, delivered: 2, merged: 1, closed: 1, mergeRate: 0.5, firstPass: 0.5,
    messagesPerTicket: 0.75, leadMs: median([60 * 60_000, 120 * 60_000]), sources: { feishu: 4 } })
  // The completed Ticket's ready report already told it; its end adds nothing, while the merge and the close are news.
  const kinds = result.activity.map(event => `${event.kind}:${event.ticket.id}`)
  expect(kinds).toContain('ended:a'); expect(kinds).toContain('ended:c'); expect(kinds).not.toContain('ended:b')
  expect(kinds).toContain('report:b'); expect(kinds).toContain('followup:b')
  expect(result.activity.map(event => event.at)).toEqual(result.activity.map(event => event.at).slice().sort().reverse())
})

it('walks a Ticket\'s journey step by step, and lays its messages out by lane in time order, earlier reports included', () => {
  const { store, view } = host()
  store.decisions.save({ id: 'd-t', evalId: 'e', threadKey: 'feishu:oc_1:m-t', triggerIds: ['m-t'], policyVersion: 'v', at: at(59), kind: 'accept',
    reason: [], strength: 'explicit', ticketId: 't' })
  const value = ticket(store, 't', 'ou_a', 60, { assignment: { report: { state: 'blocked', summary: 'needs a key', at: at(20) },
    earlier: [{ state: 'progress', summary: 'reproduced', at: at(40) }] } })
  sent(store, 'ack', 't', 'On it')
  const result = journey(view, value)
  expect(result.steps.map(step => [step.key, step.state])).toEqual([['received', 'done'], ['accepted', 'done'], ['working', 'waiting'],
    ['review', 'todo'], ['ended', 'todo']])
  expect(result.steps[0]!.at).toBe(at(60))
  expect(result.messages.filter(item => item.lane === 'worker').map(item => [item.kind, item.text]))
    .toEqual([['progress', 'reproduced'], ['blocked', 'needs a key']])
  expect(result.messages[0]).toMatchObject({ lane: 'person', kind: 'origin', actor: { name: { zh: '张伟' } } })
  expect(result.messages.find(item => item.lane === 'agent')).toMatchObject({ kind: 'reply', text: 'On it', source: 'feishu' })
  // A receipt records when it was queued and sent.
  expect(store.read.ticketMessages('t')[0]).toMatchObject({ status: 'sent', queuedAt: expect.any(String), sentAt: expect.any(String) })
  const ended = journey(view, { ...value, ended: { at: at(5), by: 'executor', outcome: 'merged' } })
  expect(ended.steps.every(step => step.key === 'review' || step.state === 'done')).toBe(true)
  expect(ended.messages.filter(item => item.lane === 'host')).toMatchObject([{ kind: 'ended.merged', at: at(5) }])
})

it('counts what passed each stage of the engine in the window, and what is in each stage now', () => {
  const { store, view } = host()
  const recent = message('m1', 'ou_a', 30), filtered = message('m2', 'ou_x', 20), follow = message('m3', 'ou_b', 10), old = message('m4', 'ou_a', 3 * 24 * 60)
  for (const item of [recent, filtered, follow, old]) store.triggers.save(item)
  store.triggers.saveDisposition(filtered.id, { filtered: { code: 'chat_not_allowed' }, fanout: [], at: filtered.at })
  store.triggers.saveDisposition(follow.id, { fanout: ['t1'], at: follow.at })
  const decision = (id: string, kind: 'accept' | 'ignore', minutes: number, audit?: Record<string, unknown>) => store.decisions.save({ id, evalId: id,
    threadKey: 'feishu:oc_1:m1', triggerIds: ['m1'], policyVersion: 'v', at: at(minutes), kind, reason: [], strength: 'explicit', ...audit ? { audit } : {} })
  decision('accepted', 'accept', 29); decision('chatter', 'ignore', 25); decision('observed', 'ignore', 24, { would_accept: true }); decision('older', 'ignore', 5000)
  ticket(store, 't1', 'ou_a', 29, { assignment: { report: { state: 'progress', summary: '', at: at(20) } } })
  ticket(store, 't2', 'ou_b', 60, { attention: { id: 'q', question: 'Which?' } })
  ticket(store, 't3', 'ou_b', 300, { ended: { at: at(100), by: 'executor', outcome: 'merged' } })
  sent(store, 'r1', 't3')
  // The messages and Decisions above are timed by the test's clock; the receipt by the Store's, which is now.
  const result = engine(view, AGENT, 1, NOW)
  expect(result).toMatchObject({ received: 3 + 3 /* the three tickets' own messages */, filtered: 1, fanout: 1,
    eval: { judged: 3, accepted: 1, ignored: 2, wouldAccept: 1 }, tickets: { open: 2, working: 1, person: 1 }, ended: { delivered: 1, other: 0 } })
  expect(result.received - result.filtered).toBe(result.passed)
  expect(result.sources).toMatchObject([{ id: 'feishu', title: { zh: '飞书' } }])
  expect(engine(view, AGENT, 7, NOW).eval.judged).toBe(4)
})
