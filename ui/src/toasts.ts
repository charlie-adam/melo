import { createStore, useStore } from './store'

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

const toasts = createStore<Toast[]>([])
let nextId = 1

export function dismissToast(id: number) {
  toasts.set(toasts.get().filter((t) => t.id !== id))
}

/** Shows a short message above the player bar for five seconds. */
export function toast(text: string, action?: Toast['action']) {
  const id = nextId++
  toasts.set([...toasts.get(), { id, text, action }].slice(-3))
  setTimeout(() => dismissToast(id), 5000)
}

export const useToasts = () => useStore(toasts)
