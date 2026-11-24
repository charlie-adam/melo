import { useState } from 'react'

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** A duration or easing token from tokens.css, as the Web Animations API takes it. */
export function motionToken(el: Element, name: string) {
  return getComputedStyle(el).getPropertyValue(name).trim()
}

/** A CSS time in milliseconds. The production minifier rewrites `480ms` as `.48s`, so both units come through. */
export function toMs(time: string): number {
  const value = parseFloat(time)
  return time.trim().endsWith('ms') ? value : value * 1000
}

export const ms = (el: Element, name: string) => toMs(motionToken(el, name))

/**
 * Keeps the last value mounted while it animates out: `leaving` is true from the moment `value` clears until the
 * exit animation calls `done`. A new value replaces the old one straight away.
 */
export function usePresence<T>(value: T | undefined) {
  const [shown, setShown] = useState(value)
  if (value !== undefined && value !== shown) setShown(value)
  return { shown, leaving: value === undefined && shown !== undefined, done: () => setShown(undefined) }
}
