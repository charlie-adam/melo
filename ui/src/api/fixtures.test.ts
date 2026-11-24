// Guards the public repo: committed fixtures must carry no visitor ids, addresses, cookies, real user channels or
// real lyrics. Run `node scripts/scrub-fixtures.mjs` after capturing a fixture.
import { describe, expect, it } from 'vitest'

const raw = import.meta.glob('./__fixtures__/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const privateFixtures = import.meta.glob('./__fixtures__/private/*.json')
const files = Object.entries(raw)

function walk(node: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (node === null || typeof node !== 'object') return
  if (!Array.isArray(node)) visit(node as Record<string, unknown>)
  for (const child of Object.values(node)) walk(child, visit)
}

const runsText = (node: unknown): string =>
  ((node as { runs?: { text?: string }[] } | undefined)?.runs ?? []).map((r) => r.text ?? '').join('')

describe('committed fixtures', () => {
  it('exist', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s is scrubbed', (_name, text) => {
    for (const match of text.matchAll(/"visitorData":"([^"]*)"/g)) expect(match[1]).toBe('REDACTED')
    for (const match of text.matchAll(/"(?:clickT|t)rackingParams":"([^"]*)"/g)) expect(match[1]).toBe('REDACTED')
    const ipv4 = [...text.matchAll(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g)].filter((m) => m.slice(1).every((o) => Number(o) <= 255))
    expect(ipv4.map((m) => m[0])).toEqual([])
    expect(text.match(/[\w.%+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}/gi) ?? []).toEqual([])
    expect(text.match(/SAPISID|__Secure-\dP|\bHSID\b|\bSSID\b|LOGIN_INFO|"cookie"/gi) ?? []).toEqual([])
  })

  it.each(files)('%s has no real user channels or lyrics', (_name, text) => {
    const json: unknown = JSON.parse(text)
    type Browse = { browseId?: string; browseEndpointContextSupportedConfigs?: { browseEndpointContextMusicConfig?: { pageType?: string } } }
    const pageType = (b: Browse | undefined) => b?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType
    // An artist's own channel can also appear as a user channel; artists are public and keep their ids.
    const artistIds = new Set<string | undefined>()
    walk(json, (node) => {
      const browse = node.browseEndpoint as Browse | undefined
      if (pageType(browse) === 'MUSIC_PAGE_TYPE_ARTIST') artistIds.add(browse?.browseId)
    })
    walk(json, (node) => {
      const browse = node.browseEndpoint as Browse | undefined
      if (pageType(browse) === 'MUSIC_PAGE_TYPE_USER_CHANNEL' && !artistIds.has(browse?.browseId)) {
        expect(browse?.browseId).toMatch(/^UCREDACTED/)
      }
      const shelf = node.musicDescriptionShelfRenderer as { description?: unknown; footer?: unknown } | undefined
      if (shelf && /^Source:/.test(runsText(shelf.footer))) {
        const lines = runsText(shelf.description).split(/\r?\n/).filter((l) => l.trim())
        for (const line of lines) expect(line).toMatch(/^Placeholder line \d+$/)
      }
      const timed = node.timedLyricsModel as { lyricsData?: { lyricLine?: string }[] } | undefined
      for (const line of timed?.lyricsData ?? []) expect(line.lyricLine).toMatch(/^Placeholder line/)
    })
  })
})

// Signed-in captures live in the git-ignored private folder; these checks only run where it exists.
describe.skipIf(Object.keys(privateFixtures).length === 0)('private signed-in fixtures', () => {
  it('load', async () => {
    for (const load of Object.values(privateFixtures)) expect(await load()).toBeTruthy()
  })
})
