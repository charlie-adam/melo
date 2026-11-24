# CLAUDE.md

Project rules for agents working on Melo, a personal macOS YouTube Music client.

## Stack

- Swift shell: AppKit and WKWebView, built with Swift Package Manager.
  There is no Xcode project.
- UI: React, Vite and TypeScript in `ui/`, styled with plain CSS.
  No Tailwind and no component library.
- npm for the UI, on Node 20.19+ or 22.12+.
- TypeScript stays on 6.0.x until typescript-eslint supports a later version.

## Layout

| Path | Contents |
| --- | --- |
| `Sources/Melo/main.swift` | App delegate, window, menu, and the main web view |
| `Sources/Melo/Bridge.swift` | JS -> Swift requests (`WKScriptMessageHandlerWithReply`) and Swift -> JS events |
| `Sources/Melo/Protocol.swift` | Swift mirror of `ui/src/bridge/protocol.ts` |
| `Sources/Melo/AppSchemeHandler.swift` | Serves the bundled UI at `melo://app/` |
| `Sources/Melo/UINavigation.swift` | Keeps the UI web view on `melo://app/`; other links open in the browser |
| `Sources/Melo/Auth.swift` | Sign-in window, cookies on `WKWebsiteDataStore.default()`, Keychain backup, SAPISIDHASH |
| `Sources/Melo/InnerTube.swift` | InnerTube client on URLSession; `api.call` allowlist, timeouts and read retries |
| `Sources/Melo/Player.swift`, `Resources/player*.js` | Hidden YouTube Music web view that plays the audio, and the script injected into it |
| `Sources/Melo/Queue.swift` | Melo's own queue; the UI is a view of it |
| `Sources/Melo/NowPlaying.swift` | Media keys and the Now Playing card through `MPRemoteCommandCenter` |
| `Sources/Melo/Lyrics.swift` | LRCLIB lookups |
| `Sources/Melo/Settings.swift` | Settings in UserDefaults |
| `Sources/Melo/Satellites.swift` | Menu bar panel and mini player, both showing the UI at `#menubar` and `#mini` |
| `Sources/Melo/*SelfTest.swift` | Live checks run with `MELO_SELFTEST`, `MELO_PLAYER_SELFTEST` and `MELO_QUEUE_SELFTEST` |
| `Tests/MeloTests/` | Swift Testing tests |
| `ui/src/bridge/` | `protocol.ts` (every message) and `client.ts` (`request`, `on`, `window.melo.emit`) |
| `ui/src/api/` | InnerTube request builders and parsers, with scrubbed fixtures |
| `ui/src/screens/`, `ui/src/satellite/` | Screens, and the menu bar and mini player pages |
| `ui/src/styles/tokens.css` | Design tokens |
| `scripts/build.sh` | Builds `~/Applications/Melo.app` |

Self-tests play real music.
They mute the player page and refuse to run if the mute fails; keep that guard.

## Commands

```bash
swift build && swift test
cd ui && npm run dev          # Vite on 127.0.0.1:5173
MELO_DEV_URL=http://127.0.0.1:5173/ swift run Melo
cd ui && npm test && npm run typecheck && npm run lint && npm run build
scripts/build.sh              # assemble Melo.app
```

## Rules

- Bridge: declare every message in `ui/src/bridge/protocol.ts` and its Swift mirror in `Protocol.swift`, with the same names and fields, in the same change.
  Requests go `{ method, params }` and resolve with a result; events go `{ name, payload }`.
  Add a Swift decoding test and a vitest case for each new message.
- Tokens: take every colour, shadow, radius and font from `ui/src/styles/tokens.css`.
  Light values sit on `:root`, dark values on `.dark`, which `settings.ts` sets from the Theme setting (System follows `prefers-color-scheme`).
  Add a token there before using a new value.
- Fonts: Figtree ships through `@fontsource-variable/figtree`.
  The UI loads nothing from Google Fonts or any other CDN at runtime.
- Title bar: the top 52px of the window belongs to the native title bar, which drags the window and holds the traffic lights.
  Put nothing interactive there.
- Not for the App Store.
  Do not prepare it for App Store review or notarised distribution.

## Security: the repo is public

Write every change as if the repo were already public on GitHub, because it is meant to be.

- Secrets: no cookies, tokens, API keys, SAPISID values, account names, emails, channel ids of real people, or Keychain contents in code, tests, fixtures, docs or logs.
  The InnerTube API key is scraped at runtime, never committed.
- Fixtures: only anonymous captures go in the repo, scrubbed of `visitorData`, IP addresses and any tracking id.
  Signed-in captures go in `ui/src/api/__fixtures__/private/`, which is git-ignored; tests that need them skip when the folder is missing.
  Lyric text in fixtures is replaced with placeholder lines: never commit real lyrics or other copyrighted text.
  `fixtures.test.ts` scans every committed fixture for these and fails on a match.
- Auth stays in Swift: cookies, SAPISID and auth headers never reach the UI.
  The UI web view uses a non-persistent data store so it cannot see the YouTube cookie jar.
  Logs redact cookie, header and token values; log names and lengths, not contents.
- Bridge: treat every message as untrusted input.
  Decode into typed values and reject anything else; `api.call` only accepts endpoints on its allowlist.
  Only the UI web view gets the app bridge; the sign-in and player web views get only the handlers they need, and those handlers check the frame's origin is music.youtube.com.
- Web views: the UI web view navigates only within `melo://app/`; any other link opens in the default browser.
  The UI ships a strict Content-Security-Policy and loads nothing remote except images from YouTube's image hosts.
  Injected scripts never `eval` or build JS from strings; values passed into page JS are JSON-encoded.
- Dependencies: keep them few, pinned by the lockfile, and justify each new one.
- No local paths, usernames or machine details in committed files.
- Kaset (MIT) is a reference, not a source to copy.
  Where code follows Kaset closely, credit it in a comment, and keep the README's acknowledgement.
