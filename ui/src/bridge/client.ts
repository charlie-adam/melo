import type { Event, EventName, Events, Method, Request, Requests } from './protocol'

interface ReplyHandler {
  postMessage(message: Request): Promise<unknown>
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { melo?: ReplyHandler } }
    melo?: { emit(event: Event): number }
  }
}

/** Sends a request to Swift. Rejects outside the app, or with the error Swift replies with. */
export function request<M extends Method>(method: M, params: Requests[M]['params']): Promise<Requests[M]['result']> {
  const handler = window.webkit?.messageHandlers?.melo
  if (!handler) return Promise.reject(new Error('Not running inside Melo'))
  return handler.postMessage({ method, params } as Request) as Promise<Requests[M]['result']>
}

type Listener = (payload: never) => void
const listeners = new Map<EventName, Set<Listener>>()

/** Subscribes to an event from Swift and returns the unsubscribe function. */
export function on<N extends EventName>(name: N, listener: (payload: Events[N]) => void): () => void {
  const set = listeners.get(name) ?? new Set()
  listeners.set(name, set)
  set.add(listener)
  return () => set.delete(listener)
}

// Swift calls this. It returns how many listeners ran, which the shell logs.
window.melo = {
  emit(event) {
    const set = listeners.get(event.name) ?? new Set()
    for (const listener of set) (listener as (payload: Event['payload']) => void)(event.payload)
    return set.size
  },
}
