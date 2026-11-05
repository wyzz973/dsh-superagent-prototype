/**
 * Projects page: what the team taught the agent waiting for a person first, then each project with its checkout, the
 * conversations bound to it, its work by stage, how its tickets' checkouts are made ready and how the latest ones went.
 */
import { useState, type ReactNode } from 'react'
import { LIMITS } from '../limits.ts'
import { usePoll, type MemoryEntry, type ProjectCard, type ProjectsView } from './api.ts'
import { Button, Icon, InfoTip, Input, Modal, StateDot, Tag } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { Avatar, Count, PageIntro } from './team-kit.tsx'
import { actorName, valueLabel, type T } from './text.ts'
import { ConfirmButton, LoadState, Section, When } from './widgets.tsx'

type Project = Omit<ProjectCard, 'bindings' | 'open' | 'stages' | 'delivered' | 'checkouts' | 'problems' | 'memory'> & { bindings: string[] }
const STAGES = ['queued', 'working', 'person', 'idle'] as const
const STEPS = ['worktree', 'copy', 'clone', 'bootstrap', 'verify'] as const
/** A stable hue for a project's monogram, from its id, so the same project reads the same everywhere. */
export const projectHue = (id: string) => [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7)
const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean)
const words = (text: string) => text.split(/[,，\s]+/).map(word => word.trim()).filter(Boolean)

function Monogram({ project }: { project: Pick<Project, 'id' | 'name'> }) {
  return <span className="dt-project-mark" style={{ ['--dt-hue' as string]: projectHue(project.id) }} aria-hidden="true">
    {[...project.name.trim()][0]?.toUpperCase() ?? '?'}</span>
}
/** The project's open work as one bar, a segment per stage in board order, with its count beside each. */
function StageBar({ project }: { project: ProjectCard }) {
  const { t } = usePanel()
  const total = STAGES.reduce((sum, stage) => sum + project.stages[stage], 0)
  return <div className="dt-project-stages">
    <div className="dt-project-bar" role="img" aria-label={STAGES.map(stage => `${t(`board.col.${stage}`, { days: 7 })} ${project.stages[stage]}`).join(', ')}>
      {total ? STAGES.filter(stage => project.stages[stage]).map(stage => <span key={stage} className="dt-project-bar-part" data-stage={stage}
        style={{ flexGrow: project.stages[stage] }} />) : <span className="dt-project-bar-part" data-stage="none" style={{ flexGrow: 1 }} />}
    </div>
    <ul className="dt-project-legend">
      {STAGES.map(stage => <li key={stage} data-stage={stage} data-zero={project.stages[stage] === 0 || undefined}>
        <span className="dt-project-legend-key" />{t(`board.col.${stage}`, { days: 7 })}<b><Count value={project.stages[stage]} /></b></li>)}
    </ul>
  </div>
}
/** How a ticket's checkout of the project is made, step by step as the host runs it, with what each step holds. */
function Recipe({ project }: { project: ProjectCard }) {
  const { t } = usePanel()
  const { workspace } = project
  const count: Record<typeof STEPS[number], number> = { worktree: project.checkout || project.prepare ? 1 : 0, copy: workspace.copy.length,
    clone: workspace.clone.length, bootstrap: workspace.bootstrap.length, verify: workspace.verify ? 1 : 0 }
  const detail: Record<typeof STEPS[number], string> = { worktree: project.prepare ? t('projects.recipe.prepare') : project.base || t('projects.recipe.base'),
    copy: workspace.copy.join(', '), clone: workspace.clone.join(', '), bootstrap: workspace.bootstrap.join(' && '), verify: workspace.verify }
  return <ol className="dt-recipe" aria-label={t('projects.recipe')}>
    {STEPS.map(step => <li key={step} className="dt-recipe-step" data-on={count[step] > 0 || undefined} title={detail[step] || t('projects.recipe.off')}>
      <span className="dt-recipe-dot" />
      <span className="dt-recipe-name">{t(`projects.step.${step}`)}</span>
      {step !== 'worktree' && step !== 'verify' && count[step] > 0 && <span className="dt-recipe-count">{count[step]}</span>}
    </li>)}
  </ol>
}
const dotOf = (state: 'preparing' | 'ready' | 'failed') => state === 'ready' ? 'done' as const : state === 'failed' ? 'error' as const : 'ongoing' as const
function Checkouts({ project }: { project: ProjectCard }) {
  const { t, navigate } = usePanel()
  if (!project.checkouts.length) return <p className="dt-hint">{t('projects.noCheckouts')}</p>
  return <ul className="dt-checkouts">
    {project.checkouts.map(item => <li key={item.ticket.id} className="dt-checkout" data-state={item.state}>
      <div className="dt-checkout-line">
        <StateDot state={dotOf(item.state)} />
        <button type="button" className="dt-checkout-title" onClick={() => navigate({ page: 'execution', id: item.ticket.id })}>{item.ticket.title}</button>
        <span className="dt-checkout-step">{item.state === 'ready' ? t('projects.checkout.ready')
          : t(item.state === 'failed' ? 'projects.checkout.failed' : 'projects.checkout.preparing', { step: t(`projects.step.${item.step ?? 'worktree'}`) })}</span>
        <span className="dt-checkout-time"><When at={item.at} /></span>
      </div>
      {item.state === 'failed' && item.output && <details className="dt-checkout-output">
        <summary>{t('projects.checkout.output')}</summary><pre className="dt-pre">{item.output}</pre></details>}
      {item.ports && <div className="dt-checkout-ports">{Object.entries(item.ports).map(([name, port]) =>
        <span key={name} className="dt-port"><span>{name}</span>{port}</span>)}</div>}
    </li>)}
  </ul>
}

