// Observer and commands for the hidden YouTube Music player.
// Player.swift injects this at document start in the main frame, after player-core.js and inside one function scope
// that receives `boot`: { volume, autoplay, resumeAt }.
// State is read from the <video> element and the player API, never from button labels.
// Melo owns the queue, so the page may only play the track Melo asked for (or that track's ad): this script refuses
// any other play(), pauses a track just before its end, and holds everything while paused or on the home preload.
// Every media element plays at Melo's volume from its first frame, including ad media and elements created later.
// Selectors, the volume enforcement and the router call follow Kaset (MIT).
const handler = window.webkit.messageHandlers.meloPlayer
const generation = PlayerCore.generation(location.href)
const TIME_INTERVAL_MS = 250

let expected = new URL(location.href).searchParams.get('v') // the videoId Melo asked for; null on the home preload
let fresh = false // the current media belongs to `expected`
let ended = null // a frozen snapshot of the track that ended, sent until the next load, play or seek
let hold = !boot.autoplay // pause anything the page starts on its own
let error = null
let targetVolume = boot.volume
let resumeAt = boot.resumeAt > 0 ? boot.resumeAt : null // a position to apply once Melo's media loads
let last = null
let lastSentAt = 0
let endTimer = null
let lastLoggedIn
// When a track ends, YouTube Music starts loading its own next one within about 150 ms. A router load sent while that
// is in flight is dropped or replaced by YouTube Music's track, so Melo's next load waits for the page to settle: its
// video data has moved off the ended track and SETTLE_MARGIN_MS have passed, or ADVANCE_WAIT_MS at most.
let advanceUntil = 0
let pending = null
let endCleaned = false
let settleTimer = null
let playOnBind = false // Play arrived before the page's media was bound to Melo's track
const ADVANCE_WAIT_MS = 1500
const SETTLE_MARGIN_MS = 500
let endedVideoId = null
const END_EARLY_MS = 100
const END_LATEST_S = 0.4

// The page's own volume writes are replaced with Melo's, so nothing it sets is ever heard.
const volumeProperty = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')
function applyVolume(media) {
  if (Math.abs(volumeProperty.get.call(media) - targetVolume) > 0.001) volumeProperty.set.call(media, targetVolume)
}
Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
  configurable: true,
  enumerable: volumeProperty.enumerable,
  get() {
    return volumeProperty.get.call(this)
  },
  set() {
    applyVolume(this)
  },
})

// play() sets the volume first, and quietly does nothing when the page tries to play anything else. Rejecting it
// instead made YouTube Music treat the track as failed and load its own next one.
const nativePlay = HTMLMediaElement.prototype.play
HTMLMediaElement.prototype.play = function () {
  applyVolume(this)
  return mayPlay() ? nativePlay.call(this) : Promise.resolve()
}

// Media keys WebKit routes to the page must reach Melo's queue, not YouTube Music's, so the page may not register its
// own transport handlers; Melo's post the action to Swift. Seek-forward and seek-back stay off: YouTube Music's made
// Control Center flicker in Kaset. The wrapper follows Kaset (MIT).
const MEDIA_ACTIONS = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack', 'skipad']
const session = navigator.mediaSession
if (session && typeof session.setActionHandler === 'function') {
  const setActionHandler = session.setActionHandler.bind(session)
  session.setActionHandler = (action, callback) => {
    if (!MEDIA_ACTIONS.includes(action)) setActionHandler(action, callback)
  }
  for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']) {
    try {
      setActionHandler(action, (details) => {
        const seconds = action === 'seekto' && Number.isFinite(details?.seekTime) ? details.seekTime : null
        window.webkit.messageHandlers.meloRemote.postMessage({ generation, action, seconds })
      })
    } catch {
      // WebKit may not support every action.
    }
  }
}

// Both player-bar layouts mount in the app's player-bar slot; the redesign also renders an unslotted miniplayer.
const BAR = {
  title: '.ytmusic-player-bar.title, .ytmusicTrackInfoTitle',
  byline: '.ytmusic-player-bar.byline, .ytmusicTrackInfoByline',
  thumbnail: '.ytmusic-player-bar .thumbnail img, ytmusic-player-bar .image, img.ytmusicTrackInfoThumbnail',
}

function bar(name) {
  return document.querySelector('[slot="player-bar"]')?.querySelector(BAR[name]) ?? null
}

function video() {
  return document.querySelector('video')
}

function api() {
  const candidates = [document.querySelector('ytmusic-player')?.playerApi, document.getElementById('movie_player')]
  return candidates.find((candidate) => candidate && typeof candidate.getVideoData === 'function') ?? null
}

function videoData() {
  try {
    return api()?.getVideoData() ?? {}
  } catch {
    return {}
  }
}

function pageVideoId() {
  const data = videoData()
  return data.video_id || data.videoId || new URL(location.href).searchParams.get('v')
}

function mayPlay() {
  return PlayerCore.mayPlay({ hold, expected, isAd: adShowing(), pageVideoId: pageVideoId() })
}

