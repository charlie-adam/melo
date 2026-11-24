import { dismissToast, useToasts } from '../toasts'
import './Toasts.css'

export function Toasts() {
  const toasts = useToasts()
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="status">
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
