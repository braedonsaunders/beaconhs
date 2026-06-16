// Resolve a VizDef.iconKey (a lucide name string — the registry stays React-free)
// to a lucide icon component. Falls back to a neutral icon for unknown keys.

import {
  AlignStartVertical,
  AreaChart,
  BarChart3,
  ChartNoAxesCombined,
  CircleDashed,
  Filter,
  Gauge,
  Grid2x2,
  Grid3x3,
  Hash,
  LineChart,
  PieChart,
  ScatterChart,
  Table,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  Hash,
  Gauge,
  Table,
  Grid3x3,
  Grid2x2,
  BarChart3,
  AlignStartVertical,
  LineChart,
  AreaChart,
  ChartNoAxesCombined,
  PieChart,
  CircleDashed,
  Filter,
  ScatterChart,
}

export function VizIcon({
  iconKey,
  size = 16,
  className,
}: {
  iconKey: string
  size?: number
  className?: string
}) {
  const Icon = ICONS[iconKey] ?? Table
  return <Icon size={size} className={className} />
}
