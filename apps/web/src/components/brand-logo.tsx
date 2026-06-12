// BeaconHS brand logo — hand-drawn SVG recreation of the lighthouse lockup.
// All ink strokes use `currentColor` (navy in light mode, near-white in dark);
// the beacon rays and "HS" stay brand amber in both themes. Every shape is a
// stroke with a normalized pathLength so the splash can draw the logo in.
//
// Exports:
//   <Logo />        full horizontal lockup (mark + "beaconHS" wordmark)
//   <LogoMark />    lighthouse only (square-ish, for tight spots)
//   <BrandSplash /> full-screen draw-in animation for route loading
// Pass `animated` for the looping beacon-ray shimmer (CSS-only, respects
// prefers-reduced-motion — keyframes live in globals.css under "Brand logo").

import type { CSSProperties, SVGProps } from 'react'
import { cn } from '@beaconhs/ui'

export const BRAND_AMBER = '#F5A623'
export const BRAND_NAVY = '#1B2B4A'

const INK_CLASS = 'text-[#1B2B4A] dark:text-slate-100'

type Mode = 'static' | 'loop' | 'draw'

const delay = (s: number) => ({ '--bd': `${s}s` }) as CSSProperties

/* ------------------------------- The mark -------------------------------- */
// Drawn in a 48 × 106 box. Build-up order: base → tower → stripes → gallery →
// lantern room → roof, then the lamp lights and the rays sweep on.

const MARK_STRUCTURE = [
  'M4 101L44 101', // base
  'M17 55L11 101', // tower left
  'M31 55L37 101', // tower right
  'M14.8 72L32.2 64.5', // upper stripe
  'M12.2 92L34.9 84.5', // lower stripe
  'M10.5 55L37.5 55', // gallery ledge
  'M16 38L32 38L32 53L16 53Z', // lantern room
  'M11.5 38L24 24L36.5 38Z', // roof
]

// Rays ordered left → right so staggered delays read as a sweeping beam.
const MARK_RAYS = [
  'M15.1 20.8L2.9 16.4',
  'M18.6 16.2L11.1 5.6',
  'M24 14.5L24 3',
  'M29.4 16.2L36.9 5.6',
  'M32.9 20.8L45.1 16.4',
]