function ProjectPanel({ project, onEdit }: { project: ProjectCard; onEdit: () => void }) {
  const { t } = usePanel()
  return <article className="dt-project" data-problem={project.problems > 0 || undefined} aria-label={project.name}>
    <header className="dt-project-head">
      <Monogram project={project} />
      <div className="dt-project-title">
        <h3>{project.name}<span className="dt-mono dt-project-id">{project.id}</span></h3>
        {project.description && <p className="dt-hint">{project.description}</p>}
      </div>
      <Button size="sm" icon={<Icon name="settings" size={14} />} onClick={onEdit}>{t('projects.edit')}</Button>
    </header>
    {project.problems > 0 && <div className="dt-project-alert" role="status"><Icon name="alert" size={14} />
      {t('projects.problems', { count: project.problems })}</div>}
    <dl className="dt-project-facts">
      <div><dt><Icon name="folder" size={14} />{t('projects.checkout')}</dt>
        <dd className="dt-mono" title={project.checkout}>{project.checkout || t('projects.noCheckout')}</dd></div>
      <div><dt><Icon name="message" size={14} />{t('projects.bindings')}</dt>
        <dd>{project.bindings.length ? project.bindings.map(binding => <span key={binding.key} className="dt-binding" title={binding.key}>
          <span className="dt-binding-source">{valueLabel(t, 'source', binding.source)}</span>{binding.name ?? (binding.key.split(':').slice(1).join(':') || t('projects.bindingAll'))}
        </span>) : <span className="dt-hint">{t('projects.noBindings')}</span>}</dd></div>
      {project.aliases.length > 0 && <div><dt><Icon name="hash" size={14} />{t('projects.aliases')}</dt>
        <dd>{project.aliases.map(alias => <Tag key={alias} tone="neutral">{alias}</Tag>)}</dd></div>}
    </dl>
    <StageBar project={project} />
    <div className="dt-project-block">
      <h4 className="dt-project-subhead">{t('projects.recipe')}<InfoTip text={t('projects.recipeHint')} />
        {project.workspace.ports.length > 0 && <span className="dt-project-ports">{t('projects.ports', { names: project.workspace.ports.join(', ') })}</span>}</h4>
      <Recipe project={project} />
    </div>
    <div className="dt-project-block">
      <h4 className="dt-project-subhead">{t('projects.latest')}<span className="dt-project-delivered">{t('projects.delivered', { count: project.delivered })}</span></h4>
      <Checkouts project={project} />
    </div>
    {project.memory.hints.length > 0 && <div className="dt-project-block">
      <h4 className="dt-project-subhead">{t('projects.hints')}<InfoTip text={t('projects.hintsHint')} /></h4>
      <ul className="dt-hints">{project.memory.hints.map(hint => <li key={hint.id}><Icon name="bulb" size={14} /><span>{hint.text}</span></li>)}</ul>
    </div>}
  </article>
}

