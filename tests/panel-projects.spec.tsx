// @vitest-environment jsdom
// The projects page, a card's project and checkout on the board, and moving a ticket to another project.
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { usePanel, mount, all, find, tab, click, type, text, at } from './fixtures/panel.tsx'
import { boardCard, memoryEntry, projectCard, server, ticketSummary } from './fixtures/panel-server.ts'

usePanel()
it('leads with the memory waiting for a person, each with who taught it, and confirming one applies it', async () => {
  at({ page: 'projects' })
  await mount()
  expect(tab(zh['tab.projects']).getAttribute('aria-selected')).toBe('true')
  const waiting = () => all('.dt-memory[data-state="proposed"]')
  expect(waiting().map(card => card.querySelector('.dt-memory-text')?.textContent)).toEqual(['缺 REDIS_URL 时冒烟测试失败', '研发群里说的「后台」指订单服务'])
  // A workspace change shows the lines it adds; a hint shows whose message it came from.
  expect(all('.dt-change-lines li').map(line => line.textContent)).toEqual(['+复制配置.env.redis'])
  expect(waiting()[1]!.querySelector('.dt-memory-from')?.textContent).toContain('Alice 说过')
  await click(find(zh['projects.memory.apply']))
  expect(server.requests.some(request => request.method === 'POST' && request.path === 'projects/memory/m1/confirm')).toBe(true)
  expect(waiting()).toHaveLength(1)
  await click(find(zh['projects.memory.history'].replace('{count}', '1')))
  expect(all('.dt-memory[data-state="confirmed"] .dt-tag').map(tag => tag.textContent)).toContain(zh['projects.memory.state.confirmed'])
})

it('shows each project\'s checkout, bound chats by name, work by stage, its recipe and a checkout that failed its check', async () => {
  at({ page: 'projects' })
  await mount()
  const card = document.querySelector<HTMLElement>('.dt-project')!
  expect(card.dataset.problem).toBe('true')
  expect(card.querySelector('.dt-project-title h3')?.textContent).toBe('订单服务orders')
  expect(card.querySelector('.dt-project-facts dd.dt-mono')?.textContent).toBe('/Users/alice/code/orders')
  expect(all('.dt-binding').map(binding => binding.textContent)).toEqual(['飞书研发群'])
  expect(all('.dt-project-legend b').map(count => count.textContent)).toEqual(['0', '1', '1', '0'])
  expect(all('.dt-recipe-step').map(step => step.dataset.on === 'true')).toEqual([true, true, true, true, true])
  const failed = card.querySelector<HTMLElement>('.dt-checkout[data-state="failed"]')!
  expect(failed.querySelector('.dt-checkout-step')?.textContent).toBe('失败于「自检」')
  expect(failed.querySelector('pre')?.textContent).toBe('Error: REDIS_URL is not set')
  expect(all('.dt-port').map(port => port.textContent)).toEqual(['web20000', 'web20010'])
})

it('adds a project through the editor, which checks its fields before it saves the whole list', async () => {
  at({ page: 'projects' })
  await mount()
  await click(find(zh['projects.add']))
  const input = (placeholder: string) => document.querySelector<HTMLInputElement>(`.dt-project-editor input[placeholder="${placeholder}"]`)!
  await type(input('order-service'), 'Web App')
  await click(find(zh.save))
  expect(all('.dt-project-editor .dt-error-text').map(error => error.textContent)).toEqual([zh['projects.form.required'], zh['projects.form.idInvalid']])
  expect(server.requests.some(request => request.method === 'PUT')).toBe(false)
  await type(input('order-service'), 'web')
  await type(input(zh['projects.form.namePlaceholder']), '前端')
  await type(input('/Users/me/code/order-service'), '/Users/alice/code/web')
  await type(document.querySelector<HTMLTextAreaElement>('.dt-project-editor textarea')!, 'feishu:oc_web')
  await click(find(zh.save))
  const saved = server.requests.find(request => request.method === 'PUT')!
  expect(saved.path).toBe('settings/projects')
  expect(saved.body).toMatchObject({ revision: 2, value: { projects: [expect.objectContaining({ id: 'orders' }),
    expect.objectContaining({ id: 'web', name: '前端', checkout: '/Users/alice/code/web', bindings: ['feishu:oc_web'] })] } })
  expect(document.querySelector('.dt-project-editor')).toBeNull()
  expect(all('.dt-project-title h3').map(title => title.textContent)).toEqual(['订单服务orders', '前端web'])
})

