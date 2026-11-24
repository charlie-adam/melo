import { useState } from 'react'
import { dismissToast, useToasts, type Toast } from '../toasts'
import './Toasts.css'

interface Shown extends Toast {
  leaving?: boolean
}

/** Keeps dismissed toasts in place, marked leaving, until their fade ends. */
function merge(shown: Shown[], toasts: Toast[]): Shown[] {
  const live = new Set(toasts.map((t) => t.id))
  const kept = shown.map((t) => (live.has(t.id) ? t : { ...t, leaving: true }))
  const known = new Set(shown.map((t) => t.id))
  return [...kept, ...toasts.filter((t) => !known.has(t.id))]
}

export function Toasts() {
  const toasts = useToasts()
  const [seen, setSeen] = useState(toasts)
  const [shown, setShown] = useState<Shown[]>(toasts)
  if (seen !== toasts) {
    setSeen(toasts)
    setShown(merge(shown, toasts))
  }
  return (
    <div className="toasts" aria-live="polite">
      {shown.map((t) => (
        <div
          key={t.id}
          className={t.leaving ? 'toast leaving' : 'toast'}
          role="status"
          onAnimationEnd={(e) => t.leaving && e.target === e.currentTarget && setShown((all) => all.filter((s) => s.id !== t.id))}
        >
          <span className="toast-text">{t.text}</span>
          <button
            type="button"
            onClick={() => {
              t.action?.run()
              dismissToast(t.id)
            }}
          >
            {t.action?.label ?? 'OK'}
          </button>
        </div>
      ))}
    </div>
  )
}
