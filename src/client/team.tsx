/** Team page: the agent's profile, the people who ask it for work, the team's activity, and the window's delivery figures. */
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { usePoll, type TeamActivity, type TeamView } from './api.ts'
import { Icon, StateDot } from './controls.tsx'
import { useArrivals } from './motion.ts'
import { usePanel } from './provider.tsx'
import { AgentAvatar, Avatar, Count, Kpi, PageIntro, duration, percent, useSize } from './team-kit.tsx'
import { actorName, readableMarkers, valueLabel, type T } from './text.ts'
import { LoadState, Section, When } from './widgets.tsx'

function AgentCard({ agent, days }: { agent: TeamView['agent']; days: number }) {
  const { t } = usePanel()
  const used = agent.maxWorkers ? Math.min(1, agent.running / agent.maxWorkers) : 0
  const stat = (label: string, value: number, tone?: 'warning') => <div className="dt-agent-stat" data-tone={tone}>
    <span className="dt-agent-stat-value"><Count value={value} /></span><span className="dt-agent-stat-label">{label}</span>
  </div>
  return <section className="dt-agent-card" aria-label={t('term.agent')}>
    <div className="dt-agent-id">
      <AgentAvatar size="lg" />
      <div className="dt-agent-name">
        <h3>{t('title')}<span className="dt-agent-status"><StateDot state={agent.paused ? 'warning' : 'done'} />
          {t(agent.paused ? 'team.paused' : 'team.online')}</span></h3>
        <p className="dt-hint">{agent.account ? t('team.actsAs', { account: agent.account }) : t('team.notSetUp')}</p>
        {/* A cell per worker slot while they fit on a line; a continuous bar beyond that. */}
        <div className="dt-meter" role="meter" aria-valuemin={0} aria-valuemax={agent.maxWorkers} aria-valuenow={agent.running}
          aria-label={t('team.slots', { running: agent.running, max: agent.maxWorkers })} data-slots={agent.maxWorkers <= 12 || undefined}>
          {agent.maxWorkers <= 12 ? Array.from({ length: agent.maxWorkers }, (_, index) => <span key={index} className="dt-meter-slot"
            data-on={index < agent.running || undefined} style={{ '--dt-i': index } as CSSProperties} />)
            : <span className="dt-meter-fill" style={{ transform: `scaleX(${used})` }} />}
        </div>
        <p className="dt-agent-load">{t('team.slots', { running: agent.running, max: agent.maxWorkers })}
          {agent.queued > 0 && <> · {t('team.queued', { count: agent.queued })}</>}</p>
      </div>
    </div>
    <div className="dt-agent-stats">
      {stat(t('team.stat.open'), agent.open)}
      {stat(t('team.stat.waiting'), agent.waiting, agent.waiting ? 'warning' : undefined)}
      {stat(t('team.stat.delivered', { days }), agent.delivered)}
      {stat(t('team.stat.total'), agent.total)}
    </div>
  </section>
}

function Members({ members }: { members: TeamView['members'] }) {
  const { t } = usePanel()
  if (!members.length) return <p className="dt-empty"><Icon name="users" size={16} />{t('team.membersNone')}</p>
  return <ul className="dt-members">{members.map(member => <li key={member.key} className="dt-member">
    <Avatar actor={member.actor} id={member.key} t={t} size="lg" />
    <div className="dt-member-main">
      <div className="dt-member-name"><span>{actorName(t, member.actor)}</span>
        <span className="dt-member-source">{valueLabel(t, 'source', member.actor.source)}</span></div>
      <div className="dt-member-counts">
        <span><b>{member.requested}</b> {t('team.member.requested')}</span>
        <span><b>{member.open}</b> {t('team.member.open')}</span>
        <span><b>{member.delivered}</b> {t('team.member.delivered')}</span>
      </div>
      <div className="dt-member-foot">
        {member.waiting > 0 && <span className="dt-member-waiting">{t('team.member.waiting', { count: member.waiting })}</span>}
        {member.inferred > 0 && <span>{t('team.member.proactive', { count: member.inferred })}</span>}
        <When at={member.lastAt} />
      </div>
    </div>
  </li>)}</ul>
}