/** A proposed workspace change as the lines it would add, each with the step it belongs to. */
function ChangeLines({ entry }: { entry: MemoryEntry }) {
  const { t } = usePanel()
  const change = entry.change ?? {}
  const rows: [string, string, 'add' | 'set'][] = [
    ...(change.copy ?? []).map(value => [t('projects.step.copy'), value, 'add'] as [string, string, 'add']),
    ...(change.clone ?? []).map(value => [t('projects.step.clone'), value, 'add'] as [string, string, 'add']),
    ...(change.bootstrap ?? []).map(value => [t('projects.step.bootstrap'), value, 'add'] as [string, string, 'add']),
    ...change.verify ? [[t('projects.step.verify'), change.verify, 'set'] as [string, string, 'set']] : [],
    ...(change.ports ?? []).map(value => [t('projects.port'), value, 'add'] as [string, string, 'add'])]
  return <ul className="dt-change-lines">{rows.map(([step, value, kind], index) => <li key={index} data-kind={kind}>
    <span className="dt-change-sign">{kind === 'add' ? '+' : '→'}</span><span className="dt-change-step">{step}</span><code>{value}</code></li>)}</ul>
}
function MemoryCard({ entry, projects, reload }: { entry: MemoryEntry; projects: ProjectsView['projects']; reload: () => Promise<unknown> }) {
  const { t, call, navigate } = usePanel()
  const confirm = useAction(() => call('POST projects/memory/:id/confirm', { id: entry.id }), { reload })
  const reject = useAction(() => call('POST projects/memory/:id/reject', { id: entry.id }), { reload })
  const project = projects.find(item => item.id === entry.project)
  const open = entry.state === 'proposed'
  return <li className="dt-memory" data-kind={entry.kind} data-state={entry.state}>
    <div className="dt-memory-top">
      <Tag tone={entry.kind === 'hint' ? 'info' : 'neutral'}>{t(`projects.memory.${entry.kind}`)}</Tag>
      {project && <span className="dt-memory-project"><Monogram project={project} />{project.name}</span>}
      {!open && <Tag tone={entry.state === 'confirmed' ? 'success' : 'quiet'}>{t(`projects.memory.state.${entry.state}`)}</Tag>}
      <span className="dt-memory-time"><When at={entry.decidedAt ?? entry.at} /></span>
    </div>
    <p className="dt-memory-text">{entry.text}</p>
    {entry.kind === 'workspace' && <ChangeLines entry={entry} />}
    <div className="dt-memory-foot">
      {entry.actor ? <span className="dt-memory-from"><Avatar actor={entry.actor} id={`${entry.actor.source}:${entry.actor.id}`} t={t} size="sm" />
        <span>{t('projects.memory.said', { name: actorName(t, entry.actor) })}</span>
        {entry.quote && <q className="dt-memory-quote" title={entry.quote}>{entry.quote}</q>}</span>
        : entry.ticket ? <span className="dt-memory-from"><Icon name="bot" size={14} />{t('projects.memory.from')}
          <button type="button" className="dt-textlink" onClick={() => navigate({ page: 'execution', id: entry.ticket!.id })}>{entry.ticket.title}</button></span>
        : <span />}
      {open && <span className="dt-actions">
        <Button size="sm" disabled={reject.busy || confirm.busy} onClick={() => { void reject.run() }}>{t('projects.memory.reject')}</Button>
        <Button size="sm" variant="primary" icon={<Icon name="check" size={14} />} disabled={confirm.busy || reject.busy}
          onClick={() => { void confirm.run() }}>{t(entry.kind === 'workspace' ? 'projects.memory.apply' : 'projects.memory.confirm')}</Button>
      </span>}
    </div>
  </li>
}

