'use client'

// Thin ECharts wrapper that renders a chart-library-agnostic ReportChartSpec
// (produced by @beaconhs/reports). Tree-shaken echarts/core build — only the
// chart types + components the spec language can express. SVG renderer for
// crisp output at report sizes.
//
// NOTE: types only from @beaconhs/reports — a value import would drag the
// server-only engine (and the postgres client) into the browser bundle.

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { ReportChartSpec } from '@beaconhs/reports'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  SVGRenderer,
])

/** Teal-led palette that holds up on light and dark surfaces. */
const PALETTE = [
  '#0f766e',
  '#2dd4bf',
  '#f59e0b',
  '#f43f5e',
  '#6366f1',
  '#84cc16',
  '#f97316',
  '#06b6d4',
  '#a855f7',
]

const AXIS_TEXT = '#94a3b8' // slate-400 — readable on both themes
const SPLIT_LINE = 'rgba(148, 163, 184, 0.18)'

export function ReportChart({ spec, height = 280 }: { spec: ReportChartSpec; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chart = echarts.init(el, undefined, { renderer: 'svg' })
    chart.setOption(buildOption(spec))
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.dispose()
    }
  }, [spec])

  return <div ref={ref} style={{ height }} className="w-full" />
}

function buildOption(spec: ReportChartSpec): echarts.EChartsCoreOption {
  const base: echarts.EChartsCoreOption = {
    color: PALETTE,
    textStyle: { fontFamily: 'inherit' },
    tooltip: { trigger: spec.type === 'pie' || spec.type === 'donut' ? 'item' : 'axis' },
    legend:
      spec.series.length > 1 || spec.type === 'pie' || spec.type === 'donut'
        ? {
            bottom: 0,
            type: 'scroll',
            textStyle: { color: AXIS_TEXT, fontSize: 11 },
            icon: 'circle',
            itemWidth: 8,
            itemHeight: 8,
          }
        : undefined,
  }

  if (spec.type === 'pie' || spec.type === 'donut') {
    return {
      ...base,
      series: [
        {
          type: 'pie',
          radius: spec.type === 'donut' ? ['52%', '78%'] : '78%',
          center: ['50%', '44%'],
          itemStyle: { borderRadius: 4, borderColor: 'transparent', borderWidth: 2 },
          label: { show: false },
          data: spec.xLabels.map((name, i) => ({ name, value: spec.series[0]?.data[i] ?? 0 })),
        },
      ],
    }
  }

  const horizontal = spec.type === 'bar' && shouldFlip(spec)
  const categoryAxis = {
    type: 'category' as const,
    data: spec.xLabels,
    axisLabel: {
      color: AXIS_TEXT,
      fontSize: 11,
      ...(horizontal
        ? { width: 140, overflow: 'truncate' as const }
        : spec.xLabels.length > 8
          ? { rotate: 35, width: 90, overflow: 'truncate' as const }
          : {}),
    },
    axisLine: { lineStyle: { color: SPLIT_LINE } },
    axisTick: { show: false },
  }
  const valueAxis = {
    type: 'value' as const,
    axisLabel: { color: AXIS_TEXT, fontSize: 11 },
    splitLine: { lineStyle: { color: SPLIT_LINE } },
  }

  return {
    ...base,
    grid: {
      left: horizontal ? 8 : 4,
      right: 12,
      top: 12,
      bottom: spec.series.length > 1 ? 32 : 8,
      containLabel: true,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    series: spec.series.map((s) => ({
      name: s.name,
      type: spec.type === 'area' ? 'line' : spec.type === 'line' ? 'line' : 'bar',
      data: s.data,
      stack: spec.stacked ? 'total' : undefined,
      smooth: spec.type === 'line' || spec.type === 'area' ? 0.25 : undefined,
      areaStyle: spec.type === 'area' ? { opacity: 0.18 } : undefined,
      barMaxWidth: 36,
      itemStyle: spec.type === 'bar' ? { borderRadius: spec.stacked ? 0 : 3 } : undefined,
      emphasis: { focus: 'series' },
    })),
  }
}

/** Long category names read better as a horizontal bar list. */
function shouldFlip(spec: ReportChartSpec): boolean {
  if (spec.series.length > 1) return false
  const longest = spec.xLabels.reduce((m, l) => Math.max(m, l.length), 0)
  return longest > 16 && spec.xLabels.length <= 14
}
