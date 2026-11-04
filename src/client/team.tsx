/** Team page: the agent's profile, the people who ask it for work, the team's activity, and the window's delivery figures. */
import { useState, type ReactNode } from 'react'
import { usePoll, type TeamActivity, type TeamView } from './api.ts'
import { StateDot } from './controls.tsx'
import { useArrivals } from './motion.ts'
import { usePanel } from './provider.tsx'
import { AgentAvatar, Avatar, Count, Kpi, PageIntro, duration, percent } from './team-kit.tsx'
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
        <div className="dt-meter" role="meter" aria-valuemin={0} aria-valuemax={agent.maxWorkers} aria-valuenow={agent.running}
          aria-label={t('team.slots', { running: agent.running, max: agent.maxWorkers })}>
          <span className="dt-meter-fill" style={{ width: `${used * 100}%` }} />
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
  if (!members.length) return <p className="dt-hint">{t('team.membersNone')}</p>
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
function Activity({ events }: { events: TeamActivity[] }) {
  const { t, navigate } = usePanel()
  const fresh = useArrivals(events.map(eventKey))
  if (!events.length) return <p className="dt-hint">{t('team.activityNone')}</p>
  const groups: { day: string; events: TeamActivity[] }[] = []
  for (const event of events) {
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
  </div>)}</div>
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
function DailyChart({ days, series }: { days: number; series: TeamView['insights']['series'] }) {
  const { t } = usePanel()
  const [hover, setHover] = useState<number>()
  const buckets = perDay(days, series)
  const max = Math.max(1, ...buckets.flatMap(bucket => [bucket.created, bucket.delivered]))
  const height = 120, slot = 28, bar = 10, gap = 2, top = 8
  const width = days * slot
  const y = (value: number) => top + (height - top) * (1 - value / max)
  const locale = t('lang') === 'en' ? 'en' : 'zh-CN'
  const label = (start: number) => new Date(start).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
  // Rounded data end, square at the baseline.
  const column = (x: number, value: number) => {
    if (!value) return ''
    const top = y(value), r = Math.min(4, (height - top) / 2, bar / 2)
    return `M${x},${height}V${top + r}Q${x},${top} ${x + r},${top}H${x + bar - r}Q${x + bar},${top} ${x + bar},${top + r}V${height}Z`
  }
  const shown = hover === undefined ? undefined : buckets[hover]
  return <figure className="dt-chart">
    <figcaption className="dt-chart-head">
      <span className="dt-chart-title">{t('team.chart')}</span>
      <span className="dt-legend-row">
        <span className="dt-legend-key" data-series="created" />{t('team.chart.created')}
        <span className="dt-legend-key" data-series="delivered" />{t('team.chart.delivered')}
      </span>
    </figcaption>
    <div className="dt-chart-plot">
      <svg viewBox={`0 0 ${width} ${height + 18}`} role="img" aria-label={t('team.chart')}
        onMouseLeave={() => setHover(undefined)}>
        <line className="dt-chart-axis" x1={0} x2={width} y1={height} y2={height} />
        {buckets.map((bucket, index) => {
          const x = index * slot + (slot - 2 * bar - gap) / 2
          return <g key={bucket.start} onMouseEnter={() => setHover(index)}>
            <rect className="dt-chart-hit" x={index * slot} y={0} width={slot} height={height} data-active={hover === index || undefined} />
            <path className="dt-chart-bar" data-series="created" d={column(x, bucket.created)} />
            <path className="dt-chart-bar" data-series="delivered" d={column(x + bar + gap, bucket.delivered)} />
            {(index % Math.ceil(days / 7) === 0 || index === days - 1) && <text className="dt-chart-tick" x={index * slot + slot / 2}
              y={height + 14} textAnchor="middle">{label(bucket.start)}</text>}
          </g>
        })}
      </svg>
      {shown && <div className="dt-chart-tip" style={{ left: `${(hover! + 0.5) / days * 100}%` }}>
        <b>{label(shown.start)}</b>
        <span><span className="dt-legend-key" data-series="created" />{t('team.chart.created')} {shown.created}</span>
        <span><span className="dt-legend-key" data-series="delivered" />{t('team.chart.delivered')} {shown.delivered}</span>
      </div>}
    </div>
  </figure>
}

function Split({ title, parts }: { title: string; parts: { key: string; label: string; value: number }[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  return <div className="dt-split">
    <span className="dt-chart-title">{title}</span>
    <ul className="dt-split-list">{parts.filter(part => part.value).map(part => <li key={part.key}>
      <span className="dt-split-label">{part.label}</span>
      <span className="dt-split-track"><span className="dt-split-fill" style={{ width: `${total ? part.value / total * 100 : 0}%` }} /></span>
      <span className="dt-split-value">{part.value}</span>
    </li>)}</ul>
  </div>
}

function Insights({ data }: { data: TeamView }) {
  const { t } = usePanel()
  const { insights } = data
  const outcomes = (['merged', 'completed', 'closed', 'dropped', 'stopped'] as const).map(outcome => ({ key: outcome,
    label: valueLabel(t, 'outcome', outcome), value: outcome === 'completed' ? insights.delivered - insights.merged : insights[outcome] }))
  return <div className="dt-insights">
    <div className="dt-kpis">
      <Kpi label={t('team.kpi.created')} value={<Count value={insights.created} />} />
      <Kpi label={t('team.kpi.delivered')} value={<Count value={insights.delivered} />} />
      <Kpi label={t('team.kpi.lead')} value={duration(t, insights.leadMs)} />
      <Kpi label={t('team.kpi.merge')} value={percent(t, insights.mergeRate)} />
      <Kpi label={t('team.kpi.firstPass')} value={percent(t, insights.firstPass)} hint={t('team.kpi.firstPassHint')} />
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
