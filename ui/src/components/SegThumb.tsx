import { useEffect, useLayoutEffect, useRef } from 'react'
import { motionToken, ms, reducedMotion } from '../motion'

interface Box {
  left: number
  width: number
}

// Where a carried thumb was when its option was clicked, for controls whose screen remounts on every choice.
const carried = new Map<string, Box>()

/**
 * The raised thumb of a `.seg` control. It sits behind the selected option and slides to the next one with a spring,
 * like a macOS segmented control. Put it inside the `.seg`; `carry` names a control that remounts on every click, so
 * the new thumb slides from where the old one was.
 */
export function SegThumb({ carry }: { carry?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const target = useRef<Box>(undefined)

  // Every render, since the selection lives in the parent: follow the selected option. A render that leaves the
  // selection where it was lets a running slide finish.
  useLayoutEffect(() => {
    const thumb = ref.current!
    const from = carry ? carried.get(carry) : target.current && visualBox(thumb)
    if (carry) carried.delete(carry)
    const to = place(thumb)
    const moved = !same(to, target.current)
    target.current = to
    if (!to || !from?.width || !moved || same(from, to) || reducedMotion()) return
    thumb.getAnimations().forEach((a) => a.cancel())
    thumb.animate([{ transform: `translateX(${from.left}px) scaleX(${from.width / to.width})` }, { transform: `translateX(${to.left}px)` }], {
      duration: ms(thumb, '--dur-pop'),
      easing: motionToken(thumb, '--spring-smooth'),
    })
  })

  // Fonts load and windows resize: keep the thumb under its option, without sliding.
  useEffect(() => {
    const thumb = ref.current!
    const seg = thumb.parentElement!
    const observer = new ResizeObserver(() => place(thumb))
    observer.observe(seg)
    const onClick = (e: MouseEvent) => {
      const option = (e.target as Element).closest('button')
      if (carry && option && option.getAttribute('aria-selected') !== 'true') carried.set(carry, visualBox(thumb))
    }
    seg.addEventListener('click', onClick)
    return () => {
      observer.disconnect()
      seg.removeEventListener('click', onClick)
    }
  }, [carry])

  return <span ref={ref} className="seg-thumb" aria-hidden="true" />
}

const same = (a?: Box, b?: Box) => a?.left === b?.left && a?.width === b?.width

function place(thumb: HTMLElement): Box | undefined {
  const selected = thumb.parentElement!.querySelector<HTMLElement>('[aria-selected="true"], [aria-checked="true"]')
  thumb.hidden = !selected
  if (!selected) return undefined
  const box = { left: selected.offsetLeft, width: selected.offsetWidth }
  thumb.style.top = `${selected.offsetTop}px`
  thumb.style.height = `${selected.offsetHeight}px`
  thumb.style.width = `${box.width}px`
  thumb.style.transform = `translateX(${box.left}px)`
  return box
}

/** Where the thumb is drawn right now, mid-slide included, relative to its control. */
function visualBox(thumb: HTMLElement): Box {
  const rect = thumb.getBoundingClientRect()
  const seg = thumb.parentElement!
  const origin = seg.getBoundingClientRect().left + seg.clientLeft
  return { left: rect.left - origin, width: rect.width }
}
