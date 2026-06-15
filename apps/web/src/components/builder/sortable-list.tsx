'use client'

// Straight vertical drag-to-reorder list, built on framer-motion's Reorder —
// the same pattern the app/form designer uses for fields. Drag via the grip
// handle only (so clicking a row selects it); up/down arrows remain as a
// keyboard-accessible fallback.

import * as React from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react'
import { cn } from '@beaconhs/ui'

export function SortableList<T>({
  items,
  onReorder,
  children,
  className,
}: {
  items: T[]
  onReorder: (next: T[]) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <Reorder.Group
      axis="y"
      values={items}
      onReorder={onReorder}
      as="ul"
      className={cn('divide-y divide-slate-100 dark:divide-slate-800', className)}
    >
      {children}
    </Reorder.Group>
  )
}

export function SortableRow<T>({
  value,
  selected,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
  canUp,
  canDown,
  children,
}: {
  value: T
  selected?: boolean
  onSelect?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onDelete?: () => void
  canUp?: boolean
  canDown?: boolean
  children: React.ReactNode
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={value}
      dragListener={false}
      dragControls={controls}
      as="li"
      className={cn(
        'flex items-center justify-between gap-2 rounded px-1 py-2 transition-colors',
        selected
          ? 'bg-teal-50 dark:bg-teal-950/40'
          : 'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60',
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
      >
        <GripVertical size={14} />
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {children}
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        {onMoveUp ? (
          <RowIconButton title="Move up" onClick={onMoveUp} disabled={!canUp}>
            <ArrowUp size={12} />
          </RowIconButton>
        ) : null}
        {onMoveDown ? (
          <RowIconButton title="Move down" onClick={onMoveDown} disabled={!canDown}>
            <ArrowDown size={12} />
          </RowIconButton>
        ) : null}
        {onDelete ? (
          <RowIconButton title="Delete" onClick={onDelete}>
            <Trash2 size={12} className="text-rose-500" />
          </RowIconButton>
        ) : null}
      </div>
    </Reorder.Item>
  )
}

function RowIconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {children}
    </button>
  )
}

// Debounce a callback so drag-reorders persist once the order settles rather
// than on every intermediate frame. Used by builders to call their reorder
// server action after the last onReorder of a drag.
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay = 400,
): (...args: A) => void {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const fnRef = React.useRef(fn)
  fnRef.current = fn
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return React.useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => fnRef.current(...args), delay)
    },
    [delay],
  )
}