const BLANK: Project = { id: '', name: '', description: '', aliases: [], bindings: [], checkout: '', base: '', prepare: '',
  workspace: { copy: [], clone: [], bootstrap: [], verify: '', ports: [] } }
const asProject = (card: ProjectCard): Project => ({ id: card.id, name: card.name, description: card.description, aliases: card.aliases,
  bindings: card.bindings.map(binding => binding.key), checkout: card.checkout, base: card.base, prepare: card.prepare, workspace: card.workspace })
/** The editor's text fields: lists one entry per line, aliases and ports separated by commas or spaces. */
interface Draft { id: string; name: string; description: string; aliases: string; bindings: string; checkout: string; base: string; prepare: string
  copy: string; clone: string; bootstrap: string; verify: string; ports: string }
const draftOf = (project: Project): Draft => ({ id: project.id, name: project.name, description: project.description, aliases: project.aliases.join(', '),
  bindings: project.bindings.join('\n'), checkout: project.checkout, base: project.base, prepare: project.prepare, copy: project.workspace.copy.join('\n'),
  clone: project.workspace.clone.join('\n'), bootstrap: project.workspace.bootstrap.join('\n'), verify: project.workspace.verify, ports: project.workspace.ports.join(', ') })
const projectOf = (draft: Draft): Project => ({ id: draft.id.trim(), name: draft.name.trim(), description: draft.description.trim(), aliases: words(draft.aliases),
  bindings: lines(draft.bindings), checkout: draft.checkout.trim(), base: draft.base.trim(), prepare: draft.prepare,
  workspace: { copy: lines(draft.copy), clone: lines(draft.clone), bootstrap: lines(draft.bootstrap), verify: draft.verify.trim(), ports: words(draft.ports) } })
