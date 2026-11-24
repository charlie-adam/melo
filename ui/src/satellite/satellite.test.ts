import { describe, expect, it, vi } from 'vitest'
import type { QueueItem } from '../bridge/protocol'
import { nowAndNext } from './Satellite'

vi.mock('../bridge/client', () => ({ request: vi.fn().mockReturnValue(new Promise(() => {})), on: vi.fn() }))

const item = (videoId: string): QueueItem => ({ videoId, title: videoId, artists: [] })

describe('nowAndNext', () => {
  it('reads the playing entry and the one after it', () => {
    const snapshot = { items: [0, 1, 2].map((id) => ({ id, item: item(`v${id}`) })), index: 1, shuffle: false, repeat: 'off' as const, autoplay: true }
    expect(nowAndNext(snapshot)).toEqual({ current: item('v1'), upNext: item('v2') })
    expect(nowAndNext({ ...snapshot, index: 2 })).toEqual({ current: item('v2'), upNext: undefined })
    expect(nowAndNext({ ...snapshot, items: [], index: -1 })).toEqual({ current: undefined, upNext: undefined })
  })
})
