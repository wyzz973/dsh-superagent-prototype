import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
// The panel imports its stylesheet as text (`?raw`), as the main build does.
const raw = { name: 'raw',
  resolveId: (source: string, importer?: string) => source.endsWith('?raw') && importer ? resolve(dirname(importer), source) : undefined,
  load: (id: string) => id.endsWith('?raw') ? { code: `export default ${JSON.stringify(readFileSync(id.slice(0, -4), 'utf8'))}`, moduleType: 'js' as const }
    : undefined }
export default defineConfig([
  { entry: { main: 'main.tsx' }, outDir: 'dist', format: 'iife', platform: 'browser', dts: false, clean: true, plugins: [raw],
    define: { 'process.env.NODE_ENV': '"production"' }, deps: { alwaysBundle: [/./] } },
  { entry: { server: 'server.ts' }, outDir: 'dist', format: 'esm', platform: 'node', dts: false, clean: false,
    deps: { neverBundle: [/^@deepseek-ai\//, 'zod', 'proper-lockfile'] } },
])
