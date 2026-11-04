/** A Ticket's journey on its page: the steps it went through as a stepper, and its messages as a flow between the lanes. */
import { useState, type CSSProperties } from 'react'
import type { TicketPageView } from './api.ts'
import { Icon, SegmentedControl, Tag, type IconName, type TagTone } from './controls.tsx'
import { useArrivals } from './motion.ts'
import { usePanel } from './provider.tsx'
import { AgentAvatar, Avatar } from './team-kit.tsx'
import { readableMarkers, valueLabel, type T } from './text.ts'
import { Section, When } from './widgets.tsx'

type Journey = TicketPageView['journey']
type Step = Journey['steps'][number]
type Message = Journey['messages'][number]

const STEP_ICONS: Record<Step['key'], IconName> = { received: 'message', accepted: 'decision', working: 'running', review: 'review', ended: 'stop' }
function stepIcon(step: Step): IconName {
  if (step.state === 'done') return 'check'
  if (step.state === 'problem') return 'alert'
  if (step.state === 'waiting') return step.key === 'review' ? 'review' : 'ask'
  if (step.state === 'idle') return 'clock'
  return STEP_ICONS[step.key]
}

export function JourneySteps({ journey, outcome }: { journey: Journey; outcome: string | undefined }) {
  const { t } = usePanel()
  const reached = journey.steps.filter(step => step.state !== 'todo').length
  return <ol className="dt-journey" aria-label={t('journey.title')} style={{ '--dt-reached': reached } as CSSProperties}>
    {journey.steps.map((step, index) => <li key={step.key} className="dt-journey-step" data-state={step.state}
      data-next={journey.steps[index + 1]?.state}>
      <span className="dt-journey-node"><Icon name={stepIcon(step)} size={13} /></span>
      <span className="dt-journey-label">{step.key === 'ended' && outcome ? outcome : t(`journey.step.${step.key}`)}</span>
      <span className="dt-journey-time">{step.at ? <When at={step.at} /> : step.state === 'waiting' ? t('journey.state.waiting')
        : step.state === 'problem' ? t('journey.state.problem') : ' '}</span>
    </li>)}
  </ol>
}

const REPORT_TONES: Partial<Record<string, TagTone>> = { ready: 'success', blocked: 'warning', failed: 'danger', dropped: 'neutral',
  progress: 'info', waiting: 'neutral', question: 'warning' }
function hostText(t: T, message: Message): string {
  if (message.kind.startsWith('ended.')) return t('team.event.ended', { outcome: valueLabel(t, 'outcome', message.kind.slice('ended.'.length)) })
  if (message.kind.startsWith('withdrawn.')) return t(`flow.kind.${message.kind as 'withdrawn.grace'}`)
  return message.text ? `${t(`flow.kind.${message.kind as 'note'}`)} · ${readableMarkers(t, message.text)}` : t(`flow.kind.${message.kind as 'policy'}`)
}

function Bubble({ message, fresh, index }: { message: Message; fresh: boolean; index: number }) {
  const { t } = usePanel()
  const style = { '--dt-i': Math.min(index, 10) } as CSSProperties
  if (message.lane === 'host') return <li className="dt-flow-host" data-new={fresh || undefined} data-pending={message.pending || undefined}
    style={style}>
    <span>{hostText(t, message)}</span>{message.at && <When at={message.at} />}
  </li>
  const right = message.lane !== 'person'
  const label = message.lane === 'person' ? `${message.actor?.name ? (t('lang') === 'en' ? message.actor.name.en : message.actor.name.zh) : ''}`
    : message.lane === 'agent' ? t('flow.agent') : t('flow.worker')
  return <li className="dt-flow-item" data-lane={message.lane} data-new={fresh || undefined} data-pending={message.pending || undefined}
    data-retracted={message.retracted ? '' : undefined} style={style}>
    <span className="dt-flow-avatar">{message.lane === 'person' ? <Avatar actor={message.actor} id={`${message.actor?.source}:${message.actor?.id}`} t={t} />
      : <AgentAvatar />}</span>
    <div className="dt-flow-body">
      <div className="dt-flow-meta">
        <span className="dt-flow-who">{label}</span>
        {message.lane === 'person' && <span>{t(`flow.kind.${message.kind as 'origin'}`)}</span>}
        {message.lane === 'agent' && <span>{t(`flow.kind.${message.kind as 'reply'}`)}{message.source && ` · ${t('flow.agentTo',
          { source: valueLabel(t, 'source', message.source) })}`}</span>}
        {message.lane === 'worker' && <Tag tone={REPORT_TONES[message.kind] ?? 'neutral'}>{message.kind === 'question' ? t('flow.question')
          : valueLabel(t, 'report', message.kind)}</Tag>}
        {message.pending && <span className="dt-flow-pending">{t(message.kind === 'question' ? 'flow.awaiting' : 'flow.pending')}<span
          className="dt-typing"><i /><i /><i /></span></span>}
        {message.at && <span className="dt-flow-time"><When at={message.at} /></span>}
      </div>
      {message.retracted ? <p className="dt-flow-text dt-retracted">{t('flow.retracted')}</p>
        : message.text && <p className="dt-flow-text">{readableMarkers(t, message.text)}</p>}
    </div>
    {right && <span className="dt-flow-spacer" />}
  </li>
}

