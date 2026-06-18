'use client'

// The ONE ECharts importer for Insights. Consumes a lib-agnostic VizChartSpec
// (built by @beaconhs/analytics, echarts-free) and maps it to an ECharts option.
// Tree-shaken echarts/core + SVG renderer. Types-only import of the spec keeps
// the analytics engine out of the client bundle.

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import {
  BarChart,
  FunnelChart,
  GaugeChart,
  LineChart,
  PieChart,
  ScatterChart,
} from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { VizChartSpec } from '@beaconhs/analytics'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  FunnelChart,
  GaugeChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkLineComponent,
  SVGRenderer,
])

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
const AXIS_TEXT = '#94a3b8'
const SPLIT_LINE = 'rgba(148, 163, 184, 0.18)'

export function VizChart({ spec, height }: { spec: VizChartSpec; height?: number }) {
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

  return <div ref={ref} style={height ? { height } : undefined} className="h-full min-h-0 w-full" />
}

function buildOption(spec: VizChartSpec): echarts.EChartsCoreOption {
  const multi = spec.series.length > 1
  const base: echarts.EChartsCoreOption = {
    color: PALETTE,
    textStyle: { fontFamily: 'inherit' },
    tooltip: { trigger: spec.kind === 'cartesian' || spec.kind === 'scatter' ? 'axis' : 'item' },
    legend:
      multi || spec.kind === 'pie'
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

  if (spec.kind === 'pie') {
    const donut = false
    return {
      ...base,
      series: [
        {
          type: 'pie',
          radius: donut ? ['52%', '78%'] : '74%',
          center: ['50%', '46%'],
          itemStyle: { borderRadius: 4, borderColor: 'transparent', borderWidth: 2 },
          label: { show: false },
          data: spec.xLabels.map((name, i) => ({ name, value: spec.series[0]?.data[i] ?? 0 })),
        },
      ],
    }
  }

  if (spec.kind === 'funnel') {
    return {
      ...base,
      series: [
        {
          type: 'funnel',
          left: 8,
          right: 8,
          label: { color: AXIS_TEXT, fontSize: 11 },
          data: spec.xLabels.map((name, i) => ({ name, value: spec.series[0]?.data[i] ?? 0 })),
        },
      ],
    }
  }

  if (spec.kind === 'gauge') {
    const g = spec.gauge ?? { value: 0, min: 0, max: 100 }
    return {
      series: [
        {
          type: 'gauge',
          min: g.min,
          max: g.max,
          progress: { show: true, width: 14 },
          axisLine: { lineStyle: { width: 14 } },
          detail: {
            valueAnimation: true,
            fontSize: 22,
            color: 'inherit',
            offsetCenter: [0, '70%'],
          },
          data: [{ value: g.value }],
        },
      ],
    }
  }

  if (spec.kind === 'scatter') {
    return {
      ...base,
      xAxis: {
        type: 'category',
        data: spec.xLabels,
        axisLabel: { color: AXIS_TEXT, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: AXIS_TEXT, fontSize: 11 },
        splitLine: { lineStyle: { color: SPLIT_LINE } },
      },
      grid: { left: 4, right: 12, top: 12, bottom: 8, containLabel: true },
      series: spec.series.map((s) => ({
        name: s.name,
        type: 'scatter',
        data: s.data,
        symbolSize: 8,
      })),
    }
  }

  // cartesian
  const horizontal = spec.orientation === 'horizontal'
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
  const secondaryValueAxis = { ...valueAxis }

  return {
    ...base,
    grid: {
      left: horizontal ? 8 : 4,
      right: 12,
      top: 12,
      bottom: multi ? 32 : 8,
      containLabel: true,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal
      ? { ...categoryAxis, inverse: true }
      : spec.secondaryY
        ? [valueAxis, secondaryValueAxis]
        : valueAxis,
    series: spec.series.map((s) => {
      const type =
        s.type ?? (spec.cartesianType === 'line' || spec.cartesianType === 'area' ? 'line' : 'bar')
      const isBar = type === 'bar'
      // Per-category bar colors: an explicit map wins, else cycle the palette
      // when colorByPoint is set. Otherwise the single series keeps one color.
      const colored = isBar && (s.pointColors != null || spec.colorByPoint)
      const data = colored
        ? s.data.map((v, i) => ({
            value: v,
            itemStyle: { color: s.pointColors?.[i] ?? PALETTE[i % PALETTE.length] },
          }))
        : s.data
      return {
        name: s.name,
        type,
        yAxisIndex: s.yAxisIndex ?? 0,
        data,
        stack: spec.stacked && isBar ? 'total' : undefined,
        smooth: type === 'line' ? 0.25 : undefined,
        areaStyle: s.areaStyle ? { opacity: 0.18 } : undefined,
        barMaxWidth: 36,
        itemStyle: isBar ? { borderRadius: spec.stacked ? 0 : 3 } : undefined,
        label:
          isBar && spec.showValues
            ? {
                show: true,
                position: horizontal ? ('right' as const) : ('top' as const),
                color: AXIS_TEXT,
                fontSize: 11,
              }
            : undefined,
        emphasis: { focus: 'series' },
        markLine: spec.markLines?.length
          ? {
              symbol: 'none',
              data: spec.markLines.map((m) => ({ yAxis: m.y, label: { formatter: m.label } })),
              lineStyle: { color: '#f43f5e' },
            }
          : undefined,
      }
    }),
  }
}
