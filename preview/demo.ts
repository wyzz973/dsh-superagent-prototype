/**
 * Demo records for the preview: a small team, its Tickets across every stage, and a simulation that moves work along
 * so the board, the activity and a Ticket's journey can be watched changing. Records are written in the Store's own
 * shapes, so the real views read them.
 */
import type { Assignment, Decision, ReportState, Thread, Ticket, TicketOutcome, Trigger } from '../src/core/index.ts'
import type { ProjectMemory, WorkspaceState } from '../src/app/projects.ts'
import type { Store } from '../src/app/store.ts'
import { KV } from '../src/kv.ts'

const MINUTE = 60_000
const ago = (minutes: number, now = Date.now()) => new Date(now - minutes * MINUTE).toISOString()
interface Person { source: 'feishu' | 'github'; id: string; name: string }
export const PEOPLE: Person[] = [
  { source: 'feishu', id: 'ou_zhangwei', name: '张伟' }, { source: 'feishu', id: 'ou_lina', name: '李娜' },
  { source: 'github', id: 'wangfang', name: '王芳' }, { source: 'github', id: 'chenhao', name: 'Chen Hao' },
  { source: 'feishu', id: 'ou_liuyang', name: '刘洋' },
]
export const SETTINGS = {
  eval: { mode: 'observe' },
  policy: { rules: [{ id: 'copy', name: '文案修改', enabled: true, instruction: '修正明确的文案错误' }],
    sources: {
      feishu: { allowed: PEOPLE.filter(person => person.source === 'feishu').map(person => ({ id: person.id, name: person.name })) },
      github: { allowed: PEOPLE.filter(person => person.source === 'github').map(person => ({ id: person.id, name: person.name })) },
    } },
  sources: { feishu: { enabled: true, config: { cli: 'lark-bot', chats: [{ chatId: 'oc_team', name: '前端研发群', listen: 'mentions' }] } },
    github: { enabled: true, config: { repository: 'acme/widgets', cli: 'gh-agent' } } },
  executor: { maxWorkers: 4 },
  projects: { projects: [
    { id: 'web', name: '前端 Web', description: '官网、控制台和个人中心的前端', aliases: ['前端', '网页', '控制台'], bindings: ['feishu:oc_team'],
      checkout: '/Users/zhangwei/code/widgets-web', base: 'origin/main', prepare: '',
      workspace: { copy: ['.env.local'], clone: ['node_modules'], bootstrap: ['pnpm install --offline'], verify: 'pnpm test:smoke', ports: ['web'] } },
    { id: 'api', name: '订单服务', description: '下单、支付回调和订单查询的后端服务', aliases: ['后端', '订单', 'API'], bindings: ['github'],
      checkout: '/Users/zhangwei/code/widgets-api', base: '', prepare: '',
      workspace: { copy: ['.env.local', 'config/application-local.yml'], clone: [], bootstrap: ['make deps'], verify: 'make check', ports: ['http', 'grpc'] } },
    { id: 'mobile', name: '移动端 App', description: 'iOS 和 Android 客户端', aliases: ['App', '客户端'], bindings: [],
      checkout: '/Users/lina/code/widgets-app', base: '', prepare: '', workspace: { copy: ['.env'], clone: [], bootstrap: [], verify: '', ports: [] } },
  ] },
}

