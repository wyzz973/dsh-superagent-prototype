/**
 * Makes a ticket's checkout of its project ready: a git worktree of the person's checkout (or the project's own prepare
 * command), then what git ignores but the project needs copied from that checkout, large directories cloned copy-on-write,
 * the bootstrap commands, and the check that the checkout works. Each step reruns safely on a retry.
 */
import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Project } from '../policy.ts'
import type { WorkspaceStep } from '../app/projects.ts'

/** Runs `argv` in `cwd` as a worker would, with `env` added; resolves to its output, rejects with its error output. */
export type WorkspaceRun = (argv: string[], cwd: string, env?: Record<string, string>) => Promise<string>
/** A step of making a checkout ready failed: which, and what its command said. */
export class WorkspaceFailed extends Error {
  constructor(readonly step: WorkspaceStep, readonly output: string) { super(`The ${step} step failed: ${output}`) }
}
/** How many entries a checkout's `.worktreeinclude` may bring in. */
const INCLUDE_LIMIT = 5000
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(-4000)
async function step<T>(name: WorkspaceStep, run: () => Promise<T>): Promise<T> {
  try { return await run() } catch (error) { throw error instanceof WorkspaceFailed ? error : new WorkspaceFailed(name, message(error)) }
}

/** The revision a worktree starts from: the project's `base`, else the remote's default branch, else what the checkout has out. */
async function baseOf(project: Project, run: WorkspaceRun): Promise<string> {
  if (project.base) return project.base
  for (const candidate of ['origin/HEAD', 'HEAD']) {
    const found = await run(['git', 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], project.checkout).then(() => true, () => false)
    if (found) return candidate
  }
  return 'HEAD'
}
/** The entries a checkout's `.worktreeinclude` names that git does not track there: files it ignores that a worktree needs. */
async function included(checkout: string, run: WorkspaceRun): Promise<string[]> {
  if (!await exists(join(checkout, '.worktreeinclude'))) return []
  const listed = await run(['git', 'ls-files', '--others', '--ignored', '--directory', '--exclude-from=.worktreeinclude'], checkout)
  return listed.split('\n').map(line => line.trim().replace(/\/$/, '')).filter(Boolean).slice(0, INCLUDE_LIMIT)
}
/** Copy `entry` from the checkout unless the worktree has it already, which keeps what a retry or the worker changed. */
async function copyEntry(checkout: string, directory: string, entry: string): Promise<boolean> {
  const from = join(checkout, entry), to = join(directory, entry)
  if (!await exists(from) || await exists(to)) return false
  await mkdir(dirname(to), { recursive: true })
  await cp(from, to, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true, verbatimSymlinks: true })
  return true
}
/** Clone a directory copy-on-write where the file system can (APFS `clonefile`, a Linux reflink), else copy it. */
async function cloneEntry(checkout: string, directory: string, entry: string, run: WorkspaceRun, platform: NodeJS.Platform): Promise<boolean> {
  const from = join(checkout, entry), to = join(directory, entry)
  if (!await exists(from) || await exists(to)) return false
  await mkdir(dirname(to), { recursive: true })
  const argv = platform === 'darwin' ? ['cp', '-cR', from, to] : platform === 'linux' ? ['cp', '-R', '--reflink=auto', from, to] : undefined
  if (argv && await run(argv, directory).then(() => true, () => false)) return true
  await cp(from, to, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true, verbatimSymlinks: true })
  return true
}

export interface WorkspaceInput {
  project: Project
  /** The ticket's directory, which becomes its checkout. */
  directory: string
  /** The ticket's short name, which names its branch `superagent/<name>`. */
  name: string
  /** The execution variables, with the ticket's ports, that every command reads. */
  env: Record<string, string>
  run: WorkspaceRun
  platform?: NodeJS.Platform
  /** Called as each step starts, so the panel can show where preparation is. */
  onStep?: (step: WorkspaceStep) => void
}
/**
 * Make a ticket's checkout of its project ready, step by step; a step whose result is there already, such as the worktree on
 * a retry, is skipped, and copies never overwrite what the worktree has.
 * @returns the revision the worktree was made from, when this call made it.
 * @throws WorkspaceFailed naming the step that failed and its output.
 */
export async function prepareWorkspace(input: WorkspaceInput): Promise<{ base?: string }> {
  const { project, directory, name, env, run, platform = process.platform } = input
  const { workspace } = project
  const at = (name: WorkspaceStep) => input.onStep?.(name)
  let base: string | undefined
  if (!await exists(directory)) {
    if (project.prepare.trim()) {
      at('prepare')
      await step('prepare', () => run(['sh', '-c', project.prepare], dirname(directory), env))
    } else if (project.checkout) {
      at('worktree')
      await step('worktree', async () => {
        // A fetch brings the remote's default branch up to date when it can; a checkout without a reachable remote still works.
        await run(['git', 'fetch', '--quiet', 'origin'], project.checkout, { ...env, GIT_TERMINAL_PROMPT: '0' }).catch(() => '')
        base = await baseOf(project, run)
        // A worktree whose directory is gone, such as one a person deleted, still holds its branch until it is pruned.
        await run(['git', 'worktree', 'prune'], project.checkout).catch(() => '')
        await run(['git', 'worktree', 'add', '-B', `superagent/${name}`, directory, base], project.checkout, { ...env, GIT_TERMINAL_PROMPT: '0' })
      })
    }
    await mkdir(directory, { recursive: true })
  }
  if (project.checkout) {
    at('copy')
    await step('copy', async () => {
      const entries = [...new Set([...workspace.copy, ...await included(project.checkout, run)])]
      for (const entry of entries) await copyEntry(project.checkout, directory, entry)
    })
    if (workspace.clone.length) {
      at('clone')
      await step('clone', async () => { for (const entry of workspace.clone) await cloneEntry(project.checkout, directory, entry, run, platform) })
    }
  }
  if (workspace.bootstrap.length) {
    at('bootstrap')
    await step('bootstrap', async () => { for (const command of workspace.bootstrap) await run(['sh', '-c', command], directory, env) })
  }
  if (workspace.verify) {
    at('verify')
    await step('verify', () => run(['sh', '-c', workspace.verify], directory, env))
  }
  return base ? { base } : {}
}
