import type { KeyboardEvent } from 'react'

/**
 * Moves Tab and Shift-Tab through a dialog's controls and wraps at the ends. It moves focus itself rather than
 * trapping at the edges, because WebKit's Tab skips buttons by default and would leave the dialog.
 */
export function trapFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return
  event.preventDefault()
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)')].filter((el) => el.tabIndex >= 0)
  const at = focusable.indexOf(document.activeElement as HTMLElement)
  const step = event.shiftKey ? -1 : 1
  focusable[(at + step + focusable.length) % focusable.length]?.focus()
}
