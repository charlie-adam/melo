import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The client installs window.melo when it loads, so window exists before the import.
const fakeWindow: Window = {} as Window
vi.stubGlobal('window', fakeWindow)
let client: typeof import('./client')
beforeAll(async () => {
  client = await import('./client')
})

beforeEach(() => {
  delete fakeWindow.webkit
})

describe('request', () => {
  it('posts { method, params } and resolves with the reply', async () => {
    const postMessage = vi.fn().mockResolvedValue({ receivedAt: 42 })
    fakeWindow.webkit = { messageHandlers: { melo: { postMessage } } }
    await expect(client.request('ping', { sentAt: 1 })).resolves.toEqual({ receivedAt: 42 })
    expect(postMessage).toHaveBeenCalledWith({ method: 'ping', params: { sentAt: 1 } })
  })

  it('rejects with the error Swift replies with', async () => {
    const postMessage = vi.fn().mockRejectedValue(new Error('Unknown method'))
    fakeWindow.webkit = { messageHandlers: { melo: { postMessage } } }
    await expect(client.request('ping', { sentAt: 1 })).rejects.toThrow('Unknown method')
  })

  // Sign-in and InnerTube.
  it('sends auth requests with empty params', async () => {
    const postMessage = vi.fn().mockResolvedValue({ signedIn: true, expired: false })
    fakeWindow.webkit = { messageHandlers: { melo: { postMessage } } }
    for (const method of ['auth.status', 'auth.signIn', 'auth.signOut'] as const) {
      await expect(client.request(method, {})).resolves.toEqual({ signedIn: true, expired: false })
      expect(postMessage).toHaveBeenLastCalledWith({ method, params: {} })
    }
  })

  it('posts api.call and resolves with raw JSON or a typed error', async () => {
    const postMessage = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: { contents: {} } })
      .mockResolvedValueOnce({ ok: false, error: { kind: 'auth', status: 401 } })
    fakeWindow.webkit = { messageHandlers: { melo: { postMessage } } }
    const params = { endpoint: 'browse', body: { browseId: 'FEmusic_home' } } as const
    await expect(client.request('api.call', params)).resolves.toEqual({ ok: true, json: { contents: {} } })
    expect(postMessage).toHaveBeenCalledWith({ method: 'api.call', params })
    const failed = await client.request('api.call', params)
    expect(failed.ok || failed.error).toEqual({ kind: 'auth', status: 401 })
  })

  it('rejects outside the app', async () => {
    await expect(client.request('ping', { sentAt: 1 })).rejects.toThrow('Not running inside Melo')
  })
})

describe('events', () => {
  it('delivers auth.changed with the expired flag', () => {
    const listener = vi.fn()
    const off = client.on('auth.changed', listener)
    fakeWindow.melo!.emit({ name: 'auth.changed', payload: { signedIn: true, expired: true } })
    expect(listener).toHaveBeenCalledWith({ signedIn: true, expired: true })
    off()
  })

  it('delivers emitted events to listeners and reports how many ran', () => {
    const listener = vi.fn()
    const off = client.on('auth.changed', listener)
    expect(fakeWindow.melo!.emit({ name: 'auth.changed', payload: { signedIn: true, expired: false } })).toBe(1)
    expect(listener).toHaveBeenCalledWith({ signedIn: true, expired: false })
    off()
    expect(fakeWindow.melo!.emit({ name: 'auth.changed', payload: { signedIn: false, expired: false } })).toBe(0)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
