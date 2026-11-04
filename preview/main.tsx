/** Preview entry: mounts the panel as DeepSeek Harness would, with a language and theme switch for the reviewer. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../src/client/app.tsx'
import { usePageForm } from '../src/client/deployment.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { T } from '../src/client/text.ts'

const translator = (dictionary: Record<string, string>): T => ((key: string, params?: Record<string, unknown>) => {
  const template = dictionary[key] ?? key
  return params ? template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match) : template
}) as T
const search = new URLSearchParams(location.search)
if (search.get('theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', '')

function Preview() {
  const [lang, setLang] = useState(search.get('lang') === 'en' ? 'en' : 'zh')
  const [dark, setDark] = useState(search.get('theme') === 'dark')
  const toggleTheme = () => {
    document.body.toggleAttribute('data-ds-dark-theme', !dark); setDark(!dark)
  }
  return <>
    <div className="preview-bar">
      <span>预览 · Preview</span>
      <button type="button" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>{lang === 'zh' ? 'English' : '中文'}</button>
      <button type="button" onClick={toggleTheme}>{dark ? '☀︎' : '☾'}</button>
    </div>
    <App key={lang} t={translator(lang === 'en' ? en : zh)} openSession={async () => {}} deploymentForm={usePageForm(undefined)} />
  </>
}
createRoot(document.getElementById('root')!).render(<Preview />)