it('explains projects when there are none', async () => {
  server.projects = { ...server.projects, projects: [], memory: [] }
  at({ page: 'projects' })
  await mount(en)
  expect(document.querySelector('.dt-project-empty h3')?.textContent).toBe('No projects yet')
  expect(all('.dt-project-empty-steps b').map(step => step.textContent)).toEqual(['Point at your checkout', 'Bind conversations', 'Write its recipe'])
})

it('marks a card\'s project and a checkout that failed, and filters the board by project', async () => {
  const failed = boardCard(ticketSummary({ id: 't5', title: '订单分页 500' }), { project: { id: 'orders', name: '订单服务' },
    workspace: { state: 'failed', at: '2026-09-23T00:00:00Z', step: 'verify', output: 'REDIS_URL is not set' } })
  const web = boardCard(ticketSummary({ id: 't6', title: '登录页样式' }), { project: { id: 'web', name: '前端' } })
  server.board.columns.find(column => column.id === 'working')!.cards.push(failed, web)
  server.board.projects = [{ id: 'orders', name: '订单服务' }, { id: 'web', name: '前端' }]
  await mount()
  const card = all('.dt-board-card').find(item => item.textContent?.includes('订单分页 500'))!
  expect(card.querySelector('.dt-board-project')?.textContent).toBe('订单服务')
  expect([...card.querySelectorAll('.dt-tag')].map(tag => tag.textContent)).toContain(zh['board.workspaceFailed'])
  expect(card.querySelector('.dt-board-card-note')?.textContent).toBe('环境准备失败于「自检」，修好后重试工单')
  await click(find('前端', '.dt-person-pill'))
  expect(all('.dt-board-card-title').map(title => title.textContent)).toEqual(['登录页样式'])
})

it('moves an open ticket to another project from its page, and shows why its checkout failed', async () => {
  server.ticketDetails.t1 = { ...server.ticketDetails.t1!, project: { id: 'orders', name: '订单服务' },
    workspace: { state: 'failed', at: '2026-09-23T00:00:00Z', step: 'bootstrap', output: 'make deps: no such target' },
    projects: [{ id: 'orders', name: '订单服务' }, { id: 'web', name: '前端' }] }
  server.projects = { ...server.projects, projects: [projectCard(), projectCard({ id: 'web', name: '前端' })] }
  at({ page: 'execution', id: 't1' })
  await mount()
  expect(document.querySelector('.dt-workspace-banner .dt-banner-label')?.textContent).toBe('环境准备失败于「引导命令」')
  expect(document.querySelector('.dt-workspace-banner pre')?.textContent).toBe('make deps: no such target')
  await type(document.querySelector<HTMLSelectElement>(`select[aria-label="${zh['ticket.moveProject']}"]`)!, 'web')
  expect(server.requests.find(request => request.method === 'POST' && request.path === 'tickets/t1/project')?.body).toEqual({ project: 'web' })
  expect(server.moved).toEqual({ t1: 'web' })
  expect(text()).toContain(zh['ticket.project'])
})

it('lists a proposed change by the lines it adds and the check it replaces', async () => {
  server.projects = { ...server.projects, memory: [memoryEntry({ change: { copy: ['.env.sandbox'], bootstrap: ['make deps'], verify: 'make check', ports: ['grpc'] } })] }
  at({ page: 'projects' })
  await mount()
  expect(all('.dt-change-lines li').map(line => [line.dataset.kind, line.textContent])).toEqual([['add', '+复制配置.env.sandbox'],
    ['add', '+引导命令make deps'], ['set', '→自检make check'], ['add', '+端口grpc']])
})
