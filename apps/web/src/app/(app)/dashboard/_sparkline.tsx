/**
 * Tiny inline-SVG sparkline. Server-rendered so we don't ship a charting lib
 * for what amounts to a 60x20 polyline.
 *
 * - `data` is oldest -> newest. `null` slots are skipped (line breaks).
 * - `inverted` flips color logic for incident-rates: rising is bad (red),
 *   falling is good (emerald). For compliance %, leave inverted=false.
 * - Renders a faint baseline (avg) so the dot/line has visual anchoring.
 */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  stroke = 'currentColor',
  fill = 'none',
  strokeWidth = 1.5,
  ariaLabel,
  showArea = true,
}: {
  data: ReadonlyArray<number | null>
  width?: number
  height?: number
  stroke?: string
  fill?: string
  strokeWidth?: number
  ariaLabel?: string
  showArea?: boolean
}) {
  // Collect non-null values for the min/max envelope.
  const real = data.filter((v): v is number => v !== null && Number.isFinite(v))
  if (real.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel ?? 'no data'}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={stroke}
          strokeOpacity={0.25}
          strokeDasharray="2 3"
          strokeWidth={1}
        />
      </svg>
    )
  }

  const min = Math.min(...real)
  const max = Math.max(...real)
  const span = max - min || 1

  // Map index i in [0, len-1] to x in [pad, width-pad], value v to y.
  const padX = 1
  const padY = 2
  const innerW = width - padX * 2
  const innerH = height - padY * 2
  const step = data.length > 1 ? innerW / (data.length - 1) : 0

  type Pt = { x: number; y: number }
  const pts: Pt[] = []
  data.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return
    const x = padX + i * step
    const y = padY + innerH - ((v - min) / span) * innerH
    pts.push({ x, y })
  })

  if (pts.length === 0) return null

  // SVG polyline points string. We render the line AND a soft area fill so
  // the spark reads as a "shape" rather than a wire.
  const linePoints = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  const areaPath = [
    `M ${first.x.toFixed(2)} ${(height - padY).toFixed(2)}`,
    ...pts.map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`),
    `L ${last.x.toFixed(2)} ${(height - padY).toFixed(2)}`,
    'Z',
  ].join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? 'trend sparkline'}
    >
      {showArea ? <path d={areaPath} fill={stroke} fillOpacity={0.18} stroke="none" /> : null}
      <polyline
        points={linePoints}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.95}
      />
      {/* terminal dot for emphasis */}
      <circle cx={last.x} cy={last.y} r={2.25} fill={stroke} />
    </svg>
  )
}
