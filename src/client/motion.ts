/**
 * Motion for the team pages: items that change place glide there (FLIP), items that arrive rise in, and figures count to
 * their new value. Every effect is skipped where the browser cannot animate or the person asked for reduced motion.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const animates = (element: Element): element is HTMLElement => typeof (element as HTMLElement).animate === 'function' && !reduced()
/**
 * Where an element sits in `root`'s layout, from offsets rather than its bounding box, so an animation still running on it
 * (a transform) does not shift the place the next one starts from.
 */
function place(element: HTMLElement, root: HTMLElement): { left: number; top: number } {
  let left = 0, top = 0, node: HTMLElement | null = element
  while (node && node !== root && root.contains(node)) { left += node.offsetLeft; top += node.offsetTop; node = node.offsetParent as HTMLElement | null }
  return { left, top }
}

/**
 * Animates the elements under `container` that carry `data-flip="<id>"`: one that moved since the last render glides from
 * its old place, one that also changed `data-flip-group` (such as a card entering another column) glows once on arrival,
 * and one that is new rises in. The first render only records places, so a page does not animate as it opens.
 */
export function useFlip(container: RefObject<HTMLElement | null>): void {
  const places = useRef<Map<string, { left: number; top: number; group: string | undefined }>>(undefined)
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const next = new Map<string, { left: number; top: number; group: string | undefined }>()
    const elements = [...root.querySelectorAll<HTMLElement>('[data-flip]')]
    let entering = 0
    for (const element of elements) {
      const id = element.dataset.flip!, rect = place(element, root), group = element.dataset.flipGroup
      next.set(id, { ...rect, group })
      const before = places.current?.get(id)
      if (!places.current || !animates(element)) continue
      if (!before) {
        element.animate([{ opacity: 0, transform: 'translateY(10px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
          { duration: 420, delay: Math.min(entering++, 6) * 50, easing: EASE, fill: 'backwards' })
        continue
      }
      const dx = before.left - rect.left, dy = before.top - rect.top
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: before.group !== group ? 620 : 360, easing: EASE })
      if (before.group !== group) element.animate([{ boxShadow: '0 0 0 0 var(--dt-glow)' }, { boxShadow: '0 0 0 6px var(--dt-glow)', offset: 0.4 },
        { boxShadow: '0 0 0 0 transparent' }], { duration: 1400, delay: 300, easing: 'ease-out' })
    }
    places.current = next
  })
}

/** A number that counts from its previous value to `value` over a short ease-out, so a changed figure is noticed. */
export function useCountUp(value: number, duration = 700): number {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = from.current
    from.current = value
    if (start === value || reduced() || typeof requestAnimationFrame !== 'function') { setShown(value); return }
    let frame = 0
    const began = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / duration), eased = 1 - (1 - progress) ** 3
      setShown(Math.round(start + (value - start) * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return shown
}

/**
 * The keys that arrived after the first render, for `hold` milliseconds after they arrived: what a live list marks as new
 * long enough for its arrival animation to play, however often the list renders meanwhile.
 */
export function useArrivals(keys: string[], hold = 4000): Set<string> {
  const arrived = useRef<Map<string, number>>(undefined)
  const now = Date.now()
  if (!arrived.current) arrived.current = new Map(keys.map(key => [key, 0]))
  else for (const key of keys) if (!arrived.current.has(key)) arrived.current.set(key, now)
  return new Set(keys.filter(key => now - arrived.current!.get(key)! < hold))
}
