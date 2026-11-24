import { expect, it } from 'vitest'
import { artUrl } from './images'

it('resizes Google-hosted art to a 2x square', () => {
  const thumbs = [{ url: 'https://lh3.googleusercontent.com/a=w540-h225-p-l90-rj', width: 540, height: 225 }]
  expect(artUrl(thumbs, 168)).toBe('https://lh3.googleusercontent.com/a=w336-h336-p-l90-rj')
  expect(artUrl([{ url: 'https://yt3.ggpht.com/b=s88-c-k-no-rj', width: 88 }], 28)).toBe('https://yt3.ggpht.com/b=s56-c-k-no-rj')
})

it('picks the smallest other thumbnail that covers 2x, else the largest', () => {
  const thumbs = [
    { url: 'https://i.ytimg.com/vi/x/sddefault.jpg', width: 640 },
    { url: 'https://i.ytimg.com/vi/x/default.jpg', width: 120 },
    { url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', width: 480 },
  ]
  expect(artUrl(thumbs, 100)).toBe('https://i.ytimg.com/vi/x/hqdefault.jpg')
  expect(artUrl(thumbs, 420)).toBe('https://i.ytimg.com/vi/x/sddefault.jpg')
  expect(artUrl([], 44)).toBeUndefined()
})
