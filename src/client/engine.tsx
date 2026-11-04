/**
 * The engine map: the whole chain from a Source's message to the result back in its conversation, drawn as nodes and the
 * lines between them. A line is as thick as what passed it in the window and carries moving dots while it does; a node shows
 * what passed and what is in it now, explains itself on hover, and opens the page of its stage.
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { usePoll, type EngineView } from './api.ts'
import { Button, Icon, SegmentedControl, type IconName } from './controls.tsx'
import { useCountUp } from './motion.ts'
import { usePanel } from './provider.tsx'
import type { Route } from './route.ts'
import { localized } from './text.ts'
import { LoadState } from './widgets.tsx'

const W = 1000, H = 370
type NodeId = 'source' | 'trigger' | 'eval' | 'ticket' | 'executor' | 'delivered' | 'filtered' | 'ignored' | 'people'
type Tone = 'flow' | 'quiet' | 'person' | 'done'
const AT: Record<NodeId, { x: number; y: number }> = {
  source: { x: 75, y: 175 }, trigger: { x: 250, y: 175 }, eval: { x: 430, y: 175 }, ticket: { x: 610, y: 175 }, executor: { x: 790, y: 175 },
  delivered: { x: 935, y: 175 }, filtered: { x: 250, y: 300 }, ignored: { x: 430, y: 300 }, people: { x: 790, y: 48 },
}
/** Half a main node's height and width in the map's units, where lines meet it. */
const HALF = { w: 55, h: 36 }
interface Edge { id: string; d: string; tone: Tone; value: number; label?: string; labelAt?: { x: number; y: number }; dashed?: true }

const right = (id: NodeId) => AT[id].x + HALF.w, left = (id: NodeId) => AT[id].x - HALF.w
const straight = (from: NodeId, to: NodeId) => `M${right(from)},${AT[from].y} L${left(to)},${AT[to].y}`
const down = (from: NodeId, to: NodeId) => `M${AT[from].x},${AT[from].y + HALF.h} L${AT[to].x},${AT[to].y - 16}`

function edges(t: (key: 'engine.edge.fanout' | 'engine.edge.reply' | 'engine.edge.ask' | 'engine.edge.answer', values: Record<string, number>) => string,
  data: EngineView): Edge[] {
  const { eval: judged, tickets } = data
  return [
    { id: 'in', d: straight('source', 'trigger'), tone: 'flow', value: data.received },
    { id: 'filtered', d: down('trigger', 'filtered'), tone: 'quiet', value: data.filtered },
    { id: 'judge', d: straight('trigger', 'eval'), tone: 'flow', value: judged.judged },
    { id: 'ignored', d: down('eval', 'ignored'), tone: 'quiet', value: judged.ignored },
    { id: 'accept', d: straight('eval', 'ticket'), tone: 'flow', value: judged.accepted },
    // A person's message on a Ticket's Thread goes straight to the Ticket over Eval: the Subscription's fan-out.
    { id: 'fanout', d: `M${AT.trigger.x + 20},${AT.trigger.y - HALF.h} C${AT.trigger.x + 40},40 ${AT.ticket.x - 40},40 ${AT.ticket.x - 20},${AT.ticket.y - HALF.h}`,
      tone: 'flow', value: data.fanout, dashed: true, label: t('engine.edge.fanout', { count: data.fanout }), labelAt: { x: AT.eval.x, y: 54 } },
    { id: 'assign', d: straight('ticket', 'executor'), tone: 'flow', value: tickets.working + tickets.queued + tickets.person },
    { id: 'ask', d: `M${AT.executor.x - 14},${AT.executor.y - HALF.h} L${AT.people.x - 14},${AT.people.y + 18}`, tone: 'person', value: tickets.person,
      label: t('engine.edge.ask', { count: tickets.person }), labelAt: { x: AT.executor.x - 24, y: 112 } },
    { id: 'answer', d: `M${AT.people.x + 14},${AT.people.y + 18} L${AT.executor.x + 14},${AT.executor.y - HALF.h}`, tone: 'flow', value: data.fanout,
      dashed: true, label: t('engine.edge.answer', { count: data.fanout }), labelAt: { x: AT.executor.x + 24, y: 112 } },
    { id: 'deliver', d: straight('executor', 'delivered'), tone: 'done', value: data.ended.delivered },
    // The result goes back to the conversation the request came from.
    { id: 'reply', d: `M${AT.delivered.x},${AT.delivered.y + HALF.h} C${AT.delivered.x},${H - 10} ${AT.delivered.x - 60},${H - 18} ${AT.delivered.x - 120},${H - 18}
      L${AT.source.x + 120},${H - 18} C${AT.source.x + 60},${H - 18} ${AT.source.x},${H - 10} ${AT.source.x},${AT.source.y + HALF.h}`,
      tone: 'flow', value: data.replies, dashed: true, label: t('engine.edge.reply', { count: data.replies }), labelAt: { x: W / 2, y: H - 18 } },
  ]
}
const width = (value: number) => value ? 1.6 + Math.min(4, Math.log2(1 + value)) : 1.2
/** Dots along a busy line: one for a trickle, up to three for a stream. */
const dots = (value: number) => value ? Math.min(3, Math.ceil(Math.log2(value + 1))) : 0
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function Line({ edge }: { edge: Edge }) {
  const count = still() ? 0 : dots(edge.value), duration = 2.6
  return <g className="dt-edge" data-tone={edge.tone} data-idle={!edge.value || undefined}>
    <path id={`dt-edge-${edge.id}`} className="dt-edge-base" d={edge.d} style={{ strokeWidth: width(edge.value) } as CSSProperties} />
    {edge.value > 0 && <path className="dt-edge-flow" d={edge.d} data-dashed={edge.dashed || undefined}
      style={{ strokeWidth: Math.max(1.2, width(edge.value) - 1) } as CSSProperties} />}
    {Array.from({ length: count }, (_, index) => <circle key={index} className="dt-edge-dot" r={3}>
      <animateMotion dur={`${duration}s`} begin={`${index * duration / count}s`} repeatCount="indefinite"><mpath href={`#dt-edge-${edge.id}`} /></animateMotion>
    </circle>)}
  </g>
}

