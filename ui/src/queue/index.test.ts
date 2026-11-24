import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '../api/models'
import type { Events, QueueSnapshot } from '../bridge/protocol'

type Listener = (payload: unknown) => void
const listeners = new Map<string, Listener>()
const request = vi.fn((method: string, params: unknown): Promise<unknown> => Promise.resolve(method === 'queue.get' ? snapshot : params && null))
vi.mock('../bridge/client', () => ({
  request: (method: string, params: unknown) => request(method, params),
  on: (name: string, listener: Listener) => (listeners.set(name, listener), () => {}),
}))
vi.mock('react', () => ({ useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }))
const toast = vi.fn()
vi.mock('../toasts', () => ({ toast: (text: string) => toast(text) }))
const call = vi.fn()
vi.mock('../api/call', () => ({ call: (req: unknown) => call(req) }))

const song = (videoId: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song',
  videoId,
  title: `Title ${videoId}`,
  artists: [{ name: 'Artist', browseId: 'UC1' }],
  thumbnails: [{ url: `https://i.ytimg.com/${videoId}.jpg`, width: 120 }],
  explicit: false,
  isVideo: false,
  playable: true,
  ...extra,
})

let snapshot: QueueSnapshot = { items: [], index: -1, shuffle: false, repeat: 'off', autoplay: true }
let q: typeof import('./index')

function emit<N extends keyof Events>(name: N, payload: Events[N]) {
  listeners.get(name)!(payload)
}

const calls = (method: string) => request.mock.calls.filter(([m]) => m === method).map(([, params]) => params)

beforeEach(async () => {
  vi.resetModules()
  request.mockClear()
  toast.mockClear()
  call.mockReset()
  listeners.clear()
  snapshot = { items: [], index: -1, shuffle: false, repeat: 'off', autoplay: true }
  q = await import('./index')
})

describe('requests', () => {
  it('sends queue.set with display items and the source as a title and browse id', () => {
    q.playSongs([song('a', { album: { name: 'OK Computer', browseId: 'MPREb_1' }, durationSec: 200 }), song('b')], 1, {
      label: 'OK Computer',
      route: { name: 'album', browseId: 'MPREb_1' },
    })
    expect(calls('queue.set')).toEqual([
      {
        items: [
          { videoId: 'a', title: 'Title a', artists: [{ name: 'Artist', browseId: 'UC1' }], isVideo: false, album: { name: 'OK Computer', browseId: 'MPREb_1' }, durationSec: 200, thumbnailUrl: 'https://i.ytimg.com/a.jpg' },
          { videoId: 'b', title: 'Title b', artists: [{ name: 'Artist', browseId: 'UC1' }], isVideo: false, thumbnailUrl: 'https://i.ytimg.com/b.jpg' },
        ],
        index: 1,
        source: { title: 'OK Computer', browseId: 'MPREb_1' },
      },
    ])
  })

  it('maps each control to its request', () => {
    q.playNext(song('n'))
    q.addToQueue(song('z'))
    q.next()
    q.previous()
    q.jump(3)
    q.remove(2)
    q.move(4, 1)
    q.toggleShuffle()
    q.cycleRepeat()
    q.setAutoplay(false)
    expect(request.mock.calls.slice(1).map(([method, params]) => [method, params])).toEqual([
      ['queue.playNext', { item: expect.objectContaining({ videoId: 'n' }) }],
      ['queue.add', { item: expect.objectContaining({ videoId: 'z' }) }],
      ['queue.next', {}],
      ['queue.previous', {}],
      ['queue.jump', { index: 3 }],
      ['queue.remove', { index: 2 }],
      ['queue.move', { from: 4, to: 1 }],
      ['queue.setShuffle', { enabled: true }],
      ['queue.setRepeat', { mode: 'all' }],
      ['queue.setAutoplay', { enabled: false }],
    ])
  })

  it('starts radio with its continuation', async () => {
    const { fixture } = await import('../api/fixture')
    call.mockResolvedValue(fixture('next-radio'))
    await q.startRadio('abc')
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'next', body: expect.objectContaining({ playlistId: 'RDAMVMabc' }) }))
    const [params] = calls('queue.set') as { items: unknown[]; index: number; source: unknown; continuation?: string }[]
    expect(params.items.length).toBeGreaterThan(0)
    expect(params.index).toBe(0)
    expect(params.source).toEqual({ title: 'Radio' })
    expect(params.continuation).toEqual(expect.any(String))
  })
})

