import Link from 'next/link'
import { cn } from '@beaconhs/ui'

export type EquipmentSubNavKey =
  | 'equipment'
  | 'work-orders'
  | 'truck-log'
  | 'inspections'

const ITEMS: { key: EquipmentSubNavKey; label: string; href: string }[] = [
  { key: 'equipment', label: 'All equipment', href: '/equipment' },
  { key: 'work-orders', label: 'Work orders', href: '/equipment/work-orders' },
  { key: 'truck-log', label: 'Truck log', href: '/equipment/truck-log' },
  { key: 'inspections', label: 'Inspections', href: '/equipment/inspections' },
]

/**
 * Strip of pill links shown at the top of every equipment-suite page so the
 * user can pivot between the asset register, work orders, truck log, and the
 * inspection backlog without going home.
 */
export function EquipmentSubNav({ active }: { active: EquipmentSubNavKey }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-xs">
      {ITEMS.map((item) => {
        const isActive = item.key === active
        return (
          <Link
            key={item.key}
            href={item.href as any}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors',
              isActive
                ? 'border-teal-700 bg-teal-700 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