function adShowing() {
  const movie = document.getElementById('movie_player')
  if (movie?.classList.contains('ad-showing') || movie?.classList.contains('ad-interrupting')) return true
  try {
    return api()?.getPresentingPlayerType?.(true) === 2
  } catch {
    return false
  }
}

function metadata(data) {
  const title = data.title || null
  const session = navigator.mediaSession?.metadata
  const sessionMatches = session && title && session.title === title
  const barMatches = title && bar('title')?.textContent.trim() === title
  const fromBar = PlayerCore.byline(barMatches ? bar('byline')?.textContent : '')
  return {
    title,
    artist: data.author || (sessionMatches && session.artist) || fromBar.artist,
    album: (sessionMatches && session.album) || fromBar.album,
    artworkUrl: (sessionMatches && PlayerCore.artwork(session.artwork)) || (barMatches && bar('thumbnail')?.src) || null,
  }
}

function snapshot() {
  const media = video()
  const data = videoData()
  const isAd = adShowing()
  const matches = fresh && (data.video_id || data.videoId) === expected
  // During an ad the media is the ad, so the track's clock is unknown.
  const current = matches && !isAd && media
  return {
    status: PlayerCore.status({
      expected,
      fresh: !!current,
      ended: false,
      error,
      paused: !media || media.paused,
      readyState: media?.readyState ?? 0,
    }),
    videoId: expected,
    ...(matches ? metadata(data) : { title: null, artist: null, album: null, artworkUrl: null }),
    currentTime: current ? media.currentTime : 0,
    duration: current && Number.isFinite(media.duration) ? media.duration : 0,
    volume: media ? media.volume : targetVolume,
    isAd,
    error,
  }
}

// Whether the page itself is signed in, so Swift can reload a document whose sign-in no longer matches the app's.
function loggedIn() {
  const value = window.ytcfg?.data_?.LOGGED_IN
  return typeof value === 'boolean' ? value : null
}

function report() {
  const next = ended ?? snapshot()
  const account = loggedIn()
  const now = Date.now()
  if (account === lastLoggedIn && !PlayerCore.shouldSend(last, next, now - lastSentAt, TIME_INTERVAL_MS)) return
  last = next
  lastLoggedIn = account
  lastSentAt = now
  handler.postMessage({ generation, loggedIn: account, state: next })
}

// `muted` is left alone: WebKit pauses muted media in a hidden window.
function enforceVolume() {
  for (const media of document.querySelectorAll('video, audio')) applyVolume(media)
}

function markFresh(media) {
  if (fresh || !expected || adShowing() || pageVideoId() !== expected) return
  fresh = true
  if (resumeAt !== null) media.currentTime = resumeAt
  resumeAt = null
  if (playOnBind) {
    playOnBind = false
    startPlayback()
  }
}

function watchErrors() {
  const player = api()
  if (!player || player.__meloErrors) return
  player.__meloErrors = true
  player.addEventListener('onStateChange', (state) => {
    if (advanceUntil && pageVideoId() !== endedVideoId) {
      clearTimeout(settleTimer)
      settleTimer = setTimeout(settle, SETTLE_MARGIN_MS)
    }
  })
  player.addEventListener('onError', (code) => {
    let reason = null
    try {
      reason = player.getPlayerResponse?.()?.playabilityStatus?.reason ?? null
    } catch {
      // The reason is optional.
    }
    error = reason ? `${reason} (code ${code})` : `Player error ${code}`
    report()
  })
}

// Capture listeners on window see every media event, and follow the <video> when the page replaces it.
// A backstop for playback that starts without play(), such as the autoplay attribute.
for (const type of ['play', 'playing']) {
  window.addEventListener(
    type,
    (event) => {
      if (!(event.target instanceof HTMLMediaElement)) return
      applyVolume(event.target)
      if (!mayPlay()) event.target.pause()
    },
    true,
  )
}

function finish(media) {
  clearTimeout(endTimer)
  if (ended || !fresh || !expected || adShowing()) return
  hold = true
  advanceUntil = Date.now() + ADVANCE_WAIT_MS
  endedVideoId = expected
  endCleaned = false
  media.pause()
  ended = { ...snapshot(), status: 'ended', currentTime: media.duration || 0 }
  report()
}

// The page advances its own queue when a track reaches its end, so stop the track just short of it. If the timer
// runs late (hidden pages throttle timers), `ended` still finishes the track and `hold` pauses whatever the page
// loads next.
function scheduleEnd(media) {
  clearTimeout(endTimer)
  const remaining = (media.duration - media.currentTime) / (media.playbackRate || 1)
  if (!fresh || media.paused || adShowing() || !(remaining < 2)) return
  // timeupdate fires about every 250 ms, so this catches the end even when the timer is throttled.
  if (remaining < END_LATEST_S) return finish(media)
  endTimer = setTimeout(() => finish(media), Math.max(0, remaining * 1000 - END_EARLY_MS))
}

