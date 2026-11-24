import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { PlayerState } from './protocol'

// The client installs window.melo when it loads, so window exists before the import.
const fakeWindow: Window = {} as Window
vi.stubGlobal('window', fakeWindow)
let client: typeof import('./client')
beforeAll(async () => {
  client = await import('./client')
})

describe('player requests', () => {
  it('posts each player method with its params', async () => {
    const postMessage = vi.fn().mockResolvedValue(null)
    fakeWindow.webkit = { messageHandlers: { melo: { postMessage } } }
    await expect(client.request('player.play', {})).resolves.toBeNull()
    await client.request('player.pause', {})
    await client.request('player.toggle', {})
    await client.request('player.seek', { seconds: 30 })
    await client.request('player.setVolume', { volume: 0.5 })
    await client.request('player.load', { videoId: '7qQg6YbSMko', playlistId: 'PL1', index: 2 })
    await client.request('player.get', {})
    expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
      { method: 'player.play', params: {} },
      { method: 'player.pause', params: {} },
      { method: 'player.toggle', params: {} },
      { method: 'player.seek', params: { seconds: 30 } },
      { method: 'player.setVolume', params: { volume: 0.5 } },
      { method: 'player.load', params: { videoId: '7qQg6YbSMko', playlistId: 'PL1', index: 2 } },
      { method: 'player.get', params: {} },
    ])
  })
})

describe('player.state', () => {
  it('delivers the payload to listeners', () => {
    const state: PlayerState = { status: 'ended', videoId: '7qQg6YbSMko', currentTime: 149, duration: 149, volume: 1, isAd: false }
    const listener = vi.fn()
    const off = client.on('player.state', listener)
    expect(fakeWindow.melo!.emit({ name: 'player.state', payload: state })).toBe(1)
    expect(listener).toHaveBeenCalledWith(state)
    off()
  })
})
