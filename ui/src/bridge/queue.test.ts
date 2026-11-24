import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Event, QueueItem, QueueSnapshot } from './protocol'

// The client installs window.melo when it loads, so window exists before the import.
const fakeWindow: Window = {} as Window
vi.stubGlobal('window', fakeWindow)
let client: typeof import('./client')
beforeAll(async () => {
  client = await import('./client')
})

const item: QueueItem = { videoId: '7qQg6YbSMko', title: 'Prélude', artists: [{ name: 'Pablo Casals' }], durationSec: 149 }

describe('queue requests', () => {
  it('posts each queue method with its params', async () => {
    const snapshot: QueueSnapshot = { items: [{ id: 0, item }], index: 0, shuffle: false, repeat: 'off', autoplay: true }
    const postMessage = vi.fn().mockImplementation(({ method }) => Promise.resolve(method === 'queue.get' ? snapshot : null))
    fakeWindow.webkit = { messageHandlers: { melo: { postMessage } } }
    await expect(client.request('queue.get', {})).resolves.toEqual(snapshot)
    await expect(client.request('queue.set', { items: [item], index: 0, source: { title: 'Album', browseId: 'MPREb_1' }, continuation: 'c' })).resolves.toBeNull()
    await client.request('queue.playNext', { item })
    await client.request('queue.add', { item })
    await client.request('queue.remove', { index: 1 })
    await client.request('queue.move', { from: 2, to: 0 })
    await client.request('queue.next', {})
    await client.request('queue.previous', {})
    await client.request('queue.jump', { index: 3 })
    await client.request('queue.setShuffle', { enabled: true })
    await client.request('queue.setRepeat', { mode: 'one' })
    await client.request('queue.setAutoplay', { enabled: false })
    await client.request('queue.append', { items: [item], continuation: 'next', after: 4 })
    expect(postMessage.mock.calls.map(([message]) => message.method)).toEqual([
      'queue.get',
      'queue.set',
      'queue.playNext',
      'queue.add',
      'queue.remove',
      'queue.move',
      'queue.next',
      'queue.previous',
      'queue.jump',
      'queue.setShuffle',
      'queue.setRepeat',
      'queue.setAutoplay',
      'queue.append',
    ])
    expect(postMessage.mock.calls[1][0].params).toEqual({ items: [item], index: 0, source: { title: 'Album', browseId: 'MPREb_1' }, continuation: 'c' })
    expect(postMessage.mock.calls[12][0].params).toEqual({ items: [item], continuation: 'next', after: 4 })
  })
})

describe('queue events', () => {
  it('delivers queue.changed, queue.needsMore and queue.unplayable', () => {
    const events: Event[] = [
      { name: 'queue.changed', payload: { items: [{ id: 3, item }], index: 0, source: { title: 'Radio' }, shuffle: true, repeat: 'all', autoplay: false } },
      { name: 'queue.needsMore', payload: { videoId: '7qQg6YbSMko', continuation: 'c', after: 3 } },
      { name: 'queue.unplayable', payload: { videoId: '7qQg6YbSMko', title: 'Prélude', skipped: true } },
    ]
    for (const event of events) {
      const listener = vi.fn()
      const off = client.on(event.name, listener)
      expect(fakeWindow.melo!.emit(event)).toBe(1)
      expect(listener).toHaveBeenCalledWith(event.payload)
      off()
    }
  })
})