function eventText(t: T, event: TeamActivity): { lead: string; detail?: string; tone?: 'done' | 'warning' | 'error' | 'idle' } {
  switch (event.kind) {
    case 'created': return { lead: t(event.strength === 'inferred' ? 'team.event.proactive' : 'team.event.created',
      { actor: actorName(t, event.actor) }) }
    case 'followup': return { lead: t('team.event.followup', { actor: actorName(t, event.actor) }), detail: event.preview }
    case 'report': return { lead: t(`team.event.${event.state as 'ready' | 'blocked' | 'failed' | 'dropped'}`), detail: event.preview,
      tone: event.state === 'ready' ? 'done' : event.state === 'failed' ? 'error' : event.state === 'blocked' ? 'warning' : 'idle' }
    case 'ended': return { lead: t('team.event.ended', { outcome: valueLabel(t, 'outcome', event.outcome) }),
      tone: event.outcome === 'merged' || event.outcome === 'completed' ? 'done' : 'idle' }
  }
}
/** The local day an event falls on, worded as today, yesterday or its date. */
function dayLabel(t: T, at: string): string {
  const date = new Date(at), today = new Date()
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((start(today) - start(date)) / 86_400_000)
  if (days === 0) return t('team.today')
  if (days === 1) return t('team.yesterday')
  return date.toLocaleDateString(t('lang') === 'en' ? 'en' : 'zh-CN', { month: 'short', day: 'numeric', weekday: 'short' })
}
const eventKey = (event: TeamActivity) => `${event.kind}-${event.ticket.id}-${event.at}`
const FEED_STEP = 12
function Activity({ events }: { events: TeamActivity[] }) {
  const { t, navigate } = usePanel()
  const fresh = useArrivals(events.map(eventKey))
  const [shown, setShown] = useState(FEED_STEP)
  if (!events.length) return <p className="dt-empty"><Icon name="activity" size={16} />{t('team.activityNone')}</p>
  const groups: { day: string; events: TeamActivity[] }[] = []
  for (const event of events.slice(0, shown)) {
    const day = dayLabel(t, event.at)
    const last = groups.at(-1)
    if (last?.day === day) last.events.push(event)
    else groups.push({ day, events: [event] })
  }
  const who = (event: TeamActivity): ReactNode => event.kind === 'created' && event.strength !== 'inferred' || event.kind === 'followup'
    ? <Avatar actor={event.actor} id={`${event.actor.source}:${event.actor.id}`} t={t} size="sm" /> : <AgentAvatar size="sm" />
  return <div className="dt-feed">{groups.map(group => <div key={group.day} className="dt-feed-day">
    <h4 className="dt-feed-date">{group.day}</h4>
    <ol className="dt-feed-list">{group.events.map((event, index) => {
      const text = eventText(t, event)
      return <li key={`${eventKey(event)}-${index}`} className="dt-feed-item" data-tone={text.tone} data-new={fresh.has(eventKey(event)) || undefined}>
        <span className="dt-feed-who">{who(event)}</span>
        <div className="dt-feed-body">
          <p className="dt-feed-line">{text.lead} <button type="button" className="dt-textlink dt-feed-ticket"
            onClick={() => navigate({ page: 'execution', id: event.ticket.id })}>{event.ticket.title}</button></p>
          {text.detail && <p className="dt-feed-detail">{readableMarkers(t, text.detail)}</p>}
        </div>
        <span className="dt-feed-time"><When at={event.at} /></span>
      </li>
    })}</ol>
  </div>)}
    {events.length > shown && <button type="button" className="dt-board-more dt-feed-more" onClick={() => setShown(shown + FEED_STEP * 2)}>
      {t('board.more', { count: Math.min(events.length - shown, FEED_STEP * 2) })}<Icon name="chevron-down" size={12} /></button>}
  </div>
}

/** One bucket per local day of the window, oldest first, counting the given times. */
function perDay(days: number, series: Record<'created' | 'delivered', string[]>) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const buckets = Array.from({ length: days }, (_, index) => {
    const start = new Date(today); start.setDate(today.getDate() - (days - 1 - index))
    return { start: start.getTime(), created: 0, delivered: 0 }
  })
  const add = (at: string, key: 'created' | 'delivered') => {
    const time = Date.parse(at)
    const bucket = buckets.findLast(item => item.start <= time)
    if (bucket) bucket[key]++
  }
  series.created.forEach(at => add(at, 'created')); series.delivered.forEach(at => add(at, 'delivered'))
  return buckets
}
/** A round axis top for `max`, with its tick step: 1, 2 or 5 times a power of ten, at most four steps. */
function axis(max: number): { top: number; step: number } {
  const raw = Math.max(1, max) / 4, power = 10 ** Math.floor(Math.log10(raw))
  const step = Math.max(1, [1, 2, 5, 10].map(factor => factor * power).find(value => value >= raw)!)
  return { top: Math.max(step, Math.ceil(max / step) * step), step }
}
/**
 * New and delivered work per local day, as paired columns on one axis with hairline gridlines. A column's slot is its hover and
 * focus target, the arrow keys walk the days, and a table twin carries every value for a screen reader.
 */