/** The lanes of the message flow, left to right: people, the agent's replies, the worker's reports and the host's notices. */
const LANES = ['person', 'agent', 'worker', 'host'] as const
const ROW = 52, LANE = 50, PAD = 22
const laneX = (lane: Message['lane']) => PAD + LANES.indexOf(lane) * LANE
function who(t: T, message: Message): string {
  if (message.lane === 'person') return message.actor?.name ? t('lang') === 'en' ? message.actor.name.en : message.actor.name.zh : t('flow.lane.person')
  return t(`flow.lane.${message.lane}`)
}
function kind(t: T, message: Message): string {
  if (message.lane === 'worker') return message.kind === 'question' ? t('flow.question') : valueLabel(t, 'report', message.kind)
  if (message.lane === 'host') return hostText(t, message)
  return t(`flow.kind.${message.kind as 'origin'}`) + (message.lane === 'agent' && message.source ? ` · ${t('flow.agentTo',
    { source: valueLabel(t, 'source', message.source) })}` : '')
}
/**
 * The message flow as a lane graph: one rail per lane, each message a dot on its lane, and a line from each message to the
 * next, so a hand-off from a person to the agent, to its worker and back reads as the line crossing the rails.
 */
function LaneGraph({ messages, fresh }: { messages: Message[]; fresh: Set<string> }) {
  const { t } = usePanel()
  const width = PAD * 2 + LANE * (LANES.length - 1)
  return <div className="dt-lanes">
    <div className="dt-lanes-head" style={{ width }}>
      {LANES.map(lane => <span key={lane} className="dt-lanes-name" data-lane={lane} style={{ left: laneX(lane) }}>{t(`flow.lane.${lane}`)}</span>)}
    </div>
    <ol className="dt-lanes-list">{messages.map((message, index) => {
      const x = laneX(message.lane), previous = messages[index - 1], last = index === messages.length - 1
      const from = previous ? laneX(previous.lane) : undefined
      return <li key={message.id} className="dt-lane-row" data-lane={message.lane} data-new={fresh.has(message.id) || undefined}
        data-pending={message.pending || undefined} data-retracted={message.retracted ? '' : undefined}
        style={{ '--dt-i': Math.min(index, 12) } as CSSProperties}>
        <svg className="dt-lane-svg" width={width} height={ROW} viewBox={`0 0 ${width} ${ROW}`} aria-hidden="true">
          {LANES.map(lane => <line key={lane} className="dt-lane-rail" x1={laneX(lane)} x2={laneX(lane)} y1={0} y2={ROW} />)}
          {from !== undefined && <path className="dt-lane-link" data-lane={message.lane} data-latest={last || undefined}
            d={`M${from},0 C${from},${ROW / 4} ${x},${ROW / 4} ${x},${ROW / 2}`} />}
          {!last && <line className="dt-lane-stem" data-lane={message.lane} x1={x} x2={x} y1={ROW / 2} y2={ROW} />}
          <circle className="dt-lane-dot" data-lane={message.lane} cx={x} cy={ROW / 2} r={5} />
        </svg>
        <div className="dt-lane-text">
          <div className="dt-flow-meta"><span className="dt-flow-who">{who(t, message)}</span><span className="dt-lane-kind">{kind(t, message)}</span>
            {message.pending && <span className="dt-flow-pending">{t(message.kind === 'question' ? 'flow.awaiting'
              : message.kind === 'withdrawn.grace' ? 'flow.revisable' : 'flow.pending')}</span>}
            {message.at && <span className="dt-flow-time"><When at={message.at} /></span>}</div>
          {message.retracted ? <p className="dt-lane-line dt-retracted">{t('flow.retracted')}</p>
            : message.text && message.lane !== 'host' && <p className="dt-lane-line" title={message.text}>{readableMarkers(t, message.text)}</p>}
        </div>
      </li>
    })}</ol>
  </div>
}

export function MessageFlow({ journey }: { journey: Journey }) {
  const { t } = usePanel()
  const [view, setView] = useState<'lanes' | 'chat'>('lanes')
  const fresh = useArrivals(journey.messages.map(message => message.id))
  const toggle = <SegmentedControl className="dt-flow-view" label={t('flow.title')} value={view} onChange={setView}
    options={[{ value: 'lanes', label: t('flow.view.lanes') }, { value: 'chat', label: t('flow.view.chat') }]} />
  return <Section icon="message" title={t('flow.title')} count={journey.messages.length} hint={t('flow.hint')} action={journey.messages.length ? toggle : undefined}>
    {!journey.messages.length ? <p className="dt-hint">{t('flow.empty')}</p> : view === 'lanes' ? <LaneGraph messages={journey.messages} fresh={fresh} />
      : <ol className="dt-messages">{journey.messages.map((message, index) => <Bubble key={message.id} message={message}
        fresh={fresh.has(message.id)} index={index} />)}</ol>}
  </Section>
}