/** What a draft gets wrong before it is saved, by field; the host checks it again. */
function problems(t: T, draft: Draft, taken: string[]): Partial<Record<keyof Draft, string>> {
  const found: Partial<Record<keyof Draft, string>> = {}
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(draft.id.trim())) found.id = t('projects.form.idInvalid')
  else if (taken.includes(draft.id.trim())) found.id = t('projects.form.idTaken')
  if (!draft.name.trim()) found.name = t('projects.form.required')
  if (draft.checkout.trim() && !draft.checkout.trim().startsWith('/')) found.checkout = t('projects.form.absolute')
  if (words(draft.ports).some(name => !/^[a-z][a-z0-9_]{0,15}$/.test(name))) found.ports = t('projects.form.portInvalid')
  return found
}
function FormRow({ label, hint, error, wide, children }: { label: string; hint?: string; error?: string | undefined; wide?: boolean; children: ReactNode }) {
  return <label className="dt-form-row" data-wide={wide || undefined} data-invalid={error ? true : undefined}>
    <span className="dt-form-label">{label}{hint && <InfoTip text={hint} />}</span>
    {children}
    {error && <small className="dt-error-text">{error}</small>}
  </label>
}
function ProjectEditor({ data, editing, onClose, reload }: { data: ProjectsView; editing: Project | 'new'; onClose: () => void; reload: () => Promise<unknown> }) {
  const { t, call } = usePanel()
  const original = editing === 'new' ? BLANK : editing
  const [draft, setDraft] = useState<Draft>(() => draftOf(original))
  const [tried, setTried] = useState(false)
  const all = data.projects.map(asProject)
  const taken = all.map(project => project.id).filter(id => id !== original.id)
  const found = problems(t, draft, taken)
  const save = useAction(async (projects: Project[]) => {
    await call('PUT settings/:block', { block: 'projects', body: { value: { projects }, revision: data.revision } })
    onClose()
  }, { reload })
  const set = (field: keyof Draft) => (event: { target: { value: string } }) => setDraft(previous => ({ ...previous, [field]: event.target.value }))
  const text = (field: keyof Draft, placeholder = '') => <Input value={draft[field]} placeholder={placeholder} onChange={set(field)}
    aria-invalid={tried && !!found[field] || undefined} />
  const area = (field: keyof Draft, placeholder: string, rows = 3) => <textarea className="dt-textarea dt-mono" rows={rows} value={draft[field]}
    placeholder={placeholder} spellCheck={false} onChange={set(field)} />
  const submit = () => {
    setTried(true)
    if (Object.keys(found).length) return
    const next = projectOf(draft)
    void save.run(editing === 'new' ? [...all, next] : all.map(project => project.id === original.id ? next : project))
  }
  const shown = (field: keyof Draft) => tried ? found[field] : undefined
  return <Modal open onClose={onClose} className="dt-project-editor" title={t(editing === 'new' ? 'projects.form.new' : 'projects.form.edit')}
    closeLabel={t('close')} description={t('projects.form.lead')}
    footer={<>
      {editing !== 'new' && <span className="dt-editor-danger"><ConfirmButton label={t('projects.form.delete')} icon="trash"
        title={t('projects.form.deleteTitle', { name: original.name })} message={t('projects.form.deleteMessage')}
        onConfirm={() => save.run(all.filter(project => project.id !== original.id))} /></span>}
      <Button onClick={onClose}>{t('cancel')}</Button>
      <Button variant="primary" disabled={save.busy} onClick={submit}>{t('save')}</Button>
    </>}>
    <form className="dt-project-form" onSubmit={event => { event.preventDefault(); submit() }}>
      <fieldset className="dt-form-group"><legend>{t('projects.form.basics')}</legend>
        <FormRow label={t('projects.form.name')} error={shown('name')}>{text('name', t('projects.form.namePlaceholder'))}</FormRow>
        <FormRow label={t('projects.form.id')} hint={t('projects.form.idHint')} error={shown('id')}>
          <Input className="dt-mono" value={draft.id} placeholder="order-service" disabled={editing !== 'new'} onChange={set('id')} /></FormRow>
        <FormRow label={t('projects.form.description')} hint={t('projects.form.descriptionHint')} wide>{text('description', t('projects.form.descriptionPlaceholder'))}</FormRow>
        <FormRow label={t('projects.form.aliases')} hint={t('projects.form.aliasesHint')} wide>{text('aliases', t('projects.form.aliasesPlaceholder'))}</FormRow>
        <FormRow label={t('projects.form.bindings')} hint={t('projects.form.bindingsHint')} wide>{area('bindings', 'feishu:oc_…', 2)}</FormRow>
      </fieldset>
      <fieldset className="dt-form-group"><legend>{t('projects.form.code')}</legend>
        <FormRow label={t('projects.form.checkout')} hint={t('projects.form.checkoutHint')} error={shown('checkout')} wide>
          <Input className="dt-mono" value={draft.checkout} placeholder="/Users/me/code/order-service" onChange={set('checkout')} /></FormRow>
        <FormRow label={t('projects.form.base')} hint={t('projects.form.baseHint')}>
          <Input className="dt-mono" value={draft.base} placeholder="origin/main" onChange={set('base')} /></FormRow>
        <FormRow label={t('projects.form.ports')} hint={t('projects.form.portsHint')} error={shown('ports')}>
          <Input className="dt-mono" value={draft.ports} placeholder="web, grpc" onChange={set('ports')} /></FormRow>
      </fieldset>
      <fieldset className="dt-form-group"><legend>{t('projects.form.workspace')}<InfoTip text={t('projects.recipeHint')} /></legend>
        <FormRow label={t('projects.step.copy')} hint={t('projects.form.copyHint')}>{area('copy', '.env.local\nconfig/application-local.yml')}</FormRow>
        <FormRow label={t('projects.step.clone')} hint={t('projects.form.cloneHint')}>{area('clone', 'node_modules\n.venv')}</FormRow>
        <FormRow label={t('projects.step.bootstrap')} hint={t('projects.form.bootstrapHint')} wide>{area('bootstrap', 'pnpm install --offline\nmake gen')}</FormRow>
        <FormRow label={t('projects.step.verify')} hint={t('projects.form.verifyHint')} wide>
          <Input className="dt-mono" value={draft.verify} placeholder="pnpm test:smoke" onChange={set('verify')} /></FormRow>
      </fieldset>
      <details className="dt-form-advanced" open={!!draft.prepare || undefined}>
        <summary>{t('projects.form.advanced')}</summary>
        <FormRow label={t('projects.form.prepare')} hint={t('projects.form.prepareHint')} wide>
          <textarea className="dt-textarea dt-mono" rows={3} maxLength={LIMITS.prepareCommand} value={draft.prepare} spellCheck={false}
            placeholder={'git -C "$DSH_SUPERAGENT_CHECKOUT" worktree add "$DSH_SUPERAGENT_DIR"'} onChange={set('prepare')} /></FormRow>
      </details>
      <button type="submit" hidden />
    </form>
  </Modal>
}

