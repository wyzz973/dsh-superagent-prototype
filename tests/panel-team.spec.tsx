// @vitest-environment jsdom
// The board and the team page.
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { initials } from '../src/client/team-kit.tsx'
import { usePanel, mount, all, find, tab, click, type, text, at } from './fixtures/panel.tsx'
import { boardCard, problemOf, server, ticketSummary } from './fixtures/panel-server.ts'

usePanel()
it('opens on the board: each Ticket a card in the column of its stage, with its requester, filterable by person and title', async () => {
  const waiting = ticketSummary({ id: 't2', title: '确认按钮颜色', attention: { id: 'q', question: '用哪个蓝？' }, note: { text: '用哪个蓝？', error: false } },
    { stage: 'person', action: 'answer' })
  server.board.columns.find(column => column.id === 'person')!.cards.push(boardCard(waiting, { requester: { key: 'github:bob', source: 'github',
    id: 'bob', name: { zh: 'Bob', en: 'Bob' } } }))
  server.board.people.push({ key: 'github:bob', source: 'github', id: 'bob', name: { zh: 'Bob', en: 'Bob' } })
  await mount()
  expect(tab(zh['tab.board']).getAttribute('aria-selected')).toBe('true')
  expect(all('.dt-board-col-title').map(title => title.textContent)).toEqual(['排队', '进行中', '待人处理', '等待消息', '近 7 天完成'])
  const cards = () => all('.dt-board-card').map(card => card.querySelector('.dt-board-card-title')?.textContent)
  expect(cards()).toEqual(['修复回归', '确认按钮颜色', '旧工单'])
  // A card waiting on a person carries the question, and is marked by its stage.
  const asking = all('.dt-board-card').find(card => card.dataset.col === 'person')!
  expect(asking.dataset.state).toBe('warning')
  expect(asking.querySelector('.dt-board-card-note')?.textContent).toBe('用哪个蓝？')
  // Each card draws where it is in the journey: the asked step waits on a person, the working one is under way.
  expect(asking.querySelectorAll('.dt-chain-step[data-state="done"]').length).toBe(2)
  expect(asking.querySelector('.dt-chain-step[data-state="waiting"]')).not.toBeNull()
  await click(find('BBob1', '.dt-person-pill'))
  expect(cards()).toEqual(['确认按钮颜色'])
  await click(find(zh['board.everyone'], '.dt-person-pill'))
  await type(document.querySelector<HTMLInputElement>(`input[aria-label="${zh['board.filter']}"]`)!, '回归')
  expect(cards()).toEqual(['修复回归'])
  await click(all('.dt-board-card-title')[0]!)
  expect(tab(zh['tab.execution']).getAttribute('aria-selected')).toBe('true')
})

it('draws the engine chain above the board, each stage with what passed it, explained on hover and opening its page', async () => {
  await mount()
  expect(server.requests.some(request => request.path === 'engine?days=1')).toBe(true)
  const node = (id: string) => document.querySelector<HTMLElement>(`.dt-node[data-node="${id}"]`)!
  expect(['source', 'trigger', 'eval', 'ticket', 'executor', 'delivered', 'filtered', 'ignored', 'people']
    .map(id => node(id).querySelector('.dt-node-value')?.textContent)).toEqual(['12', '10', '6', '2', '1', '1', '2', '4', '1'])
  expect(node('source').textContent).toContain('飞书 9 · GitHub 3')
  expect(node('people').dataset.warn).toBe('true')
  expect(node('eval').dataset.active).toBe('true')
  // A line is drawn for every hand-off; one nothing passed is drawn idle, without moving dots.
  expect(all('.dt-edge').length).toBe(11)
  expect(all('.dt-edge-label').map(label => label.textContent)).toContain('后续消息直达工单 · 3')
  node('eval').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await click(node('eval'))
  expect(tab(zh['tab.eval']).getAttribute('aria-selected')).toBe('true')
  await click(tab(zh['tab.board']))
  await click(find(zh['engine.fold']))
  expect(all('.dt-strip-step').map(step => step.textContent)).toEqual(['来源12', '触发10', '评估6', '工单2', '执行器11 项等人', '交付1'])
  await click(find(zh['engine.unfold']))
  expect(document.querySelector('.dt-engine-map')).not.toBeNull()
  await click(find(zh['engine.window.week'], '[role="tab"]'))
  expect(server.requests.some(request => request.path === 'engine?days=7')).toBe(true)
})

it('marks a card whose request was withdrawn, with the time left for a revision', async () => {
  const until = new Date(Date.now() + 90_000).toISOString()
  const withdrawn = boardCard(ticketSummary({ id: 't3', title: '撤回的请求', retraction: { triggerId: 'e1', at: new Date().toISOString(), until } }))
  server.board.columns.find(column => column.id === 'working')!.cards.push(withdrawn)
  await mount()
  const card = all('.dt-board-card').find(item => item.textContent?.includes('撤回的请求'))!
  expect(card.dataset.state).toBe('warning')
  expect(card.querySelector('.dt-tag')?.textContent).toBe(zh['board.withdrawnTag'])
  expect(card.querySelector('.dt-board-card-note')?.textContent).toBe(zh['board.withdrawn.grace'])
  expect(card.querySelector('.dt-countdown')?.textContent).toMatch(/^1:(29|30)$/)
})

it('shows what stops all work above the board, with its fix', async () => {
  server.setup = { ...server.setup, problem: problemOf('agentCliUnset') }
  await mount()
  expect(document.querySelector('.dt-board-blocker')?.textContent).toContain(zh.problemSetup)
  expect(document.querySelector('.dt-board-blocker')?.textContent).toContain(zh['problemSetupFix.github'])
})

it('introduces the agent as one of the team, with the people who ask it for work, the window\'s figures and the activity', async () => {
  at({ page: 'team' })
  await mount()
  expect(document.querySelector('.dt-agent-card h3')?.textContent).toBe(`Superagent${zh['team.online']}`)
  expect(text()).toContain('以 GitHub 账号 agent-bot 行事')
  expect(all('.dt-agent-stat').map(stat => stat.textContent)).toEqual(['2进行中', '1等人处理', '314 天交付', '6累计工作'])
  expect(all('.dt-member-name').map(name => name.textContent)).toEqual(['Alice飞书'])
  expect(document.querySelector('.dt-member-waiting')?.textContent).toBe('1 项等 TA')
  expect(all('.dt-insights .dt-kpi-value').map(value => value.textContent)).toEqual(['4', '3', '1.5 小时', '67%', '67%', '2', '1'])
  expect(all('.dt-feed-line').map(line => line.textContent)).toEqual(['Alice 请智能体处理 修复回归'])
  expect(all('.dt-split-label').map(label => label.textContent)).toEqual(['飞书', 'GitHub', 'PR 已合并', '已完成', 'PR 已关闭（未合并）'])
  expect(document.querySelector('.dt-chart svg')?.getAttribute('aria-label')).toBe(zh['team.chart'])
})

it('shows the team page in English, and draws a person\'s initials from their name', async () => {
  at({ page: 'team' })
  await mount(en)
  expect(document.querySelector('.dt-intro-title')?.textContent).toBe('Team')
  expect(all('.dt-agent-stat-label').map(label => label.textContent)).toEqual(['Open', 'Waiting on people', 'Delivered in 14 d', 'All work'])
  expect([initials('张伟'), initials('欧阳娜娜'), initials('张伟', true), initials('Chen Hao'), initials('wang.fang'), initials('')])
    .toEqual(['张伟', '娜娜', '伟', 'CH', 'WF', '?'])
})
