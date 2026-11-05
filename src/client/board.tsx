/** Team board: every Ticket as a card in the column of its stage, filterable by the person who asked for it. */
import { useEffect, useRef, useState } from 'react'
import { usePoll, type BoardCard, type BoardView } from './api.ts'
import { Button, Icon, InfoTip, Input, Tag } from './controls.tsx'
import { ticketMark } from './marks.ts'
import { useFlip } from './motion.ts'
import { usePanel, usePanelData } from './provider.tsx'
import { setupPage } from './route.ts'
import { ThreadChip } from './rows.tsx'
import { EngineMap } from './engine.tsx'
import { projectHue } from './projects.tsx'
import { Avatar, Count, PageIntro, duration } from './team-kit.tsx'
import { actorName, readableMarkers, valueLabel } from './text.ts'
import { CheckSetupButton, LoadState, SetupMessage, StageMark, When } from './widgets.tsx'

type Column = BoardView['columns'][number]
const delivered = (card: BoardCard) => card.ended?.outcome === 'merged' || card.ended?.outcome === 'completed'

/** Seconds left in a withdrawal's grace, ticking each second, so the team sees how long a revision can still come. */
function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const left = Math.max(0, Math.ceil((Date.parse(until) - now) / 1000))
  return <span className="dt-countdown" aria-live="off">{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</span>
}

const STEPS = ['received', 'accepted', 'working', 'review', 'ended'] as const
type StepState = 'done' | 'current' | 'idle' | 'waiting' | 'problem' | 'todo'
/** Where a card is in a Ticket's journey, the same steps its page draws: what is done, the step it is on and how that step goes. */
function steps(card: BoardCard): StepState[] {
  if (card.column === 'done') return STEPS.map(() => 'done')
  const action = card.stage === 'person' ? card.action : undefined
  const at = card.column === 'queued' ? 1 : action === 'review' ? 3 : 2
  const now: StepState = action ? action === 'failed' ? 'problem' : 'waiting' : card.column === 'idle' ? 'idle' : 'current'
  return STEPS.map((_, index) => index < at ? 'done' : index === at ? now : 'todo')
}
function Chain({ card }: { card: BoardCard }) {
  const { t } = usePanel()
  const states = steps(card)
  const label = STEPS.map((step, index) => `${t(`journey.step.${step}`)}${states[index] === 'done' ? ' ✓' : states[index] === 'todo' ? '' : ' ●'}`).join(' → ')
  return <div className="dt-chain" role="img" aria-label={t('board.chain', { steps: label })} title={label}>
    {states.map((state, index) => <span key={STEPS[index]} className="dt-chain-step" data-state={state} />)}
  </div>
}

