// Regenerates the raster brand icons (PWA manifest icons, apple-touch icon,
// PNG favicon fallback) from the SVG lighthouse mark. Keep the path data in
// sync with components/brand-logo.tsx. Run from anywhere:
//
//   node apps/web/scripts/generate-brand-icons.mjs

import { mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let sharp
try {
  sharp = require('sharp')
} catch {
  // sharp is only a transitive dependency (via next) — resolve it out of the
  // pnpm store when a bare require can't see it.
  const store = join(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/.pnpm')
  const dir = readdirSync(store).find((d) => d.startsWith('sharp@'))
  if (!dir) throw new Error('sharp not found in pnpm store — pnpm install first')
  sharp = require(join(store, dir, 'node_modules/sharp'))
}

const NAVY = '#1B2B4A'
const AMBER = '#F5A623'

// Full lighthouse mark, 48 × 106 design space (mirror of brand-logo.tsx).
const mark = (ink) => `
  <g fill="none" stroke="${AMBER}" stroke-width="5" stroke-linecap="round">
    <path d="M15.1 20.8L2.9 16.4" />
    <path d="M18.6 16.2L11.1 5.6" />
    <path d="M24 14.5L24 3" />
    <path d="M29.4 16.2L36.9 5.6" />
    <path d="M32.9 20.8L45.1 16.4" />
  </g>
  <g fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 101L44 101" />
    <path d="M17 55L11 101" />
    <path d="M31 55L37 101" />
    <path d="M14.8 72L32.2 64.5" />
    <path d="M12.2 92L34.9 84.5" />
    <path d="M10.5 55L37.5 55" />
    <path d="M16 38L32 38L32 53L16 53Z" />
    <path d="M11.5 38L24 24L36.5 38Z" />
  </g>
  <rect x="20.5" y="42.5" width="7" height="6.5" rx="1.6" fill="${AMBER}" />`

// Beacon top only (the favicon crop), 56 × 60 design space.
const beaconTop = (ink) => `
  <g fill="none" stroke="${AMBER}" stroke-width="6" stroke-linecap="round">
    <path d="M19.1 20.8L6.9 16.4" />
    <path d="M22.6 16.2L15.1 5.6" />
    <path d="M28 14.5L28 3" />
    <path d="M33.4 16.2L40.9 5.6" />
    <path d="M36.9 20.8L49.1 16.4" />
  </g>
  <g fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15.5 38L28 24L40.5 38Z" />
    <path d="M20 38L36 38L36 53L20 53Z" />
    <path d="M14.5 55L41.5 55" />
  </g>
  <rect x="24.5" y="42.5" width="7" height="6.5" rx="1.6" fill="${AMBER}" />`

// Navy tile with the white mark centered at `scale` of the tile height.
function tile(size, scale) {
  const h = 106 * (size / 106) * scale
  const s = h / 106
  const w = 48 * s
  const x = (size - w) / 2
  const y = (size - h) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${NAVY}" />
    <g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(3)})">${mark('#F4F7FB')}</g>
  </svg>`
}

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 60">${beaconTop(NAVY)}</svg>`

// Monochrome silhouette for the Android push-notification badge. The platform
// masks the badge to its alpha channel and tints it with the system colour, so
// we render the beacon top filled solid-white on a transparent background.
const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 60">
  <g fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round">
    <path d="M19.1 20.8L6.9 16.4" />
    <path d="M22.6 16.2L15.1 5.6" />
    <path d="M28 14.5L28 3" />
    <path d="M33.4 16.2L40.9 5.6" />
    <path d="M36.9 20.8L49.1 16.4" />
  </g>
  <g fill="#fff" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15.5 38L28 24L40.5 38Z" />
    <path d="M20 38L36 38L36 53L20 53Z" />
    <path d="M14.5 55L41.5 55" />
  </g>
</svg>`

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..')
const iconsDir = join(webRoot, 'public/icons')
mkdirSync(iconsDir, { recursive: true })

const render = (svg, size, file) =>
  sharp(Buffer.from(svg), { density: 300 })
    .resize(size, size)
    .png()
    .toFile(file)
    .then(() => console.log('  ✓', file))

await Promise.all([
  render(tile(512, 0.68), 192, join(iconsDir, 'icon-192.png')),
  render(tile(512, 0.68), 512, join(iconsDir, 'icon-512.png')),
  render(tile(512, 0.55), 512, join(iconsDir, 'maskable-512.png')),
  render(tile(512, 0.66), 180, join(webRoot, 'src/app/apple-icon.png')),
  render(faviconSvg, 64, join(webRoot, 'src/app/icon1.png')),
  render(badgeSvg, 72, join(iconsDir, 'badge-72.png')),
])
console.log('Brand icons regenerated.')
