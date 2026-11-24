#!/usr/bin/env node
// Scrubs captured InnerTube fixtures before they are committed. Deterministic and idempotent: running it twice
// changes nothing the second time. Usage: node scripts/scrub-fixtures.mjs [dir] (default ui/src/api/__fixtures__).
//
// - visitorData, responseId, tracking params and request ids become "REDACTED".
// - User channels (pageType MUSIC_PAGE_TYPE_USER_CHANNEL) get fake ids, "User N" names and placeholder avatars.
// - Lyrics become "Placeholder line N"; other description text (Wikipedia, playlist blurbs) becomes a placeholder.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'ui/src/api/__fixtures__'
const REDACTED = 'REDACTED'
const REDACT_KEYS = new Set(['visitorData', 'responseId', 'trackingParams', 'clickTrackingParams', 'serializedContextData', 'serializedShareEntity'])
const AVATAR = 'https://yt3.ggpht.com/redacted'
const SKIP_NAMES = new Set([' • ', 'Profile', 'Playlist', ', '])

const pageType = (e) => e?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType
const isUserChannel = (e) => pageType(e) === 'MUSIC_PAGE_TYPE_USER_CHANNEL'
const runsText = (node) => (node?.runs ?? []).map((r) => r.text ?? '').join('')

function scrub(root) {
  const ids = new Map() // real id -> fake id
  const names = new Map() // real name -> "User N"
  const marked = new Set() // subtrees whose image urls are avatars of real people
  // An artist's own channel can also appear as a user channel; artists are public figures and keep their names and ids.
  const artistIds = new Set()
  const artistNames = new Set()
  ;(function findArtists(node) {
    if (node === null || typeof node !== 'object') return
    if (!Array.isArray(node) && pageType(node.navigationEndpoint) === 'MUSIC_PAGE_TYPE_ARTIST') {
      artistIds.add(node.navigationEndpoint.browseEndpoint.browseId)
      if (typeof node.text === 'string') artistNames.add(node.text)
    }
    for (const child of Object.values(node)) findArtists(child)
  })(root)

  const addId = (id) => {
    if (id && !id.startsWith('UCREDACTED') && !artistIds.has(id) && !ids.has(id)) ids.set(id, `UCREDACTED${String(ids.size + 1).padStart(12, '0')}`)
  }
  const addName = (name) => {
    if (name && name.length >= 3 && !SKIP_NAMES.has(name) && !artistNames.has(name) && !/^User \d+$/.test(name) && !names.has(name)) names.set(name, `User ${names.size + 1}`)
  }

  ;(function collect(node) {
    if (node === null || typeof node !== 'object') return
    if (!Array.isArray(node)) {
      if (isUserChannel(node)) addId(node.browseEndpoint.browseId)
      const endpoint = node.navigationEndpoint ?? node.onTap ?? node.rendererContext?.commandContext?.onTap?.innertubeCommand
      if (isUserChannel(endpoint)) {
        if (typeof node.text === 'string') addName(node.text)
        if (typeof node.text?.content === 'string') addName(node.text.content)
        for (const column of node.flexColumns ?? []) for (const run of column.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []) addName(run.text)
        if (node.title && !node.text) addName(runsText(node.title))
        marked.add(node)
      }
      if (node.avatarStackViewModel && isUserChannel(node.avatarStackViewModel.rendererContext?.commandContext?.onTap?.innertubeCommand)) {
        marked.add(node)
      }
      if (node.musicDescriptionShelfRenderer) placeholderDescription(node.musicDescriptionShelfRenderer)
      if (node.musicImmersiveHeaderRenderer?.description) node.musicImmersiveHeaderRenderer.description = { runs: [{ text: 'Placeholder description' }] }
      for (const line of node.timedLyricsModel?.lyricsData ?? []) line.lyricLine = 'Placeholder line'
    }
    for (const child of Object.values(node)) collect(child)
  })(root)

  const sortedNames = [...names.keys()].sort((a, b) => b.length - a.length)
  const replaceString = (value) => {
    let out = value
    for (const [real, fake] of ids) out = out.split(real).join(fake)
    for (const real of sortedNames) out = out.split(real).join(names.get(real))
    return out
  }

  return (function rewrite(node, avatar) {
    if (typeof node === 'string') return replaceString(node)
    if (node === null || typeof node !== 'object') return node
    const inAvatar = avatar || marked.has(node)
    if (Array.isArray(node)) return node.map((child) => rewrite(child, inAvatar))
    const out = {}
    for (const [key, value] of Object.entries(node)) {
      if (REDACT_KEYS.has(key) && typeof value === 'string') out[key] = REDACTED
      else if (inAvatar && key === 'url' && typeof value === 'string' && /ggpht|googleusercontent/.test(value)) out[key] = AVATAR
      else out[key] = rewrite(value, inAvatar)
    }
    // serviceTrackingParams entries such as {"key":"GetSearch_rid","value":"0x..."} are request ids.
    if (typeof out.key === 'string' && /_rid$/.test(out.key) && typeof out.value === 'string') out.value = REDACTED
    return out
  })(root, false)
}

/** Lyrics (footer "Source: ...") keep their line structure with placeholder lines; any other description is replaced. */
function placeholderDescription(shelf) {
  if (/^Source:/.test(runsText(shelf.footer))) {
    let n = 0
    for (const run of shelf.description?.runs ?? []) {
      run.text = run.text
        .split('\r\n')
        .map((line) => (line.trim() ? `Placeholder line ${++n}` : ''))
        .join('\r\n')
    }
  } else if (shelf.description) {
    shelf.description = { runs: [{ text: 'Placeholder description' }] }
  }
}

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const path = join(dir, file)
  const before = readFileSync(path, 'utf8')
  const after = JSON.stringify(scrub(JSON.parse(before)))
  // Compare content, not formatting, so hand-written fixtures keep their indentation when nothing changes.
  if (after !== JSON.stringify(JSON.parse(before))) {
    writeFileSync(path, after)
    console.log(`scrubbed ${file}`)
  }
}