interface NodeSpec { id: NodeId; icon: IconName; value: number; caption: string; now?: string; active?: boolean; warn?: boolean; small?: boolean
  route: Route }
function Node({ spec, onHover }: { spec: NodeSpec; onHover: (id: NodeId | undefined) => void }) {
  const { t, navigate } = usePanel()
  const shown = useCountUp(spec.value)
  const style = { left: `${AT[spec.id].x / W * 100}%`, top: `${AT[spec.id].y / H * 100}%` } as CSSProperties
  return <button type="button" className="dt-node" data-node={spec.id} data-small={spec.small || undefined} data-active={spec.active || undefined}
    data-warn={spec.warn || undefined} style={style} onClick={() => navigate(spec.route)} onMouseEnter={() => onHover(spec.id)}
    onMouseLeave={() => onHover(undefined)} onFocus={() => onHover(spec.id)} onBlur={() => onHover(undefined)}
    aria-label={`${t(`engine.node.${spec.id}`)} ${spec.value} ${spec.caption}`} title={[spec.caption, spec.now].filter(Boolean).join(' · ')}>
    <span className="dt-node-head"><Icon name={spec.icon} size={spec.small ? 12 : 14} />{t(`engine.node.${spec.id}`)}</span>
    <span className="dt-node-value">{shown}</span>
    <span className="dt-node-caption">{spec.caption}</span>
    {spec.now && <span className="dt-node-now">{spec.now}</span>}
  </button>
}

const OPEN_KEY = 'dsh-superagent/engine-open'
/** Whether the map shows: as the person last left it, otherwise unfolded except on a phone, where its one line fits better. */
function remembered(): boolean {
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches
  try {
    const stored = localStorage.getItem(OPEN_KEY)
    return stored === null ? !narrow : stored !== 'false'
  } catch { return !narrow /* Remembering the fold is a convenience. */ }
}
/** The folded map: the main chain on one line, each stage with what passed it, so the board stays close to the top. */
function Strip({ data }: { data: EngineView }) {
  const { t } = usePanel()
  const stages: [NodeId, number][] = [['source', data.received], ['trigger', data.passed], ['eval', data.eval.judged], ['ticket', data.tickets.open],
    ['executor', data.executor.running], ['delivered', data.ended.delivered]]
  return <ol className="dt-strip">{stages.map(([id, value], index) => <li key={id} className="dt-strip-step" data-node={id}>
    {index > 0 && <span className="dt-strip-line" aria-hidden="true" />}
    <span className="dt-strip-name">{t(`engine.node.${id}`)}</span><b>{value}</b>
    {id === 'executor' && data.tickets.person > 0 && <span className="dt-strip-warn">{t('engine.strip.person', { count: data.tickets.person })}</span>}
  </li>)}</ol>
}

