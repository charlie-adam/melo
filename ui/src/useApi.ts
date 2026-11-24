import { useCallback, useEffect, useRef, useState } from 'react'
import { call } from './api/call'
import type { Raw } from './api/parse/common'
import type { ApiRequest } from './api/requests'

export interface Loaded<T> {
  data?: T
  error?: unknown
}

/** Calls `req` and parses the result, again whenever the request changes. Pass null to wait. */
export function useApi<T>(req: ApiRequest | null, parse: (raw: Raw) => T): Loaded<T> {
  const key = req && JSON.stringify(req)
  const [state, setState] = useState<Loaded<T> & { key?: string | null }>({})
  useEffect(() => {
    if (!req) return
    let live = true
    call(req).then(
      (raw) => live && setState({ key, data: parse(raw) }),
      (error: unknown) => live && setState({ key, error }),
    )
    return () => {
      live = false
    }
    // The request is compared by its JSON, and parsers are plain functions of the response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.key === key ? state : {}
}

export interface Page<T> {
  items: T[]
  continuation?: string
}

/**
 * Appends continuation pages to `first`. `more` fetches the next page; it is safe to call repeatedly, and stops when
 * the token runs out or repeats. Render a Sentinel with `more` while `token` is set.
 */
export function usePaged<T>(first: Page<T> | undefined, nextRequest: (token: string) => ApiRequest, parse: (raw: Raw) => Page<T>) {
  const [paged, setPaged] = useState({ first, items: first?.items ?? [], token: first?.continuation })
  const loading = useRef(false)
  const seen = useRef(new Set<string>())
  if (paged.first !== first) setPaged({ first, items: first?.items ?? [], token: first?.continuation })

  const { token } = paged
  const more = useCallback(() => {
    if (!token || loading.current || seen.current.has(token)) return
    loading.current = true
    seen.current.add(token)
    call(nextRequest(token))
      .then((raw) => {
        const page = parse(raw)
        setPaged((p) => (p.token === token ? { ...p, items: [...p.items, ...page.items], token: page.continuation } : p))
      })
      .catch(() => seen.current.delete(token))
      .finally(() => {
        loading.current = false
      })
    // nextRequest and parse are plain functions of the token and response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return { items: paged.items, token, more }
}