function MarkArt({ mode }: { mode: Mode }) {
  const draw = mode === 'draw'
  const loop = mode === 'loop'
  const lampLit = draw || loop
  return (
    <>
      {lampLit ? (
        <filter id="bhs-glow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      ) : null}
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {MARK_STRUCTURE.map((d, i) => (
          <path
            key={d}
            d={d}
            {...(draw
              ? { pathLength: 1, className: 'brand-draw', style: delay(0.05 + i * 0.08) }
              : {})}
          />
        ))}
      </g>
      {/* lamp — faithful ink in the static logo, lit amber when animated */}
      {lampLit ? (
        <circle
          cx={24}
          cy={45.75}
          r={6}
          fill={BRAND_AMBER}
          opacity={0.4}
          filter="url(#bhs-glow)"
          className={draw ? 'brand-in-pulse' : 'brand-pulse'}
          style={delay(draw ? 0.95 : 0)}
        />
      ) : null}
      <rect
        x={20.5}
        y={42.5}
        width={7}
        height={6.5}
        rx={1.6}
        fill={lampLit ? BRAND_AMBER : 'currentColor'}
        {...(draw ? { className: 'brand-in', style: delay(0.95) } : {})}
      />
      <g fill="none" stroke={BRAND_AMBER} strokeWidth={5} strokeLinecap="round">
        {MARK_RAYS.map((d, i) => (
          <path
            key={d}
            d={d}
            {...(draw
              ? { className: 'brand-in-pulse', style: delay(1.05 + i * 0.09) }
              : loop
                ? { className: 'brand-pulse', style: delay(i * 0.16) }
                : {})}
          />
        ))}
      </g>
    </>
  )
}

/* ----------------------------- The wordmark ------------------------------ */
// Monoline geometric letterforms built from circles and arcs, x-height 100,
// stroke 20 ("beacon" in ink, "HS" in amber) — no font dependency.

type GlyphStroke = { d: string } | { cx: number; cy: number; r: number }
type Glyph = { x: number; amber?: boolean; strokes: GlyphStroke[] }

const GLYPHS: Glyph[] = [
  // b
  { x: 0, strokes: [{ d: 'M10 -38L10 100' }, { cx: 60, cy: 50, r: 40 }] },
  // e — ring with the aperture at the lower right; the bar runs flush to the
  // ring's outer right edge so its terminal doesn't step back at the aperture
  { x: 124, strokes: [{ d: 'M90 50A40 40 0 1 0 75.7 80.6' }, { d: 'M10 50L100 50' }] },
  // a — single-storey: bowl + flush right stem
  { x: 238, strokes: [{ cx: 50, cy: 50, r: 40 }, { d: 'M90 0L90 100' }] },
  // c
  { x: 352, strokes: [{ d: 'M79.7 23.2A40 40 0 1 0 79.7 76.8' }] },
  // o
  { x: 460, strokes: [{ cx: 50, cy: 50, r: 40 }] },
  // n
  { x: 574, strokes: [{ d: 'M10 0L10 100' }, { d: 'M10 50A40 40 0 0 1 90 50L90 100' }] },
  // H
  {
    x: 690,
    amber: true,
    strokes: [{ d: 'M10 -36L10 100' }, { d: 'M90 -36L90 100' }, { d: 'M10 32L90 32' }],
  },
  // S — two tangent elliptical arcs
  { x: 804, amber: true, strokes: [{ d: 'M76.6 -12.5A33 27 0 1 0 48 28A37 31 0 1 1 16 74.5' }] },
]

const WORD_SCALE = 0.44
const WORD_X = 68 // gap between mark and wordmark
const WORD_Y = 48 // x-height top within the 116-tall lockup
const WORD_END = WORD_X + (804 + 96) * WORD_SCALE // right edge of the S
const LOCKUP_W = Math.ceil(WORD_END + 4)

function WordmarkArt({ mode }: { mode: Mode }) {
  const draw = mode === 'draw'
  return (
    <g
      transform={`translate(${WORD_X} ${WORD_Y}) scale(${WORD_SCALE})`}
      fill="none"
      strokeWidth={20}
      strokeLinecap="butt"
      strokeLinejoin="round"
    >
      {GLYPHS.map((g, i) => (
        <g
          key={g.x}
          transform={`translate(${g.x} 0)`}
          stroke={g.amber ? BRAND_AMBER : 'currentColor'}
        >
          {g.strokes.map((s, j) => {
            const anim = draw
              ? { pathLength: 1, className: 'brand-draw', style: delay(0.35 + i * 0.07) }
              : {}
            return 'd' in s ? (
              <path key={j} d={s.d} {...anim} />
            ) : (
              <circle key={j} cx={s.cx} cy={s.cy} r={s.r} {...anim} />
            )
          })}
        </g>
      ))}
    </g>
  )
}

/* ------------------------------- Components ------------------------------ */

type LogoProps = SVGProps<SVGSVGElement> & {
  /** Loop the beacon-ray shimmer + lit lamp. */
  animated?: boolean
  /** Draw the whole logo in once, then keep the beacon looping (splash). */
  draw?: boolean
}

export function LogoMark({ animated, draw, className, ...rest }: LogoProps) {
  const mode: Mode = draw ? 'draw' : animated ? 'loop' : 'static'
  return (
    <svg
      viewBox="0 0 48 106"
      role="img"
      aria-label="BeaconHS"
      className={cn('h-8 w-auto', INK_CLASS, className)}
      {...rest}
    >
      <MarkArt mode={mode} />
    </svg>
  )
}

export function Logo({ animated, draw, className, ...rest }: LogoProps) {
  const mode: Mode = draw ? 'draw' : animated ? 'loop' : 'static'
  return (
    <svg
      viewBox={`0 0 ${LOCKUP_W} 116`}
      role="img"
      aria-label="BeaconHS"
      className={cn('h-8 w-auto', INK_CLASS, className)}
      {...rest}
    >
      <g transform="translate(0 5)">
        <MarkArt mode={mode} />
      </g>
      <WordmarkArt mode={mode} />
    </svg>
  )
}

/** Full-screen brand splash: the logo draws itself in, then the beacon keeps
 *  sweeping. Used as the root route-loading fallback. */
export function BrandSplash() {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-slate-50 dark:bg-slate-950">
      <Logo draw className="h-14 w-auto sm:h-[4.5rem]" />
    </div>
  )
}
