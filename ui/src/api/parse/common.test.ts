import { describe, expect, it } from 'vitest'
import { artistId, artists, parseDuration, thumbnails } from './common'

describe('common helpers', () => {
  it('parses m:ss and h:mm:ss durations and rejects other text', () => {
    expect(parseDuration('4:07')).toBe(247)
    expect(parseDuration('1:02:03')).toBe(3723)
    expect(parseDuration('1997')).toBeUndefined()
    expect(parseDuration(undefined)).toBeUndefined()
  })

  it('gives unlinked artist names no browse id, so the UI never navigates to an invented id', () => {
    const runs = [{ text: 'Song' }, { text: ' • ' }, { text: 'A' }, { text: ' & ' }, { text: 'B' }, { text: ' • ' }, { text: '3:00' }]
    expect(artists(runs)).toEqual([{ name: 'A' }, { name: 'B' }])
  })

  it('maps MPLAUC library artist ids to UC', () => {
    expect(artistId('MPLAUCabc')).toBe('UCabc')
    expect(artistId('UCabc')).toBe('UCabc')
  })

  it('turns protocol-relative thumbnail urls into https', () => {
    expect(thumbnails({ thumbnails: [{ url: '//i.ytimg.com/x.jpg' }] })[0].url).toBe('https://i.ytimg.com/x.jpg')
  })
})
