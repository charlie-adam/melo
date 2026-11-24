import { useEffect, useRef } from 'react'

/** Calls `onVisible` when it scrolls within 600px of view, to load the next page. */
export function Sentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onVisible(), { rootMargin: '600px' })
    observer.observe(ref.current!)
    return () => observer.disconnect()
  }, [onVisible])
  return <div ref={ref} aria-hidden="true" style={{ height: 1 }} />
}