function EmptyProjects({ onAdd }: { onAdd: () => void }) {
  const { t } = usePanel()
  return <div className="dt-project-empty">
    <span className="dt-intro-icon"><Icon name="folder" size={20} /></span>
    <h3>{t('projects.empty.title')}</h3>
    <p className="dt-hint">{t('projects.empty.text')}</p>
    <ol className="dt-project-empty-steps">
      {(['checkout', 'bind', 'recipe'] as const).map(step => <li key={step}><b>{t(`projects.empty.${step}`)}</b><span>{t(`projects.empty.${step}Text`)}</span></li>)}
    </ol>
    <Button variant="primary" icon={<Icon name="plus" size={14} />} onClick={onAdd}>{t('projects.add')}</Button>
  </div>
}

export function ProjectsPage() {
  const { t, call } = usePanel()
  const { data, error, reload } = usePoll(() => call('GET projects'), [])
  const [editing, setEditing] = useState<Project | 'new'>()
  const [history, setHistory] = useState(false)
  if (!data) return <LoadState error={error} loading />
  const proposed = data.memory.filter(entry => entry.state === 'proposed')
  const decided = data.memory.filter(entry => entry.state !== 'proposed')
  return <div className="dt-projects-page">
    {error && <LoadState error={error} loading={false} />}
    <PageIntro icon="folder" title={t('tab.projects')} text={t('projects.subtitle')}>
      {data.projects.length > 0 && <Button variant="primary" size="sm" icon={<Icon name="plus" size={14} />} onClick={() => setEditing('new')}>{t('projects.add')}</Button>}
    </PageIntro>
    {proposed.length > 0 && <Section title={t('projects.memory.waiting')} count={proposed.length} icon="bulb" hint={t('projects.memory.waitingHint')}>
      <ul className="dt-memories">{proposed.map(entry => <MemoryCard key={entry.id} entry={entry} projects={data.projects} reload={reload} />)}</ul>
    </Section>}
    {data.unassigned > 0 && data.projects.length > 0 && <p className="dt-hint dt-projects-unassigned">{t('projects.unassigned', { count: data.unassigned })}</p>}
    {data.projects.length ? <div className="dt-project-grid">
      {data.projects.map(project => <ProjectPanel key={project.id} project={project} onEdit={() => setEditing(asProject(project))} />)}
    </div> : <EmptyProjects onAdd={() => setEditing('new')} />}
    {decided.length > 0 && <div className="dt-memory-history">
      <button type="button" className="dt-textlink" aria-expanded={history} onClick={() => setHistory(!history)}>
        <Icon name="history" size={14} />{t('projects.memory.history', { count: decided.length })}</button>
      {history && <ul className="dt-memories">{decided.map(entry => <MemoryCard key={entry.id} entry={entry} projects={data.projects} reload={reload} />)}</ul>}
    </div>}
    {editing && <ProjectEditor data={data} editing={editing} onClose={() => setEditing(undefined)} reload={reload} />}
  </div>
}
