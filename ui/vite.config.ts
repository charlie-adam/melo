import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// YouTube's image hosts, the only remote content the UI loads. Signed-in home shelves also use mix art from
// music.youtube.com and badges from gstatic, limited here to those paths.
const IMAGE_HOSTS = [
  'https://lh3.googleusercontent.com',
  'https://yt3.googleusercontent.com',
  'https://yt3.ggpht.com',
  'https://i.ytimg.com',
  'https://music.youtube.com/image/',
  'https://www.gstatic.com/music/',
  'https://www.gstatic.com/youtube/media/',
]

/**
 * The Content-Security-Policy, as a meta tag in index.html. The build allows nothing remote but those images. The dev
 * server also needs React Refresh's inline preamble, injected styles and the HMR websocket.
 */
export function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    `img-src 'self' ${IMAGE_HOSTS.join(' ')}`,
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "font-src 'self'",
    dev ? "connect-src 'self' ws://127.0.0.1:5173" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

function csp(): Plugin {
  let dev = false
  return {
    name: 'melo-csp',
    configResolved: (config) => void (dev = config.command === 'serve'),
    // Last and first in <head>, so it covers the scripts other plugins inject too.
    transformIndexHtml: {
      order: 'post',
      handler: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(dev) }, injectTo: 'head-prepend' }],
    },
  }
}

// The shell loads the dev server from MELO_DEV_URL, so it stays on one fixed local address.
export default defineConfig({
  plugins: [csp(), react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
