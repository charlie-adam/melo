# Security

## Reporting a problem

Report security problems privately through GitHub: open the repository's Security tab and choose "Report a vulnerability".
Please do not open a public issue for them.
This is a personal project, so expect a reply within a couple of weeks rather than days.

## What the app touches

The app signs in to YouTube Music through Google's own sign-in page, shown in a web view inside the app.
It never sees your password.

| Data | Where it lives | Who gets it |
| --- | --- | --- |
| Google and YouTube cookies | WebKit's data store for the app, under `~/Library/WebKit` and `~/Library/HTTPStorages` | music.youtube.com, through the hidden player and the Swift InnerTube client |
| A backup of the sign-in cookies | One generic-password item in your login Keychain, readable only while the Mac is unlocked and never synced to iCloud | Only the app, to restore a sign-in WebKit lost |
| The queue and playback position | `~/Library/Application Support/Melo/queue.json` | Nobody |
| Settings | The app's user defaults | Nobody |
| Song title, artist and length | Not stored | lrclib.net, to find lyrics, unless you turn LRCLIB off in Settings |

Signing out deletes the Keychain item and every Google and YouTube cookie in the app's data store.

## How the app keeps the account apart from the UI

- Cookies, SAPISID and auth headers stay in Swift.
  The React UI runs in a web view with its own throwaway data store, so it cannot read the YouTube cookie jar.
- The UI reaches Swift only through a typed bridge.
  Swift decodes each request and rejects unknown methods, InnerTube endpoints outside a fixed allowlist, and requests from any frame outside `melo://app/`.
  The menu bar and mini player pages get a smaller set of methods than the main window.
- The UI ships a Content-Security-Policy that loads scripts, styles and fonts only from the app, and images only from YouTube's image hosts.
- The hidden player and the sign-in window navigate only to https YouTube and Google hosts.
  Links to other sites open in your default browser.
- Logs record message names, sizes and HTTP statuses, never cookie, header or token values.
  The player logs track ids at info level, which you can read with `log stream`.
