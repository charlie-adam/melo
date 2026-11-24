import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { debounce } from './debounce'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('calls once with the latest arguments after the quiet period', () => {
  const fn = vi.fn()
  const typed = debounce(fn, 150)
  typed('r')
  typed('ra')
  vi.advanceTimersByTime(149)
  typed('rad')
  vi.advanceTimersByTime(149)
  expect(fn).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(fn).toHaveBeenCalledExactlyOnceWith('rad')
})

it('drops a pending call on cancel', () => {
  const fn = vi.fn()
  const typed = debounce(fn, 150)
  typed('r')
  typed.cancel()
  vi.advanceTimersByTime(500)
  expect(fn).not.toHaveBeenCalled()
})