export function EngineMap() {
  const { t, call } = usePanel()
  const [days, setDays] = useState<1 | 7>(1)
  const [open, setOpen] = useState(remembered)
  const fold = () => { setOpen(!open); try { localStorage.setItem(OPEN_KEY, String(!open)) } catch { /* A convenience only. */ } }
  const [hover, setHover] = useState<NodeId>()
  const { data, error } = usePoll(() => call('GET engine', { query: { days } }), [days])
  const window = t(days === 1 ? 'engine.window.day' : 'engine.window.week')
  const head: ReactNode = <div className="dt-engine-head">
    <div className="dt-engine-title"><h3>{t('engine.title')}</h3><span className="dt-live"><span className="dt-live-dot" />{t('team.live')}</span></div>
    <div className="dt-engine-tools">
      {open && <SegmentedControl className="dt-engine-window" label={t('engine.title')} value={String(days)} onChange={value => setDays(value === '7' ? 7 : 1)}
        options={[{ value: '1', label: t('engine.window.day') }, { value: '7', label: t('engine.window.week') }]} />}
      <Button variant="ghost" size="sm" icon={<Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />} aria-expanded={open}
        onClick={fold}>{t(open ? 'engine.fold' : 'engine.unfold')}</Button>
    </div>
  </div>
  if (!data) return <section className="dt-engine">{head}<LoadState error={error} loading /></section>
  if (!open) return <section className="dt-engine" data-folded>{head}<Strip data={data} /></section>
  const { eval: judged, tickets, executor } = data
  const nodes: NodeSpec[] = [
    { id: 'source', icon: 'inbox', value: data.received, caption: t('engine.caption.received', { window }),
      now: data.sources.map(source => `${localized(t, source.title)} ${source.received}`).join(' · '), route: { page: 'source' } },
    { id: 'trigger', icon: 'message', value: data.passed, caption: t('engine.caption.passed'),
      now: data.retracted ? t('engine.now.retracted', { count: data.retracted }) : undefined, route: { page: 'trigger', query: { filter: 'recent' } } },
    { id: 'eval', icon: 'decision', value: judged.judged, caption: t('engine.caption.judged'), active: judged.evaluating > 0,
      now: judged.evaluating || judged.queued ? t('engine.now.evaluating', { count: judged.evaluating + judged.queued }) : undefined,
      route: { page: 'eval' } },
    { id: 'ticket', icon: 'board', value: tickets.open, caption: t('engine.caption.open'), now: t('engine.now.created', { count: tickets.created, window }),
      route: { page: 'execution' } },
    { id: 'executor', icon: 'running', value: executor.running, caption: t('engine.caption.running', { max: executor.maxWorkers }), active: executor.running > 0,
      now: tickets.queued ? t('team.queued', { count: tickets.queued }) : undefined, route: { page: 'execution', query: { filter: 'working' } } },
    { id: 'delivered', icon: 'check', value: data.ended.delivered, caption: t('engine.caption.delivered', { window }),
      now: data.ended.other ? t('engine.now.other', { count: data.ended.other }) : undefined, route: { page: 'execution', query: { filter: 'ended' } } },
    { id: 'filtered', icon: 'filter', value: data.filtered, caption: t('engine.caption.filtered'), small: true, route: { page: 'source' } },
    { id: 'ignored', icon: 'dismiss', value: judged.ignored, caption: judged.wouldAccept ? t('engine.caption.wouldAccept', { count: judged.wouldAccept })
      : t('engine.caption.ignored'), small: true, route: { page: 'eval', query: { filter: 'ignore' } } },
    { id: 'people', icon: 'users', value: tickets.person, caption: t('engine.caption.people'), small: true, warn: tickets.person > 0,
      route: { page: 'execution', query: { filter: 'person' } } },
  ]
  const lines = edges(t, data)
  return <section className="dt-engine">
    {head}
    <div className="dt-engine-scroll">
      <div className="dt-engine-map" data-hover={hover}>
        <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {lines.map(edge => <Line key={edge.id} edge={edge} />)}
          {lines.filter(edge => edge.label && edge.labelAt).map(edge => <text key={edge.id} className="dt-edge-label" data-tone={edge.tone}
            x={edge.labelAt!.x} y={edge.labelAt!.y + (edge.id === 'reply' ? -6 : 0)} textAnchor={edge.id === 'ask' ? 'end' : edge.id === 'answer' ? 'start'
              : 'middle'}>{edge.label}</text>)}
        </svg>
        {nodes.map(spec => <Node key={spec.id} spec={spec} onHover={setHover} />)}
      </div>
    </div>
    <p className="dt-engine-explain" aria-live="polite">
      <Icon name="question" size={13} /><span>{hover ? t(`engine.explain.${hover}`) : t('engine.explain.none')}</span>
    </p>
  </section>
}
