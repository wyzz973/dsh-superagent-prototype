/** Execution environment variables exposed to prepare commands and documented in worker Session instructions; never contains credentials. */
import { join } from 'node:path'
import type { Ticket, Trigger } from '../core/index.ts'
import type { Deployment } from '../deployment.ts'
import type { Project, Settings } from '../policy.ts'
import type { Localized, VariableSpec } from '../sources/kind.ts'
import type { SourceRegistry } from '../sources/registry.ts'

/** Variables registered by the Executor; `ticket` entries are populated only when a ticket is present. */
export const EXECUTOR_VARIABLES: readonly (VariableSpec & { ticket?: true })[] = [
  { key: 'DSH_SUPERAGENT_DIR', ticket: true, description: { zh: '这个工单的执行目录；执行器 Session 在其中工作', en: 'This ticket\'s directory; the executor Session works in it' } },
  { key: 'DSH_SUPERAGENT_NAME', ticket: true, description: { zh: '工单的短名，也是执行目录的名字', en: 'The ticket\'s short name, also its directory\'s name' } },
  { key: 'DSH_SUPERAGENT_TICKET', ticket: true, description: { zh: '工单 id', en: 'The ticket id' } },
  { key: 'DSH_SUPERAGENT_PROJECT', ticket: true, description: { zh: '工单所属项目的 id', en: 'The ticket\'s project id' } },
  { key: 'DSH_SUPERAGENT_CHECKOUT', ticket: true, description: { zh: '项目的源 checkout，执行目录是它的 worktree；不要改动它', en: 'The project\'s checkout, of which this directory is a worktree; never change it' } },
  { key: 'DSH_SUPERAGENT_BLOCKED_COMMANDS', description: { zh: '这个执行环境禁止调用的命令，以空格分隔；不要运行它们', en: 'Commands blocked in this execution environment, separated by spaces; never run them' } },
]
export interface Variable { key: string; value: string; description: Localized; owner: string }

export const executionRoot = (settings: Settings, stateDir: string): string => settings.executor.directory || join(stateDir, 'work')

/** Lists all declared variables grouped by owner; `enabled` is false for Sources that are currently switched off. */
export function declaredVariables(sources: SourceRegistry, settings?: Settings): { owner: string; enabled: boolean; variables: readonly VariableSpec[] }[] {
  const on = new Set(sources.environments(settings).map(item => item.kind.kind))
  return [{ owner: 'executor', enabled: true, variables: EXECUTOR_VARIABLES },
    ...sources.declarations().map(({ kind, variables }) => ({ owner: kind, enabled: on.has(kind), variables }))]
}

/** The name of the variable holding a ticket's port for `name`, such as `DSH_SUPERAGENT_PORT_WEB`. */
export const portVariable = (name: string): string => `DSH_SUPERAGENT_PORT_${name.toUpperCase()}`
export function environmentOf(input: { deployment: Deployment; sources: SourceRegistry; settings: Settings; ticket?: { id: string; name: string; directory: string }; trigger?: Trigger
  project?: Project; ports?: Record<string, number> }): Variable[] {
  const { deployment, sources, settings, ticket, trigger, project, ports = {} } = input
  const executor: Record<string, string> = { DSH_SUPERAGENT_BLOCKED_COMMANDS: settings.executor.blockedCommands.join(' '), ...ticket ? { DSH_SUPERAGENT_DIR: ticket.directory, DSH_SUPERAGENT_NAME: ticket.name, DSH_SUPERAGENT_TICKET: ticket.id,
    DSH_SUPERAGENT_PROJECT: project?.id ?? '', DSH_SUPERAGENT_CHECKOUT: project?.checkout ?? '' } : {} }
  const result: Variable[] = EXECUTOR_VARIABLES.filter(spec => !spec.ticket || ticket).map(spec => ({ key: spec.key, value: executor[spec.key] ?? '', description: spec.description, owner: 'executor' }))
  // A ticket's own ports, one variable each, so its servers never collide with another ticket's or a person's.
  if (ticket) for (const [name, port] of Object.entries(ports)) result.push({ key: portVariable(name), value: String(port), owner: 'executor',
    description: { zh: `这个工单专用的 ${name} 端口；在这个端口上启动 ${name}，不要用默认端口`, en: `This ticket's own port for ${name}; serve ${name} on it, never on its default port` } })
  for (const { kind, environment, config } of sources.environments(settings)) {
    const values = environment.values({ deployment, config, ...trigger ? { trigger } : {} })
    for (const spec of environment.variables) result.push({ key: spec.key, value: values[spec.key] ?? '', description: spec.description, owner: kind.kind })
  }
  return result
}

/** Combines a ticket's fixed directory, name, and origin trigger with the deployment's current settings. */
export function ticketEnvironment(input: { deployment: Deployment; sources: SourceRegistry; settings: Settings; ticket: Ticket; trigger?: Trigger
  project?: Project; ports?: Record<string, number> }) {
  const { ticket, trigger, ...rest } = input
  const values = { id: ticket.id, name: ticket.execution?.name ?? '', directory: ticket.execution?.directory ?? '' }
  return environmentOf({ ...rest, ticket: values, ...trigger ? { trigger } : {} })
}
export function environmentLines(variables: Variable[]): string {
  return variables.map(variable => `- ${variable.key} = ${JSON.stringify(variable.value)}: ${variable.description.en}.`).join('\n')
}
