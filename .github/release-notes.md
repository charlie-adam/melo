Download `Melo-*.zip`, unzip it and drag Melo to Applications.
It runs on macOS 14 or later, on Apple silicon and Intel.

Melo isn't notarised by Apple, so macOS blocks it the first time you open it:

1. Open Melo. macOS says "Melo" Not Opened; click Done.
2. Open System Settings > Privacy & Security and scroll down to Security.
3. Next to "Melo" was blocked to protect your Mac, click Open Anyway, then confirm with your password or Touch ID.
4. Click Open Anyway once more in the dialog that follows.

Or, in Terminal: `xattr -dr com.apple.quarantine /Applications/Melo.app`

Sign in with your own Google account when Melo asks.
YouTube Music Premium removes ads, the same as on music.youtube.com.

To check the download, compare `shasum -a 256 Melo-*.zip` with the `.sha256` file.