interface Spec {
  id: string; title: string; who: number; ask: string; minutes: number
  /** Where the Ticket is: queued, working, a report state, an ended outcome, or a question for a person. */
  at: 'queued' | 'working' | ReportState | TicketOutcome | 'question'
  pr?: number; ci?: 'passed' | 'failed' | 'running'; followups?: string[]; summary?: string; question?: string; proactive?: true
  replies?: string[]
  /** The project it works on, and how its checkout went when not ready. */
  project?: 'web' | 'api' | 'mobile'; workspace?: Pick<WorkspaceState, 'state' | 'step' | 'output'>
}
const SPECS: Spec[] = [
  { id: 'login', project: 'web', title: '登录页「记住我」复选框在暗色模式下不可见', who: 0, ask: '@Superagent 登录页的「记住我」在暗色模式下看不见，帮忙修一下', minutes: 14,
    at: 'working', pr: 128, ci: 'running', replies: ['好的，我来修复暗色模式下「记住我」复选框的对比度，完成后提交 PR。'] },
  { id: 'export', project: 'api', title: '导出 CSV 时日期列变成时间戳', who: 2, ask: '@agent-bot exported CSV shows epoch numbers in the date column', minutes: 46,
    at: 'ready', pr: 131, ci: 'passed', summary: 'PR #131 已就绪：导出时按用户时区格式化日期，补了 3 个单测，CI 通过。',
    replies: ['On it: the CSV export will format dates instead of epoch numbers.', 'PR #131 is ready for review: dates are formatted in the user\'s time zone.'] },
  { id: 'i18n', project: 'web', title: '设置页英文文案「Notifcation」拼写错误', who: 1, ask: '设置页英文那里写成了 Notifcation', minutes: 95, at: 'merged', pr: 126,
    proactive: true, summary: '修正拼写并检查同页其他文案。', replies: ['我来修正设置页的拼写错误。'] },
  { id: 'avatar', project: 'web', title: '个人主页头像上传超过 2MB 时没有提示', who: 4, ask: '@Superagent 头像超过 2MB 上传失败，但页面没任何提示', minutes: 32,
    at: 'question', question: '超过 2MB 时，是直接在前端压缩，还是提示用户重新选择？两种都能做，需要你定一下产品行为。',
    replies: ['收到，我先排查头像上传超过 2MB 时缺少提示的问题。'] },
  { id: 'flaky', project: 'api', title: '支付回调集成测试偶发超时', who: 3, ask: '@agent-bot payment webhook test flakes on CI about 1 in 5 runs', minutes: 180,
    at: 'blocked', pr: 133, ci: 'failed', summary: '复现需要沙箱的支付密钥，当前执行环境没有；已在 PR 草稿中留下排查记录。',
    replies: ['Looking into the flaky payment webhook test.'] },
  { id: 'table', project: 'web', title: '订单表格在窄屏下横向溢出', who: 0, ask: '@Superagent 订单表格在 iPad 竖屏下会溢出', minutes: 4, at: 'queued' },
  { id: 'search', project: 'web', workspace: { state: 'preparing', step: 'bootstrap' }, title: '搜索框输入中文时会提前触发搜索', who: 1, ask: '@Superagent 搜索框打中文拼音的时候就开始搜了', minutes: 7, at: 'queued' },
  { id: 'orders', project: 'api', title: '订单列表接口分页参数越界时返回 500', who: 3, ask: '@agent-bot GET /orders?page=0 returns 500', minutes: 22,
    at: 'failed', summary: 'Preparing the checkout of project api failed at its verify step: make check: REDIS_URL is not set',
    workspace: { state: 'failed', step: 'verify', output: 'make check\n  → go test ./... -run Smoke\npanic: config: REDIS_URL is not set\n    at config.Load (internal/config/config.go:41)\nmake: *** [check] Error 2' },
    replies: ['Looking into the 500 on out-of-range page numbers.'] },
  { id: 'deps', project: 'web', title: '升级 axios 到 1.8 修复安全告警', who: 2, ask: '@agent-bot please bump axios for the security advisory', minutes: 300,
    at: 'waiting', pr: 129, ci: 'passed', summary: '已升级并通过 CI，等待 @wangfang 确认是否同时升级 msw。',
    followups: ['msw 先别动，下周统一升级'], replies: ['Bumping axios to 1.8 for the advisory.'] },
  { id: 'toast', project: 'web', title: '保存成功的提示停留时间太短', who: 4, ask: '保存成功提示一闪就没了', minutes: 26 * 60, at: 'merged', pr: 124, proactive: true,
    summary: '提示停留时间改为 3 秒，与其他提示一致。', replies: ['我把保存成功提示的停留时间调整到与其他提示一致。'] },
  { id: 'readme', project: 'api', title: 'README 的本地启动步骤过期', who: 3, ask: '@agent-bot the README setup steps still mention yarn', minutes: 30 * 60, at: 'merged', pr: 122,
    replies: ['Updating the README setup steps.'] },
  { id: 'empty', project: 'web', title: '空列表时显示「undefined 条记录」', who: 0, ask: '@Superagent 列表为空的时候显示 undefined 条记录', minutes: 50 * 60, at: 'completed',
    summary: '已在 #120 中被修复，确认后无需改动。', replies: ['我来看看空列表的计数显示。'] },
  { id: 'dark', project: 'web', title: '图表在暗色模式下网格线太亮', who: 1, ask: '@Superagent 暗色模式图表网格线太刺眼', minutes: 75 * 60, at: 'merged', pr: 118,
    followups: ['顺便把坐标轴也调暗一点'], replies: ['我来调暗暗色模式下的图表网格线。'] },
  { id: 'cache', project: 'api', title: '商品详情页重复请求库存接口', who: 2, ask: '@agent-bot product page calls the stock API twice', minutes: 100 * 60, at: 'closed', pr: 116,
    summary: '与 @chenhao 的重构 PR 重复，已关闭本 PR。', replies: ['Looking at the duplicate stock request.'] },
  { id: 'copyright', project: 'web', title: '页脚版权年份写死为 2025', who: 4, ask: '页脚还是 2025', minutes: 8 * 24 * 60, at: 'merged', pr: 112, proactive: true,
    replies: ['我把页脚年份改为自动取当前年份。'] },
]

