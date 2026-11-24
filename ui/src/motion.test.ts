import { describe, expect, it } from 'vitest'
import { toMs } from './motion'

describe('toMs', () => {
  it('reads milliseconds and the seconds the minifier writes', () => {
    expect(toMs('480ms')).toBe(480)
    expect(toMs('.48s')).toBe(480)
    expect(toMs(' 0.2s ')).toBe(200)
  })
})