function DailyChart({ days, series }: { days: number; series: TeamView['insights']['series'] }) {
  const { t } = usePanel()
  const [hover, setHover] = useState<number>()
  const plot = useRef<HTMLDivElement>(null)
  // The plot fills what its card leaves, so the chart is as tall as the figures beside it.
  const { width, height: box } = useSize(plot, { width: 560, height: 172 })
  const buckets = perDay(days, series)
  const { top: max, step } = axis(Math.max(...buckets.flatMap(bucket => [bucket.created, bucket.delivered])))
  const band = 22, height = Math.max(120, box - band), gutter = 26, base = height - 1
  const slot = Math.max(1, (width - gutter) / days), bar = Math.max(3, Math.min(14, slot * 0.3)), gap = 2
  const y = (value: number) => base - (base - 6) * value / max
  const locale = t('lang') === 'en' ? 'en' : 'zh-CN'
  const label = (start: number) => new Date(start).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
  const every = Math.max(1, Math.ceil(days / Math.max(1, Math.floor((width - gutter) / 46))))
  const ticked = (index: number) => index === days - 1 || (index % every === 0 && days - 1 - index >= every)
  // Rounded data end, square at the baseline.
  const column = (x: number, value: number) => {
    if (!value) return ''
    const top = y(value), r = Math.min(3, (base - top) / 2, bar / 2)
    return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bar - r}Q${x + bar},${top} ${x + bar},${top + r}V${base}Z`
  }
  const ticks = Array.from({ length: max / step + 1 }, (_, index) => index * step)
  const walk = (event: KeyboardEvent) => {
    const next = { ArrowLeft: (hover ?? days) - 1, ArrowRight: (hover ?? -1) + 1, Home: 0, End: days - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setHover(Math.max(0, Math.min(days - 1, next)))
  }
  const shown = hover === undefined ? undefined : buckets[hover]
  const tipAt = hover === undefined ? 0 : Math.max(70, Math.min(width - 70, gutter + (hover + 0.5) * slot))
  return <figure className="dt-chart">
    <figcaption className="dt-chart-head">
      <span className="dt-chart-title">{t('team.chart')}</span>
      <span className="dt-legend-row">
        <span className="dt-legend-key" data-series="created" />{t('team.chart.created')}
        <span className="dt-legend-key" data-series="delivered" />{t('team.chart.delivered')}
      </span>
    </figcaption>
    <div className="dt-chart-plot" ref={plot} tabIndex={0} onKeyDown={walk} onFocus={() => setHover(days - 1)} onBlur={() => setHover(undefined)}
      aria-describedby="dt-chart-table">
      <svg width={width} height={height + band} viewBox={`0 0 ${width} ${height + band}`} role="img" aria-label={t('team.chart')}
        onMouseLeave={() => setHover(undefined)}>
        {ticks.map(value => <g key={value} className="dt-chart-grid">
          <line x1={gutter} x2={width} y1={Math.round(y(value)) + 0.5} y2={Math.round(y(value)) + 0.5} data-base={value === 0 || undefined} />
          <text x={gutter - 6} y={y(value) + 3} textAnchor="end">{value}</text>
        </g>)}
        {buckets.map((bucket, index) => {
          const left = gutter + index * slot, x = left + (slot - 2 * bar - gap) / 2
          return <g key={bucket.start} onMouseEnter={() => setHover(index)} data-active={hover === index || undefined}>
            <rect className="dt-chart-hit" x={left} y={0} width={slot} height={base} rx={4} data-active={hover === index || undefined} />
            <path className="dt-chart-bar" data-series="created" d={column(x, bucket.created)} style={{ animationDelay: `${index * 18}ms` }} />
            <path className="dt-chart-bar" data-series="delivered" d={column(x + bar + gap, bucket.delivered)}
              style={{ animationDelay: `${index * 18 + 40}ms` }} />
            {ticked(index) && <text className="dt-chart-tick" x={left + slot / 2} y={height + 15} textAnchor="middle"
              data-active={hover === index || undefined}>{label(bucket.start)}</text>}
          </g>
        })}
      </svg>
      {shown && <div className="dt-chart-tip" style={{ left: tipAt }}>
        <span className="dt-chart-tip-day">{label(shown.start)}</span>
        <span><span className="dt-legend-key" data-series="created" /><b>{shown.created}</b>{t('team.chart.created')}</span>
        <span><span className="dt-legend-key" data-series="delivered" /><b>{shown.delivered}</b>{t('team.chart.delivered')}</span>
      </div>}
      <table id="dt-chart-table" className="dt-sr">
        <thead><tr><th>{t('team.window', { days })}</th><th>{t('team.chart.created')}</th><th>{t('team.chart.delivered')}</th></tr></thead>
        <tbody>{buckets.map(bucket => <tr key={bucket.start}><td>{label(bucket.start)}</td><td>{bucket.created}</td><td>{bucket.delivered}</td></tr>)}</tbody>
      </table>
    </div>
  </figure>
}

/** A part-to-whole as one bar per part, in one hue: each bar's length is its share, its count and share at the end. */
function Split({ title, parts }: { title: string; parts: { key: string; label: string; value: number }[] }) {
  const { t } = usePanel()
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  const present = parts.filter(part => part.value)
  return <div className="dt-split">
    <span className="dt-chart-title">{title}</span>
    {present.length ? <ul className="dt-split-list">{present.map(part => <li key={part.key}>
      <span className="dt-split-label" title={part.label}>{part.label}</span>
      <span className="dt-split-track"><span className="dt-split-fill" style={{ transform: `scaleX(${total ? part.value / total : 0})` }} /></span>
      <span className="dt-split-value">{part.value}<span className="dt-split-share">{percent(t, total ? part.value / total : undefined)}</span></span>
    </li>)}</ul> : <p className="dt-hint">{t('team.activityNone')}</p>}
  </div>
}

function Insights({ data }: { data: TeamView }) {
  const { t } = usePanel()
  const { insights } = data
  const outcomes = (['merged', 'completed', 'closed', 'dropped', 'stopped'] as const).map(outcome => ({ key: outcome,
    label: valueLabel(t, 'outcome', outcome), value: outcome === 'completed' ? insights.delivered - insights.merged : insights[outcome] }))
  const daily = perDay(data.days, insights.series)
  return <div className="dt-insights">
    <div className="dt-kpis">
      <Kpi label={t('team.kpi.created')} value={<Count value={insights.created} />} trend={daily.map(bucket => bucket.created)} />
      <Kpi label={t('team.kpi.delivered')} value={<Count value={insights.delivered} />} trend={daily.map(bucket => bucket.delivered)} />
      <Kpi label={t('team.kpi.lead')} value={duration(t, insights.leadMs)} />
      <Kpi label={t('team.kpi.merge')} value={percent(t, insights.mergeRate)} share={insights.mergeRate} />
      <Kpi label={t('team.kpi.firstPass')} value={percent(t, insights.firstPass)} hint={t('team.kpi.firstPassHint')} share={insights.firstPass} />
      <Kpi label={t('team.kpi.messages')} value={insights.messagesPerTicket === undefined ? t('empty')
        : Math.round(insights.messagesPerTicket * 10) / 10} hint={t('team.kpi.messagesHint')} />
      <Kpi label={t('team.kpi.proactive')} value={<Count value={insights.proactive} />}
        sub={insights.wouldAccept ? t('team.kpi.wouldAccept', { count: insights.wouldAccept }) : undefined} />
    </div>
    <div className="dt-insight-row">
      <DailyChart days={data.days} series={insights.series} />
      <div className="dt-insight-side">
        <Split title={t('team.sources')} parts={Object.entries(insights.sources).map(([key, value]) => ({ key,
          label: valueLabel(t, 'source', key), value }))} />
        <Split title={t('team.outcomes')} parts={outcomes} />
      </div>
    </div>
  </div>
}

export function TeamPage() {
  const { t, call } = usePanel()
  const { data, error } = usePoll(() => call('GET team'), [])
  if (!data) return <LoadState error={error} loading />
  return <div className="dt-team-page">
    {error && <LoadState error={error} loading={false} />}
    <PageIntro icon="users" title={t('tab.team')} text={t('team.subtitle')} />
    <AgentCard agent={data.agent} days={data.days} />
    <Section icon="chart" title={t('team.insights')} badge={<span className="dt-count">{t('team.window', { days: data.days })}</span>}>
      <Insights data={data} />
    </Section>
    <div className="dt-team-grid">
      <Section icon="users" title={t('team.members')} count={data.members.length} hint={t('team.membersHint')}>
        <Members members={data.members} />
      </Section>
      <Section icon="activity" title={t('team.activity')} badge={<span className="dt-live"><span className="dt-live-dot" />{t('team.live')}</span>}>
        <Activity events={data.activity} />
      </Section>
    </div>
  </div>
}
