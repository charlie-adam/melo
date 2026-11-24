import type { ReactNode } from 'react'

// Icons drawn on a 24px grid. Stroked icons follow `color`; the ones in `solid` are filled instead.
const shapes = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  library: <path d="M4 4v16M9 4v16M14 4.5l5.5 15.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  heart: <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z" />,
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  back: <path d="m15 18-6-6 6-6" />,
  forward: <path d="m9 18 6-6-6-6" />,
  down: <path d="m6 9 6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12 5 5 9-10" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </>
  ),
  play: <path d="M7 4.5v15l13-7.5z" />,
  pause: (
    <>
      <rect x="5.5" y="4" width="4.5" height="16" rx="1.2" />
      <rect x="14" y="4" width="4.5" height="16" rx="1.2" />
    </>
  ),
  previous: (
    <>
      <path d="M19 20 9 12l10-8z" />
      <rect x="4" y="4" width="2.2" height="16" rx="1" />
    </>
  ),
  next: (
    <>
      <path d="M5 4l10 8-10 8z" />
      <rect x="17.8" y="4" width="2.2" height="16" rx="1" />
    </>
  ),
  shuffle: <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />,
  repeat: <path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" />,
  lyrics: <path d="M4 6h16M4 12h11M4 18h7" />,
  queue: (
    <>
      <path d="M3 6h11M3 12h11M3 18h7" />
      <circle cx="17" cy="18" r="2.5" />
      <path d="M19.5 18V7l2.5 1" />
    </>
  ),
  volume: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </>
  ),
  muted: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="m16 9 6 6M22 9l-6 6" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2" />
    </>
  ),
  playNext: <path d="M4 6h10M4 12h10M4 18h6M16 15l4 3-4 3z" />,
  addToQueue: <path d="M4 6h12M4 12h12M4 18h7M18 15v6M15 18h6" />,
  album: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  artist: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  offline: <path d="M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.7M16.9 11.3a10 10 0 0 1 2.1 1.6M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18" />,
  // The mini player and back to the full window.
  mini: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="11" y="11" width="7" height="5" rx="1" fill="currentColor" />
    </>
  ),
  expand: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
} satisfies Record<string, ReactNode>

const solid = new Set<IconName>(['more', 'play', 'pause', 'previous', 'next'])

export type IconName = keyof typeof shapes

/** `filled` fills a stroked icon, such as the heart of a liked song. */
export function Icon({ name, size = 18, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  const fill = solid.has(name) || filled
  return (
    <svg className={fill ? 'icon icon-solid' : 'icon'} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {shapes[name]}
    </svg>
  )
}
