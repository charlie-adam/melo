import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Ellipsis,
  Heart,
  House,
  Library,
  Link,
  ListMusic,
  ListPlus,
  ListStart,
  Maximize2,
  MicVocal,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Radio,
  Repeat,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  User,
  Volume2,
  VolumeX,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react'

// Icons come from Lucide (lucide.dev, ISC). The names here are what the screens ask for.
const shapes = {
  home: House,
  search: Search,
  library: Library,
  plus: Plus,
  heart: Heart,
  settings: SlidersHorizontal,
  back: ChevronLeft,
  forward: ChevronRight,
  down: ChevronDown,
  close: X,
  check: Check,
  more: Ellipsis,
  play: Play,
  pause: Pause,
  previous: SkipBack,
  next: SkipForward,
  shuffle: Shuffle,
  repeat: Repeat,
  lyrics: MicVocal,
  queue: ListMusic,
  volume: Volume2,
  muted: VolumeX,
  radio: Radio,
  playNext: ListStart,
  addToQueue: ListPlus,
  album: Disc3,
  artist: User,
  link: Link,
  offline: WifiOff,
  mini: PictureInPicture2,
  expand: Maximize2,
} satisfies Record<string, LucideIcon>

const solid = new Set<IconName>(['more', 'play', 'pause', 'previous', 'next'])

export type IconName = keyof typeof shapes

/** `filled` fills a stroked icon, such as the heart of a liked song. */
export function Icon({ name, size = 18, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  const Shape = shapes[name]
  const fill = solid.has(name) || filled
  return <Shape className={fill ? 'icon icon-solid' : 'icon'} size={size} strokeWidth={1.75} aria-hidden="true" />
}