for (const type of ['playing', 'pause', 'ended', 'waiting', 'seeked', 'timeupdate', 'loadedmetadata', 'loadeddata', 'canplay', 'durationchange', 'volumechange', 'emptied']) {
  window.addEventListener(
    type,
    (event) => {
      const media = event.target
      if (!(media instanceof HTMLMediaElement)) return
      if (type === 'loadedmetadata' || type === 'playing') markFresh(media)
      applyVolume(media)
      // The page sometimes leaves a new track paused after navigation.
      if (type === 'canplay' && !hold && media.paused) media.play().catch(() => {})
      if (type === 'ended') finish(media)
      else scheduleEnd(media)
      watchErrors()
      report()
    },
    true,
  )
}

// Metadata such as mediaSession can change without a media event, and media can load before the page's video data
// names Melo's track, so the tick also binds fresh media that its loadedmetadata event missed.
setInterval(() => {
  cleanUpEnd()
  const media = video()
  if (media?.readyState > 0) markFresh(media)
  report()
}, 1000)

// Runs an action now, or once the page has settled after a track's end.
function whenSettled(action) {
  clearTimeout(settleTimer)
  const wait = PlayerCore.settleWait(advanceUntil, Date.now())
  if (wait === 0) return action()
  pending = action
  settleTimer = setTimeout(settle, wait)
  return true
}

function settle() {
  advanceUntil = 0
  clearTimeout(settleTimer)
  const action = pending
  pending = null
  action?.()
}

// After an end that nothing followed (the queue stopped), bring the page back to the ended track, held, so YouTube
// Music's own next track is not left loaded. It runs from the report tick: at state -1 the page's video data can still
// name the ended track.
function cleanUpEnd() {
  const settling = PlayerCore.settleWait(advanceUntil, Date.now()) > 0
  if (!PlayerCore.needsEndCleanup({ ended: !!ended, cleaned: endCleaned, settling, pageVideoId: pageVideoId(), expected })) return
  endCleaned = true
  // The route reloads the track, so the next play binds its media afresh and starts it from the top.
  fresh = false
  resumeAt = 0
  route({ videoId: expected })
}

// Plays Melo's track again: in place when the page still shows it (routing to the shown track loads no new media),
// otherwise by routing back to it.
function backToTrack() {
  if (pageVideoId() !== expected) return route({ videoId: expected })
  fresh = true
  if (resumeAt !== null) api()?.seekTo?.(resumeAt, true)
  resumeAt = null
  if (!hold) startPlayback()
  report()
  return true
}

function startPlayback() {
  api()?.playVideo?.()
  // A play the gate refused resolves silently, so YouTube Music can believe its track is playing (state 1) while the
  // media sits paused, and then playVideo does nothing. Starting the media itself covers that.
  const media = video()
  if (media?.paused) media.play().catch(() => {})
}

function route(endpoint) {
  const app = document.querySelector('ytmusic-app')
  const controller = app && (app.polymerController || app.inst)
  const command = { watchEndpoint: endpoint }
  if (typeof controller?.handleNavigationEndpoint === 'function') controller.handleNavigationEndpoint(command)
  else if (typeof app?.resolveCommand === 'function') app.resolveCommand(command)
  else return false
  return true
}

function navigate(endpoint) {
  expected = endpoint.videoId
  fresh = false
  playOnBind = false
  ended = null
  error = null
  hold = false
  resumeAt = null
  clearTimeout(endTimer)
  video()?.pause()
  if (!whenSettled(() => route(endpoint))) return false
  report()
  return true
}

window.__meloPlayer = {
  generation,
  play() {
    hold = false
    if (ended) resumeAt = 0
    ended = null
    // Just after an end, or when the page shows another track, wait for the page to settle and come back to Melo's.
    // While the page is still loading Melo's track, play once its media is bound: playing earlier races the load.
    const path = PlayerCore.playPath({
      expected: !!expected,
      settling: advanceUntil > Date.now(),
      onTrack: pageVideoId() === expected,
      fresh,
    })
    if (path === 'settle') {
      fresh = false
      return whenSettled(backToTrack)
    }
    if (path === 'bind') {
      playOnBind = true
      report()
      return true
    }
    if (resumeAt !== null) this.seek(resumeAt)
    startPlayback()
    return true
  },
  pause() {
    hold = true
    playOnBind = false
    const player = api()
    if (player?.pauseVideo) player.pauseVideo()
    video()?.pause()
    return true
  },
  toggle() {
    const media = video()
    return !media || media.paused || ended ? this.play() : this.pause()
  },
  seek(seconds) {
    if (adShowing()) return false
    ended = null
    // The page is not showing Melo's track yet, so the position waits for its media.
    if (!fresh || pageVideoId() !== expected) {
      resumeAt = seconds
      report()
      return true
    }
    resumeAt = null
    const player = api()
    if (player?.seekTo) player.seekTo(seconds, true)
    else if (video()) video().currentTime = seconds
    report()
    return true
  },
  setVolume(volume) {
    targetVolume = volume
    enforceVolume()
    report()
    return true
  },
  navigate,
}