describe('snapshots', () => {
  const items = ['a', 'b', 'c'].map((id, i) => ({ id: i + 10, item: { videoId: id, title: `Saved ${id}`, artists: [], thumbnailUrl: `https://i.ytimg.com/${id}.jpg` } }))

  it('asks for the current snapshot on load', async () => {
    snapshot = { items, index: 1, source: { title: 'Mix' }, shuffle: true, repeat: 'one', autoplay: false }
    vi.resetModules()
    q = await import('./index')
    await Promise.resolve()
    const view = q.useQueue()
    expect(view.current?.title).toBe('Saved b')
    expect(view.upNext.map((s) => s.videoId)).toEqual(['c'])
    expect(view).toMatchObject({ index: 1, upNextIds: [12], source: { label: 'Mix' }, shuffle: true, repeat: 'one', autoplay: false })
  })

  it('keeps the full song the UI queued, and rebuilds one only it saved', () => {
    const liked = song('a', { likeStatus: 'LIKE', explicit: true })
    q.playSongs([liked], 0)
    emit('queue.changed', { items, index: 0, source: { title: 'OK Computer', browseId: 'MPREb_1' }, shuffle: false, repeat: 'off', autoplay: true })
    const view = q.useQueue()
    expect(view.current).toBe(liked)
    expect(view.upNext[0]).toEqual({ kind: 'song', videoId: 'b', title: 'Saved b', artists: [], thumbnails: [{ url: 'https://i.ytimg.com/b.jpg' }], explicit: false, isVideo: false, playable: true })
    expect(view.source).toEqual({ label: 'OK Computer', route: { name: 'album', browseId: 'MPREb_1' } })
  })

  it('routes sources by browse id prefix', () => {
    for (const [browseId, name] of [['VLPL1', 'playlist'], ['UC1', 'artist'], ['MPREb_2', 'album']] as const) {
      emit('queue.changed', { items, index: 0, source: { title: 'X', browseId }, shuffle: false, repeat: 'off', autoplay: true })
      expect(q.useQueue().source?.route).toEqual({ name, browseId })
    }
  })
})

describe('events', () => {
  it('toasts unplayable songs', () => {
    emit('queue.unplayable', { videoId: 'a', title: 'Paranoid Android', skipped: true })
    emit('queue.unplayable', { videoId: 'b', title: 'Airbag', skipped: false })
    expect(toast.mock.calls).toEqual([["Paranoid Android can't be played here, so it was skipped."], ["Airbag can't be played here."]])
  })

  it('fetches radio for needsMore and appends it after the same entry', async () => {
    const { fixture } = await import('../api/fixture')
    call.mockResolvedValueOnce(fixture('next-radio')).mockResolvedValueOnce(fixture('next-radio-continuation'))
    await q.fetchMore({ videoId: 'seed', after: 7 })
    expect(call.mock.calls[0][0]).toMatchObject({ endpoint: 'next', body: { videoId: 'seed', playlistId: 'RDAMVMseed' } })
    const [first] = calls('queue.append') as { items: { videoId: string }[]; continuation?: string; after: number }[]
    expect(first.after).toBe(7)
    expect(first.items.length).toBeGreaterThan(0)
    expect(first.continuation).toEqual(expect.any(String))

    await q.fetchMore({ videoId: 'seed', continuation: first.continuation, after: 9 })
    expect(call.mock.calls[1][0]).toMatchObject({ endpoint: 'next', body: { continuation: first.continuation } })
    expect((calls('queue.append')[1] as { after: number }).after).toBe(9)
  })

  it('drops a failed radio fetch', async () => {
    call.mockRejectedValue(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await q.fetchMore({ videoId: 'seed', after: 1 })
    expect(calls('queue.append')).toEqual([])
    warn.mockRestore()
  })
})
