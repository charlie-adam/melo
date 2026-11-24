import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fixture } from '../api/fixture'

const call = vi.fn()
vi.mock('../api/call', () => ({ call: (...args: unknown[]) => call(...args) }))
const { createSuggester } = await import('./suggest')

beforeEach(() => {
  vi.useFakeTimers()
  call.mockReset()
})
afterEach(() => vi.useRealTimers())

it('requests suggestions only after typing pauses', async () => {
  call.mockResolvedValue(fixture('suggestions'))
  const onResult = vi.fn()
  const s = createSuggester(onResult)
  s.type('r')
  s.type('ra')
  s.type('rad')
  await vi.advanceTimersByTimeAsync(150)
  expect(call).toHaveBeenCalledExactlyOnceWith({ endpoint: 'music/get_search_suggestions', body: { input: 'rad' } })
  expect(onResult).toHaveBeenCalledWith('rad', expect.objectContaining({ queries: expect.arrayContaining(['radiohead']) }))
})

it('drops a reply once the input has changed, and skips blank input', async () => {
  let resolve: (raw: unknown) => void = () => {}
  call.mockReturnValueOnce(new Promise((r) => (resolve = r)))
  const onResult = vi.fn()
  const s = createSuggester(onResult)
  s.type('ra')
  await vi.advanceTimersByTimeAsync(150)
  s.type('  ')
  resolve(fixture('suggestions'))
  await vi.advanceTimersByTimeAsync(150)
  expect(call).toHaveBeenCalledTimes(1)
  expect(onResult).not.toHaveBeenCalled()
})