function Card({ card }: { card: BoardCard }) {
  const { t, navigate } = usePanel()
  const mark = ticketMark(t, card)
  // A finished Ticket asks nothing of anyone: its card keeps what it was, who asked and how it ended, and drops the rest.
  const done = card.column === 'done'
  const withdrawn = card.retraction && !card.retraction.revisedBy ? card.retraction : undefined
  const failed = card.workspace?.state === 'failed' ? card.workspace : undefined
  const note = withdrawn ? { text: t(withdrawn.settled ? 'board.withdrawn.settled' : 'board.withdrawn.grace'), error: false }
    : failed ? { text: t('board.workspaceFailedNote', { step: t(`projects.step.${failed.step ?? 'prepare'}`) }), error: true }
    : card.note ? { text: readableMarkers(t, card.note.text), error: card.note.error }
    : card.report ? { text: readableMarkers(t, card.report.preview), error: false } : undefined
  return <li className="dt-board-card" data-col={card.column} data-state={withdrawn && card.state === 'open' ? 'warning' : card.column === 'person' ? mark.dot
    : undefined} data-compact={done || undefined}
    data-flip={card.id} data-flip-group={card.column}>
    <div className="dt-board-card-top">
      <StageMark state={mark.dot} icon={mark.icon} label={mark.label} />
      {card.strength === 'inferred' && <Tag tone="info" title={t('board.proactiveHint')}>{t('board.proactive')}</Tag>}
      {withdrawn && <Tag tone="warning" title={t('board.withdrawnHint')}>{t('board.withdrawnTag')}</Tag>}
      {failed && <Tag tone="danger" title={failed.output}>{t('board.workspaceFailed')}</Tag>}
      {card.workspace?.state === 'preparing' && <Tag tone="info">{t('board.workspacePreparing')}</Tag>}
      {withdrawn && !withdrawn.settled && card.state === 'open' && <Countdown until={withdrawn.until} />}
      <span className="dt-board-card-time"><When at={card.updatedAt} /></span>
    </div>
    {card.project && <span className="dt-board-project" title={card.project.id}>
      <span className="dt-board-project-dot" style={{ ['--dt-hue' as string]: projectHue(card.project.id) }} />{card.project.name}</span>}
    <button type="button" className="dt-board-card-title" onClick={() => navigate({ page: 'execution', id: card.id })}>{card.title}</button>
    {note && !done && <p className={note.error ? 'dt-board-card-note dt-error-text' : 'dt-board-card-note'} title={note.text}>{note.text}</p>}
    {card.threads.length > 0 && !done && <div className="dt-board-card-chips">{card.threads.map(thread => <ThreadChip key={thread.key}
      thread={thread} />)}</div>}
    <div className="dt-board-card-foot">
      <span className="dt-board-who"><Avatar actor={card.requester} id={card.requester.key} t={t} size="sm" />
        <span className="dt-board-who-name">{actorName(t, card.requester)}</span></span>
      <span className="dt-board-card-facts">
        {card.followups > 0 && <span title={t('board.followups', { count: card.followups })}><Icon name="message" size={12} />{card.followups}</span>}
        {card.ended && !done && <span>{valueLabel(t, 'report', card.ended.outcome)}</span>}
        {card.leadMs !== undefined && delivered(card) && <span>{t('board.lead', { duration: duration(t, card.leadMs) })}</span>}
      </span>
    </div>
    {!done && <Chain card={card} />}
  </li>
}

/** Finished cards shown before the rest fold away: the column of work that needs nobody should not set the page's length. */
const DONE_SHOWN = 6
function BoardColumn({ column, days, cards }: { column: Column; days: number; cards: BoardCard[] }) {
  const { t } = usePanel()
  const [all, setAll] = useState(false)
  const folded = column.id === 'done' && !all && cards.length > DONE_SHOWN + 1
  const shown = folded ? cards.slice(0, DONE_SHOWN) : cards
  return <section className="dt-board-col" data-col={column.id} data-empty={cards.length ? undefined : ''}
    aria-label={t(`board.col.${column.id}`, { days })}>
    <header className="dt-board-col-head">
      <span className="dt-board-col-dot" />
      <h3 className="dt-board-col-title">{t(`board.col.${column.id}`, { days })}</h3>
      <span className="dt-count"><Count value={cards.length} /></span>
      <InfoTip text={t(`board.colHint.${column.id}`)} />
    </header>
    {cards.length ? <ul className="dt-board-cards">{shown.map(card => <Card key={card.id} card={card} />)}</ul>
      : <p className="dt-board-empty">{t('board.empty')}</p>}
    {column.id === 'done' && cards.length > DONE_SHOWN + 1 && <button type="button" className="dt-board-more" aria-expanded={!folded}
      onClick={() => setAll(!all)}>{folded ? t('board.more', { count: cards.length - DONE_SHOWN }) : t('board.less')}
      <Icon name="chevron-down" size={12} /></button>}
  </section>
}

/**
 * What keeps the whole team's work from moving, shown above the board as the overview would show it first: a setup problem
 * with its fix, or paused processing. Everything else that needs a person is a card on the board.
 */
