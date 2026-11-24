import { beforeEach, describe, expect, it, vi } from 'vitest'
import { on, request } from './bridge/client'
import type { Events } from './bridge/protocol'
import { recall, remember, resetLibraryState } from './library'

// Captures the library.changed listener that library.ts registers on load.
vi.mock('./bridge/client', () => ({ request: vi.fn(() => Promise.resolve(null)), on: vi.fn() }))

const requestMock = vi.mocked(request)
const changed = vi.mocked(on).mock.calls.find(([name]) => name === 'library.changed')?.[1] as (p: Events['library.changed']) => void

beforeEach(() => {
  resetLibraryState()
  requestMock.mockClear()
})

describe('library state across pages', () => {
  it('broadcasts every change through Swift', () => {
    remember('song:v1', 'LIKE')
    remember('list:PLa', true)
    remember('song:v1', undefined)
    expect(requestMock.mock.calls).toEqual([
      ['library.broadcast', { key: 'song:v1', value: 'LIKE' }],
      ['library.broadcast', { key: 'list:PLa', value: true }],
      ['library.broadcast', { key: 'song:v1', value: null }],
    ])
  })

  it('applies library.changed from another page without sending it back', () => {
    expect(changed).toBeTypeOf('function')
    changed({ key: 'song:v2', value: 'LIKE' })
    expect(recall('song:v2')).toBe('LIKE')
    changed({ key: 'song:v2', value: null })
    expect(recall('song:v2')).toBeUndefined()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('keeps working outside the app, where the broadcast rejects', () => {
    requestMock.mockReturnValueOnce(Promise.reject(new Error('Not running inside Melo')))
    remember('artist:UCa', true)
    expect(recall('artist:UCa')).toBe(true)
  })
})
