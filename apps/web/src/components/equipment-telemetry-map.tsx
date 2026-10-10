'use client'

import { useGeneratedValueTranslations } from '@/i18n/generated'
import { GeneratedValue } from '@/i18n/generated'

import { useEffect, useRef, useState } from 'react'
import { Expand, LocateFixed, MapPin, Minimize } from 'lucide-react'
import type { Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type EquipmentMapPoint = {
  id: string
  label: string
  latitude: number
  longitude: number
  observedAt: string
  observedLabel: string
  health: string
  href: string
  address?: string | null
  source?: string
  speedKph?: number | null
}

export function EquipmentTelemetryMap({
  points,
  trail = false,
  large = false,
}: {
  points: EquipmentMapPoint[]
  trail?: boolean
  large?: boolean
}) {
  const t = useGeneratedValueTranslations()
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const bounds = points.map((point) => [point.latitude, point.longitude] as [number, number])
  function fit() {
    if (bounds.length) mapRef.current?.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 })
  }
  useEffect(() => {
    let disposed = false
    let remove: (() => void) | undefined
    async function initialize() {
      const L = await import('leaflet')
      if (disposed || !container.current) return
      setLoading(true)
      setError(false)
      const map = L.map(container.current, {
        scrollWheelZoom: false,
        maxZoom: 18,
        zoomControl: false,
      })
      mapRef.current = map
      remove = () => {
        map.remove()
        mapRef.current = null
      }
      L.control.zoom({ position: 'bottomright' }).addTo(map)
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map)
      const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      })
        .on('tileerror', () => {
          if (!disposed) {
            setError(true)
            setLoading(false)
          }
        })
        .on('load', () => {
          if (!disposed) setLoading(false)
        })
        .addTo(map)
      const coordinates = points.map(
        (point) => [point.latitude, point.longitude] as [number, number],
      )
      if (trail && coordinates.length > 1)
        L.polyline(coordinates, { color: '#0d9488', weight: 4, opacity: 0.8 }).addTo(map)
      // Co-located equipment stays discoverable: one marker opens all units
      // at that position instead of hiding overlapping markers underneath.
      const groups = new Map<string, EquipmentMapPoint[]>()
      for (const point of points) {
        const key = `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`
        groups.set(key, [...(groups.get(key) ?? []), point])
      }
      for (const group of groups.values()) {
        const point = group[0]!
        const fresh = group.some((p) => p.health === 'Reporting')
        const color = fresh ? '#0f766e' : '#b45309'
        const marker = document.createElement('div')
        marker.style.cssText = `display:flex;align-items:center;justify-content:center;width:32px;height:32px;border:3px solid white;border-radius:50%;background:${color};color:white;font:700 12px system-ui;box-shadow:0 3px 12px #0f172a40`
        marker.textContent = group.length > 1 ? String(group.length) : '•'
        const popup = document.createElement('div')
        popup.style.cssText = 'max-height:280px;overflow:auto;min-width:200px;font:13px system-ui'
        for (const entry of group) {
          const block = document.createElement('div')
          block.style.cssText = 'padding:8px 0;border-bottom:1px solid #e2e8f0'
          const link = document.createElement('a')
          link.href = entry.href
          link.textContent = entry.label
          link.style.cssText = 'font-weight:700;color:#0f766e'
          const status = document.createElement('div')
          status.textContent = t(entry.health)
          status.style.cssText = 'margin:5px 0;color:#475569'
          const time = document.createElement('div')
          time.textContent = `${t('GPS observed')}: ${entry.observedLabel}`
          const address = document.createElement('div')
          address.textContent =
            entry.address || `${entry.latitude.toFixed(5)}, ${entry.longitude.toFixed(5)}`
          address.style.cssText = 'margin-top:5px;color:#64748b'
          block.append(link, status, time, address)
          if (entry.source) {
            const source = document.createElement('div')
            source.textContent = entry.source
            block.append(source)
          }
          popup.append(block)
        }
        L.marker([point.latitude, point.longitude], {
          icon: L.divIcon({
            html: marker,
            className: '',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          }),
          title: group.map((p) => p.label).join(', '),
        })
          .bindPopup(popup)
          .addTo(map)
      }
      if (coordinates.length) map.fitBounds(coordinates, { padding: [48, 48], maxZoom: 15 })
      else map.setView([0, 0], 2)
      const observer = new ResizeObserver(() => map.invalidateSize())
      observer.observe(container.current)
      const close = remove
      remove = () => {
        observer.disconnect()
        tiles.off()
        close()
      }
    }
    void initialize().catch(() => {
      if (!disposed) {
        setError(true)
        setLoading(false)
      }
    })
    return () => {
      disposed = true
      remove?.()
    }
  }, [points, trail, t])
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MapPin size={16} className="text-teal-600" />
          <GeneratedValue value={trail ? 'Location trail' : 'Equipment map'} />
          <span className="font-normal text-slate-500">
            · {points.length}{' '}
            <GeneratedValue
              value={
                trail
                  ? points.length === 1
                    ? 'observation'
                    : 'observations'
                  : points.length === 1
                    ? 'position'
                    : 'positions'
              }
            />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fit}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <LocateFixed size={15} />
            <GeneratedValue value={'Fit view'} />
          </button>
          <button
            type="button"
            aria-pressed={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {expanded ? <Minimize size={15} /> : <Expand size={15} />}
            <GeneratedValue value={expanded ? 'Compact' : 'Expand'} />
          </button>
        </div>
      </div>
      <div className="relative">
        <div
          ref={container}
          aria-label={t('Equipment tracker locations')}
          className={`relative z-0 bg-slate-100 dark:bg-slate-800 ${expanded ? 'h-[80vh]' : large ? 'h-[62vh] min-h-[420px]' : 'h-[46vh] min-h-[340px]'}`}
        />
        {loading ? (
          <div
            role="status"
            className="pointer-events-none absolute top-4 left-4 z-[400] rounded-lg bg-white/95 px-3 py-2 text-xs text-slate-600 shadow"
          >
            <GeneratedValue value={'Loading map…'} />
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-teal-700" />
            <GeneratedValue value={'Reporting'} />
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-700" />
            <GeneratedValue value={'Historical or needs attention'} />
          </span>
        </div>
        <span>
          <GeneratedValue value={'Select a marker for equipment and observation details'} />
        </span>
      </div>
      {error ? (
        <p
          role="status"
          className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          <GeneratedValue
            value={
              'Map tiles could not load. Coordinates and observation times remain available below.'
            }
          />
        </p>
      ) : null}
    </div>
  )
}
