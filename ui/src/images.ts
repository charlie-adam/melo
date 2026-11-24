import type { Thumbnail } from './api/models'

/**
 * Picks artwork that stays sharp at 2x for a square of `size` CSS pixels. Google image hosts resize on request, so
 * their size suffix is rewritten to a square; `p` in the suffix crops to fit, which turns a wide artist banner square.
 */
export function artUrl(thumbnails: Thumbnail[], size: number): string | undefined {
  if (thumbnails.length === 0) return undefined
  const px = size * 2
  const sorted = [...thumbnails].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  const url = (sorted.find((t) => (t.width ?? 0) >= px) ?? sorted[sorted.length - 1]).url
  if (!/^https:\/\/[^/]*(googleusercontent\.com|ggpht\.com)\//.test(url)) return url
  return url.replace(/=w\d+-h\d+/, `=w${px}-h${px}`).replace(/=s\d+/, `=s${px}`)
}
