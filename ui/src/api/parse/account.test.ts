import { describe, expect, it } from 'vitest'
import { fixture } from '../fixture'
import { parseAccount } from './account'

describe('parseAccount', () => {
  it('reads the name, handle and photo of the active account', () => {
    expect(parseAccount(fixture('synthetic-account-menu'))).toEqual({
      name: 'Sample User',
      handle: '@sampleuser',
      photo: [{ url: 'https://yt3.ggpht.com/synthetic-account-photo=s88-c-k-c0x00ffffff-no-rj', width: 88, height: 88 }],
    })
  })

  it('returns undefined without an account header', () => {
    expect(parseAccount({ actions: [] })).toBeUndefined()
  })
})