const trigger = (id: string, person: Person, text: string, at: string, thread: string): Trigger => ({
  id, source: person.source, threads: [{ source: person.source, id: thread }], actor: { source: person.source, id: person.id }, human: true,
  addressed: 'mention', at, text, meta: person.source === 'feishu' ? { chatId: 'oc_team', messageId: id } : { number: thread },
  channel: { source: person.source, thread: `${person.source}:${thread}`, address: person.source === 'feishu' ? { chatId: 'oc_team', messageId: id }
    : { number: thread } },
})
const facts = (pr: number, ci: Spec['ci']) => ({ number: { value: `#${pr}` }, ...ci ? { ci: ci === 'failed'
  ? { label: { zh: 'CI', en: 'CI' }, value: { zh: '失败', en: 'failed' }, problem: true as const }
  : { label: { zh: 'CI', en: 'CI' }, value: ci === 'passed' ? { zh: '通过', en: 'passed' } : { zh: '运行中', en: 'running' } } } : {} })

/** Writes one Ticket of `spec` with its Trigger, Threads, Decision, Inputs, Assignments and replies. */
function seed(store: Store, spec: Spec, now: number) {
  const person = PEOPLE[spec.who]!
  const start = now - spec.minutes * MINUTE
  const at = (offset: number) => new Date(Math.min(now, start + offset * MINUTE)).toISOString()
  const homeId = person.source === 'feishu' ? `oc_team:om_${spec.id}` : String(spec.pr ?? 100 + spec.id.length)
  const origin = trigger(`demo-${spec.id}`, person, spec.ask, at(0), homeId)
  store.triggers.save(origin)
  const threads: Thread[] = [{ key: `${person.source}:${homeId}`, ref: { source: person.source, id: homeId }, createdAt: at(0), lastAt: at(0),
    subscriptions: [spec.id], correlated: [], pending: [], meta: person.source === 'feishu' ? { label: '前端研发群', facts: { chat: { value: '前端研发群' } } }
      : { label: `#${homeId} ${spec.title}`, url: `https://github.com/acme/widgets/issues/${homeId}`, facts: { number: { value: `#${homeId}` } } } }]
  if (spec.pr) threads.push({ key: `github:${spec.pr}`, ref: { source: 'github', id: String(spec.pr) }, createdAt: at(6), lastAt: at(9),
    subscriptions: [spec.id], correlated: [], pending: [], meta: { label: `#${spec.pr} ${spec.title}`, url: `https://github.com/acme/widgets/pull/${spec.pr}`,
      facts: facts(spec.pr, spec.ci) } })
  for (const thread of threads) store.threads.save(thread)
  const strength = spec.proactive ? 'inferred' as const : 'explicit' as const
  const mandate = { strength, policyVersion: 'demo', actor: { source: person.source, id: person.id }, scope: spec.title,
    basis: spec.proactive ? { via: 'admission' as const, cell: 'listedUnaddressed' as const, rules: ['copy'], observation: { mode: 'auto' as const } }
      : { via: 'addressed' as const, addressed: 'mention' as const, sender: person.name } }
  const decision: Decision = { id: `decision-${spec.id}`, evalId: `eval-${spec.id}`, threadKey: threads[0]!.key, triggerIds: [origin.id],
    policyVersion: 'demo', at: at(0.3), kind: 'accept', reason: spec.proactive
      ? [{ code: 'said', values: { text: '明确的文案错误，符合「文案修改」规则' } }] : [{ code: 'explicitRouted' }], strength, ticketId: spec.id, mandate }
  store.decisions.save(decision)
  store.triggers.saveDisposition(origin.id, { fanout: [], decisionId: decision.id, at: origin.at })
  const assignment: Assignment = { id: `${spec.id}-a1`, state: spec.at === 'queued' ? 'pending' : 'running', createdAt: at(0.3),
    ...spec.at === 'queued' ? {} : { startedAt: at(1) } }
  const report = (state: ReportState, offset: number, summary = spec.summary ?? '') => { assignment.report = { state, summary, at: at(offset) } }
  const closedAt = spec.minutes * 0.35
  const ended = (outcome: TicketOutcome, by: 'executor' | 'human' = 'executor') => ({ at: at(closedAt), by, outcome })
  let end: Ticket['ended']
  switch (spec.at) {
    case 'working': report('progress', 3, '正在定位样式变量'); break
    case 'ready': case 'blocked': case 'waiting': report(spec.at, spec.minutes * 0.85); break
    case 'failed': report('failed', spec.minutes * 0.1); break
    case 'question': report('progress', 8, '已复现：超过 2MB 时请求被网关拒绝，前端没有处理 413'); break
    case 'merged': case 'closed': case 'completed': case 'dropped': case 'stopped':
      report(spec.at === 'merged' || spec.at === 'closed' ? 'ready' : spec.at === 'completed' ? 'ready' : 'dropped', closedAt * 0.8)
      assignment.state = 'ended'; assignment.endedAt = at(closedAt); end = ended(spec.at)
  }
  const inputs: Ticket['inputs'] = (spec.followups ?? []).map((text, index) => {
    const follow = trigger(`demo-${spec.id}-f${index}`, person, text, at((end ? closedAt : spec.minutes) * 0.6 + index), homeId)
    store.triggers.save(follow)
    store.triggers.saveDisposition(follow.id, { fanout: [spec.id], acked: [spec.id], at: follow.at })
    return { id: `${spec.id}-i${index}`, kind: 'trigger', triggerId: follow.id, at: follow.at, human: true, readAt: follow.at }
  })
  const ticket: Ticket = { id: spec.id, title: spec.title, decisionId: decision.id, mandate, channels: [origin.channel!], assignments: [assignment],
    inputs, undelivered: [], createdAt: at(0.3), updatedAt: at(end ? closedAt : spec.minutes * 0.9), origin: { triggerId: origin.id, triggerIds: [origin.id] },
    ...spec.project ? { project: spec.project } : {},
    execution: { name: spec.id, directory: `/srv/dsh-superagent/work/${spec.project ? `${spec.project}/` : ''}${spec.id}`, assignment: spec.ask },
    ...spec.pr ? { follows: [{ thread: `github:${spec.pr}`, own: true, ...end && (spec.at === 'merged' || spec.at === 'closed')
      ? { closed: { at: end.at, outcome: spec.at } } : {} }] } : {},
    ...spec.question ? { attention: { id: `${spec.id}-q`, question: spec.question, triggerId: origin.id } } : {},
    ...end ? { ended: end } : {} }
  store.tickets.save(ticket)
  if (spec.project && !end) checkout(store, spec, ticket, at(1))
  spec.replies?.forEach((text, index) => {
    const message = { id: `${spec.id}-m${index}`, channel: origin.channel!, text, kind: index ? 'reply' as const : 'acknowledgement' as const,
      ticketId: spec.id }
    store.receipts.add(message); store.receipts.settle(message, 'sent')
    patchReceipt(store, message.id, at(index ? (end ? closedAt * 0.8 : spec.minutes * 0.86) : 0.5))
  })
}
let block = 0
/** The checkout state a ticket of a project has: ready with its own ports, or where `spec` says it is. */
function checkout(store: Store, spec: Spec, ticket: Ticket, at: string) {
  const names = { web: ['web'], api: ['http', 'grpc'], mobile: [] as string[] }[spec.project!]
  const ports = Object.fromEntries(names.map((name, index) => [name, 20000 + block * 10 + index]))
  block++
  const state: WorkspaceState = { state: 'ready', at, directory: ticket.execution!.directory, base: 'origin/main', ...spec.workspace,
    ...names.length ? { ports } : {} }
  store.set(KV.projects.workspace(ticket.id), state)
}
/** What the team taught the agent: a change a worker proposes, a hint a person stated, and what people decided before. */
function memory(store: Store, now: number) {
  const hint = trigger('demo-hint', PEOPLE[1]!, '这个其实是后台的问题，订单服务那边返回的数据不对', ago(18, now), 'oc_team:om_hint')
  store.triggers.save(hint)
  const said = trigger('demo-said', PEOPLE[0]!, '设置页和个人主页都是前端 Web 的', ago(3 * 24 * 60, now), 'oc_team:om_said')
  store.triggers.save(said)
  const entries: ProjectMemory[] = [
    { id: 'mem-sandbox', project: 'api', kind: 'workspace', text: '支付回调测试需要沙箱密钥，它在 .env.sandbox 里；复制后本地连跑 20 次都通过。',
      change: { copy: ['.env.sandbox'], verify: 'make check-sandbox' }, from: { ticketId: 'flaky' }, at: ago(26, now), state: 'proposed' },
    { id: 'mem-backend', project: 'api', kind: 'hint', text: '前端研发群里说的「后台」指订单服务', from: { actor: { source: 'feishu', id: 'ou_lina' }, triggerId: hint.id },
      at: ago(17, now), state: 'proposed' },
    { id: 'mem-settings', project: 'web', kind: 'hint', text: '「设置页」「个人主页」都属于前端 Web', from: { actor: { source: 'feishu', id: 'ou_zhangwei' }, triggerId: said.id },
      at: ago(3 * 24 * 60, now), state: 'confirmed', decidedAt: ago(3 * 24 * 60 - 30, now) },
    { id: 'mem-install', project: 'web', kind: 'workspace', text: '离线安装失败时改用联网安装', change: { bootstrap: ['pnpm install'] }, from: { ticketId: 'dark' },
      at: ago(5 * 24 * 60, now), state: 'rejected', decidedAt: ago(5 * 24 * 60 - 60, now) },
  ]
  store.set(KV.projects.memory, entries)
}
/** Places a receipt's times where the demo story puts them, since the Store stamps the time it records them. */
function patchReceipt(store: Store, id: string, at: string) {
  const db = (store as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
  db.prepare("UPDATE outbox SET value = json_patch(value, ?) WHERE id = ?").run(JSON.stringify({ queuedAt: at, sentAt: at }), id)
}

const CHATTER = ['周五下午茶吃什么？', '今天的站会挪到 3 点', '这个需求我们下周再讨论', 'LGTM', '大家注意发版窗口', '有人看到新的设计稿了吗']
/** Messages that went no further: one the Source filtered, and one an Eval judged was not work. */
function noise(store: Store, index: number, at: string) {
  const person = PEOPLE[index % PEOPLE.length]!
  const filtered = { ...trigger(`noise-f-${index}`, { ...person, id: `ou_guest${index}` }, CHATTER[index % CHATTER.length]!, at, `oc_other:om_n${index}`) }
  store.triggers.save(filtered)
  store.triggers.saveDisposition(filtered.id, { filtered: { code: 'chat_not_allowed' }, fanout: [], at })
  const chat = trigger(`noise-i-${index}`, person, CHATTER[(index + 3) % CHATTER.length]!, at, `oc_team:om_c${index}`)
  store.triggers.save(chat)
  store.decisions.save({ id: `noise-d-${index}`, evalId: `noise-e-${index}`, threadKey: `feishu:oc_team:om_c${index}`, triggerIds: [chat.id],
    policyVersion: 'demo', at, kind: 'ignore', reason: [{ code: 'said', values: { text: '闲聊，不是要做的事' } }], strength: 'inferred' })
  store.triggers.saveDisposition(chat.id, { fanout: [], decisionId: `noise-d-${index}`, at })
}

/**
 * Withdrawals as the Engine records them: the request of `table` was recalled a moment ago and waits its grace for a
 * revision; that of `export` was recalled and sent again, the revision carrying the work on.
 */
function withdrawals(store: Store, now: number) {
  const recall = (ticketId: string, minutesAgo: number) => {
    const ticket = store.tickets.get(ticketId)!
    const origin = store.triggers.get(ticket.origin.triggerId)!
    const at = ago(minutesAgo, now)
    store.triggers.save({ ...origin, text: '' })
    store.triggers.saveDisposition(origin.id, { ...store.triggers.disposition(origin.id) ?? { fanout: [], at }, retracted: { at } })
    ticket.retraction = { triggerId: origin.id, at, until: new Date(Date.parse(at) + 120_000).toISOString() }
    return { ticket, origin, at }
  }
  const pending = recall('table', 0.3)
  store.tickets.save({ ...pending.ticket, updatedAt: pending.at })
  const { ticket, origin, at } = recall('export', 40)
  const revision = trigger('demo-export-rev', PEOPLE[2]!, '@agent-bot sorry, typo: the export shows epoch numbers in the *date* and *time* columns',
    new Date(Date.parse(at) + 30_000).toISOString(), origin.threads[0]!.id)
  store.triggers.save(revision)
  store.triggers.saveDisposition(revision.id, { fanout: ['export'], acked: ['export'], at: revision.at })
  ticket.retraction = { ...ticket.retraction!, revisedBy: revision.id }
  ticket.inputs.push({ id: 'export-rev', kind: 'trigger', triggerId: revision.id, at: revision.at, human: true, readAt: revision.at,
    note: 'This message revises the request this ticket started from, which its writer withdrew.' })
  store.tickets.save(ticket)
}

export function seedDemo(store: Store, now = Date.now()) {
  store.saveSettings(SETTINGS)
  store.set(KV.sources.labels('feishu'), { oc_team: '前端研发群' })
  for (const spec of SPECS) seed(store, spec, now)
  withdrawals(store, now)
  memory(store, now)
  for (const [index, minutes] of [12, 45, 130, 260, 600, 900, 1300].entries()) noise(store, index, ago(minutes, now))
  // Proactive candidates the agent would have accepted in observe mode.
  for (const [index, minutes] of [90, 400, 2000].entries()) store.decisions.save({ id: `would-${index}`, evalId: `would-eval-${index}`,
    threadKey: 'feishu:oc_team:om_login', triggerIds: ['demo-login'], policyVersion: 'demo', at: ago(minutes, now), kind: 'ignore',
    reason: [{ code: 'said', values: { text: 'observe mode' } }], strength: 'inferred', audit: { would_accept: true } })
}

const NEW_WORK = [
  { who: 3, title: '仪表盘加载时闪烁骨架屏', ask: '@agent-bot the dashboard flashes the skeleton twice on load' },
  { who: 1, title: '通知中心「全部已读」按钮无效', ask: '@Superagent 通知中心的全部已读点了没反应' },
  { who: 4, title: '移动端底部导航遮挡输入框', ask: '@Superagent 手机上底部导航会挡住评论输入框', project: 'mobile' as const },
  { who: 0, title: '图片懒加载在 Safari 中失效', ask: '@Superagent Safari 里图片一直不加载' },
]
/**
 * One step of the simulated day, in turn: a queued Ticket starts, a working one reports a result, a reviewed one merges,
 * a person follows up, and someone asks for new work. Each step changes one Ticket the way the Engine would.
 */
export function simulate(store: Store, step: number) {
  const now = new Date().toISOString()
  const open = store.tickets.list().filter(ticket => !ticket.ended)
  const save = (ticket: Ticket) => { ticket.updatedAt = now; store.tickets.save(ticket) }
  const report = (ticket: Ticket, state: ReportState, summary: string) => {
    const assignment = ticket.assignments.at(-1)!
    if (assignment.report) assignment.earlier = [...assignment.earlier ?? [], assignment.report]
    assignment.report = { state, summary, at: now }
  }
  const reply = (ticket: Ticket, text: string, kind: 'acknowledgement' | 'reply') => {
    const message = { id: `${ticket.id}-sim-${step}`, channel: ticket.channels[0]!, text, kind, ticketId: ticket.id }
    store.receipts.add(message); store.receipts.settle(message, 'sent')
  }
  if (step % 2) noise(store, 100 + step, now)
  // A withdrawn request whose grace passed without a revision ends as its writer withdrew it, as `Tickets.retractionDue` does.
  for (const ticket of open.filter(item => item.retraction && !item.retraction.revisedBy && !item.retraction.settled && item.retraction.until <= now)) {
    ticket.retraction = { ...ticket.retraction!, settled: 'ended' }
    ticket.ended = { at: now, by: 'human', outcome: 'stopped', reason: 'retracted' }
    for (const assignment of ticket.assignments) { assignment.state = 'ended'; assignment.endedAt = now }
    save(ticket)
  }
  switch (step % 5) {
    case 0: {
      const ticket = open.find(item => item.assignments.at(-1)?.state === 'pending')
      if (!ticket) break
      ticket.assignments.at(-1)!.state = 'running'; ticket.assignments.at(-1)!.startedAt = now
      const checkout = store.get(KV.projects.workspace(ticket.id))
      if (checkout && checkout.state !== 'ready') store.set(KV.projects.workspace(ticket.id), { ...checkout, state: 'ready', at: now, step: undefined })
      report(ticket, 'progress', '正在阅读相关代码')
      reply(ticket, `好的，我来处理「${ticket.title}」。`, 'acknowledgement'); save(ticket); break
    }
    case 1: {
      const ticket = open.find(item => item.assignments.at(-1)?.report?.state === 'progress' && !item.attention)
      if (!ticket) break
      report(ticket, 'ready', '改动已自查并通过 CI，PR 等待评审。')
      reply(ticket, `「${ticket.title}」的 PR 已就绪，请评审。`, 'reply'); save(ticket); break
    }
    case 2: {
      const ticket = open.find(item => item.assignments.at(-1)?.report?.state === 'ready')
      if (!ticket) break
      ticket.assignments.at(-1)!.state = 'ended'; ticket.assignments.at(-1)!.endedAt = now
      ticket.ended = { at: now, by: 'executor', outcome: ticket.follows?.length ? 'merged' : 'completed' }
      ticket.follows = ticket.follows?.map(follow => ({ ...follow, closed: { at: now, outcome: 'merged' } })); save(ticket); break
    }
    case 3: {
      const ticket = open.find(item => item.attention)
      if (!ticket) break
      const person = PEOPLE.find(item => item.id === ticket.mandate.actor.id)!
      const follow = trigger(`sim-${step}`, person, '前端压缩吧，压到 2MB 以内再上传', now, ticket.channels[0]!.address.messageId ? `oc_team:om_${ticket.id}` : ticket.id)
      store.triggers.save(follow)
      store.triggers.saveDisposition(follow.id, { fanout: [ticket.id], acked: [ticket.id], at: now })
      ticket.inputs.push({ id: `${ticket.id}-sim-${step}`, kind: 'trigger', triggerId: follow.id, at: now, human: true, readAt: now })
      delete ticket.attention
      report(ticket, 'progress', '按回复在前端压缩图片'); save(ticket); break
    }
    case 4: {
      const next = NEW_WORK[Math.floor(step / 5) % NEW_WORK.length]!
      const spec: Spec = { id: `new-${step}`, title: next.title, who: next.who, ask: next.ask, minutes: 0, at: 'queued',
        project: 'project' in next ? next.project : next.who === 3 ? 'api' : 'web' }
      seed(store, spec, Date.now())
    }
  }
}