function Blockers() {
  const { t, navigate } = usePanel()
  const { setup, state } = usePanelData()
  const problem = setup?.problem ?? setup?.feishuProblem ?? undefined
  if (!problem && !state?.paused) return null
  return <div className="dt-banner dt-danger dt-board-blocker" role="status">
    {problem ? <>
      <span className="dt-banner-label">{t(problem.place === 'feishu' ? 'problemSetupFeishu' : 'problemSetup')}</span>
      <p className="dt-error"><SetupMessage problem={problem} /></p>
      <div className="dt-banner-actions dt-actions">
        <button type="button" className="dt-textlink" onClick={() => navigate(setupPage(problem.place))}>{t(`problemSetupFix.${problem.place}`)}</button>
        <CheckSetupButton />
      </div>
    </> : <button type="button" className="dt-textlink" onClick={() => navigate({ page: 'overview' })}>{t('problemPaused')}</button>}
  </div>
}

export function BoardPage() {
  const { t, call } = usePanel()
  const { data, error } = usePoll(() => call('GET board'), [])
  const [who, setWho] = useState<string>()
  const [project, setProject] = useState<string>()
  const [query, setQuery] = useState('')
  const columns = useRef<HTMLDivElement>(null)
  useFlip(columns)
  if (!data) return <LoadState error={error} loading />
  const text = query.trim().toLowerCase()
  const shown = (card: BoardCard) => (!who || card.requester.key === who) && (!project || card.project?.id === project)
    && (!text || card.title.toLowerCase().includes(text))
  const filtered = !!who || !!project || !!text
  const matches = data.columns.reduce((sum, column) => sum + column.cards.filter(shown).length, 0)
  // What each person has under way, so the filter shows where the work is before it is used.
  const open = (key: string) => data.columns.filter(column => column.id !== 'done')
    .reduce((sum, column) => sum + column.cards.filter(card => card.requester.key === key).length, 0)
  const clear = () => { setWho(undefined); setProject(undefined); setQuery('') }
  return <div className="dt-board-page">
    {error && <LoadState error={error} loading={false} />}
    <PageIntro icon="board" title={t('tab.board')} text={t('board.subtitle')} />
    <Blockers />
    <EngineMap />
    <div className="dt-board-tools">
      <div className="dt-board-people" role="group" aria-label={t('team.members')}>
        <button type="button" className="dt-person-pill" aria-pressed={!who} onClick={() => setWho(undefined)}>{t('board.everyone')}</button>
        {data.people.map(person => <button key={person.key} type="button" className="dt-person-pill" aria-pressed={who === person.key}
          title={t('board.personOpen', { name: actorName(t, person), count: open(person.key) })}
          onClick={() => setWho(who === person.key ? undefined : person.key)}>
          <Avatar actor={person} id={person.key} t={t} size="sm" />{actorName(t, person)}
          {open(person.key) > 0 && <span className="dt-person-count">{open(person.key)}</span>}
        </button>)}
      </div>
      {data.projects.length > 1 && <div className="dt-board-people" role="group" aria-label={t('tab.projects')}>
        <button type="button" className="dt-person-pill" aria-pressed={!project} onClick={() => setProject(undefined)}>{t('board.allProjects')}</button>
        {data.projects.map(item => <button key={item.id} type="button" className="dt-person-pill" aria-pressed={project === item.id}
          onClick={() => setProject(project === item.id ? undefined : item.id)}>
          <span className="dt-board-project-dot" style={{ ['--dt-hue' as string]: projectHue(item.id) }} />{item.name}
        </button>)}
      </div>}
      <div className="dt-search"><Input type="search" icon={<Icon name="filter" />} value={query} placeholder={t('board.filter')}
        aria-label={t('board.filter')} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') setQuery('') }} /></div>
    </div>
    {filtered && !matches && <div className="dt-board-nomatch" role="status">
      <span>{t('board.noMatch')}</span>
      <Button variant="outline" size="sm" icon={<Icon name="close" size={12} />} onClick={clear}>{t('board.clear')}</Button>
    </div>}
    <div className="dt-board" ref={columns}>
      {data.columns.map(column => <BoardColumn key={column.id} column={column} days={data.days} cards={column.cards.filter(shown)} />)}
    </div>
  </div>
}
