/** Shared pieces of the team pages: people's avatars, figure tiles, the page intro, and the wording of durations and shares. */
import { useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { Actor } from './api.ts'
import { Icon, InfoTip, type IconName } from './controls.tsx'
import { useCountUp } from './motion.ts'
import { actorName, type T } from './text.ts'

/** A stable hue per person, so the same person keeps one color on every page. */
const hue = (key: string): number => [...key].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 360, 7)
const CJK = /[㐀-鿿]/
/** The letters an avatar shows: a Chinese name's last characters (one on a small avatar), otherwise the initials of the first two words. */
export function initials(name: string, small = false): string {
  const text = name.trim()
  if (!text) return '?'
  if (CJK.test(text)) return [...text.replace(/\s+/g, '')].slice(small ? -1 : -2).join('')
  return text.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(word => word[0]!.toUpperCase()).join('')
}
export function Avatar({ actor, id, t, size = 'md' }: { actor: Actor | undefined; id: string; t: T; size?: 'sm' | 'md' | 'lg' }) {
  const name = actorName(t, actor)
  return <span className="dt-avatar" data-size={size} style={{ '--dt-hue': hue(id) } as CSSProperties} title={name} aria-hidden="true">
    {initials(name, size === 'sm')}
  </span>
}
export function AgentAvatar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className="dt-avatar dt-avatar-agent" data-size={size} aria-hidden="true">
    <Icon name="bot" size={size === 'lg' ? 26 : size === 'sm' ? 13 : 16} />
  </span>
}
export function PageIntro({ title, text, icon, children }: { title: string; text: string; icon: IconName; children?: ReactNode }) {
  return <div className="dt-intro">
    <span className="dt-intro-icon"><Icon name={icon} size={18} /></span>
    <div className="dt-intro-text"><h2 className="dt-intro-title">{title}</h2><p className="dt-hint">{text}</p></div>
    {children}
  </div>
}
/**
 * A figure tile: its label, its value, and below them what gives the value its context: a daily trend as a sparkline, a share as a
 * meter against the whole, or a short note.
 */
export function Kpi({ label, value, sub, hint, tone, trend, share }: { label: string; value: ReactNode; sub?: ReactNode; hint?: string
  tone?: 'warning'; trend?: number[]; share?: number | undefined }) {
  return <div className="dt-kpi" data-tone={tone}>
    <span className="dt-kpi-label">{label}{hint && <InfoTip text={hint} />}</span>
    <span className="dt-kpi-value">{value}</span>
    {trend && trend.length > 1 && <Spark values={trend} />}
    {share !== undefined && <span className="dt-kpi-meter" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, Math.max(0, share))})` }} /></span>}
    {sub && <span className="dt-kpi-sub">{sub}</span>}
  </div>
}
/**
 * A trend line for a tile, drawn in the quiet hue with today's point marked. It stretches to the tile's width, so its stroke keeps
 * its weight however wide the tile is, and the end dot is placed in the tile's own units rather than the stretched drawing's.
 */
export function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values), last = values.length - 1
  const y = (value: number) => 22 - value / max * 20
  const line = values.map((value, index) => `${index ? 'L' : 'M'}${index / last * 100},${y(value)}`).join(' ')
  return <span className="dt-spark" aria-hidden="true">
    <svg viewBox="0 0 100 24" preserveAspectRatio="none">
      <path className="dt-spark-area" d={`${line} L100,24 L0,24 Z`} />
      <path className="dt-spark-line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
    <span className="dt-spark-dot" style={{ top: `${y(values[last]!) / 24 * 100}%` }} />
  </span>
}
/** The size an element lays out at, kept current as it resizes; `fallback` until it is measured or where it cannot be. */
export function useSize(ref: RefObject<HTMLElement | null>, fallback: { width: number; height: number }): { width: number; height: number } {
  const [size, setSize] = useState(fallback)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element
      if (width && height) setSize(current => current.width === width && current.height === height ? current : { width, height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}
/** A duration in the largest unit that keeps it readable: minutes below an hour, hours below two days, then days. */
export function duration(t: T, ms: number | undefined): string {
  if (ms === undefined) return t('empty')
  const minutes = ms / 60_000
  if (minutes < 60) return t('duration.minutes', { n: Math.max(1, Math.round(minutes)) })
  const hours = minutes / 60
  if (hours < 48) return t('duration.hours', { n: Math.round(hours * 10) / 10 })
  return t('duration.days', { n: Math.round(hours / 24 * 10) / 10 })
}
export const percent = (t: T, share: number | undefined): string => share === undefined ? t('empty') : `${Math.round(share * 100)}%`
/** A whole number that counts to its new value when it changes. */
export function Count({ value }: { value: number }) {
  return <>{useCountUp(value)}</>
}
