'use client'

// Office-style ribbon for the Fabric slide editor. Formatting/insert/arrange
// controls drive the SlideCanvasHandle; `children` hosts the deck-level
// controls (add slide, background, import, present) from the deck editor.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  BringToFront,
  ChevronDown,
  Circle,
  Copy,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Minus,
  PaintBucket,
  PenLine,
  SendToBack,
  Square,
  Trash2,
  Type,
  Underline as UnderlineIcon,
} from 'lucide-react'
import { cn, Select } from '@beaconhs/ui'
import type { SlideElement, SlideImageElement, SlideTextElement } from '@beaconhs/db/schema'
import type { SlideCanvasHandle } from './slide-canvas'
import { newShapeElement, newTextElement } from './slide-model'

const TEXT_COLORS = [
  '#0f172a',
  '#475569',
  '#dc2626',
  '#d97706',
  '#059669',
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#ffffff',
]
const FILL_COLORS = [
  '#ffffff',
  '#f1f5f9',
  '#ccfbf1',
  '#fef9c3',
  '#fee2e2',
  '#dbeafe',
  '#0f766e',
  '#0f172a',
]

export function SlideRibbon({
  api,
  selection,
  disabled = false,
  onInsertImage,
  onReplaceImage,
  onImageFit,
  children,
}: {
  api: RefObject<SlideCanvasHandle | null>
  selection: SlideElement[]
  disabled?: boolean
  onInsertImage: () => void
  onReplaceImage: () => void
  onImageFit: (fit: NonNullable<SlideImageElement['fit']>) => void
  children?: ReactNode
}) {
  const text = selection.find((e): e is SlideTextElement => e.kind === 'text') ?? null
  const image = selection.find((e): e is SlideImageElement => e.kind === 'image') ?? null
  const shape = selection.find((e) => e.kind === 'shape') ?? null
  const any = selection.length > 0

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
      <Btn
        label="Text box"
        disabled={disabled}
        onClick={() => api.current?.addElement(newTextElement())}
      >
        <Type size={15} />
      </Btn>
      <Btn label="Image" disabled={disabled} onClick={onInsertImage}>
        <ImageIcon size={15} />
      </Btn>
      <Btn
        label="Rectangle"
        disabled={disabled}
        onClick={() => api.current?.addElement(newShapeElement('rect'))}
      >
        <Square size={15} />
      </Btn>
      <Btn
        label="Ellipse"
        disabled={disabled}
        onClick={() => api.current?.addElement(newShapeElement('ellipse'))}
      >
        <Circle size={15} />
      </Btn>
      <Btn
        label="Line"
        disabled={disabled}
        onClick={() => api.current?.addElement(newShapeElement('line'))}
      >
        <Minus size={15} />
      </Btn>
      <Sep />

      <Select
        title="Font"
        disabled={!text}
        value={text?.fontFamily ?? 'sans'}
        onChange={(e) =>
          api.current?.setTextProp({
            fontFamily: e.currentTarget.value as 'sans' | 'serif' | 'mono',
          })
        }
        className="h-7 px-1 text-xs font-medium text-slate-700 disabled:opacity-40 dark:text-slate-200"
      >
        <option value="sans">Sans</option>
        <option value="serif">Serif</option>
        <option value="mono">Mono</option>
      </Select>
      <FontSizeInput
        value={text?.fontSize ?? null}
        onChange={(fontSize) => api.current?.setTextProp({ fontSize })}
      />
      <Btn
        label="Bold"
        disabled={!text}
        active={!!text?.bold}
        onClick={() => api.current?.toggleStyle('bold')}
      >
        <Bold size={15} />
      </Btn>
      <Btn
        label="Italic"
        disabled={!text}
        active={!!text?.italic}
        onClick={() => api.current?.toggleStyle('italic')}
      >
        <Italic size={15} />
      </Btn>
      <Btn
        label="Underline"
        disabled={!text}
        active={!!text?.underline}
        onClick={() => api.current?.toggleStyle('underline')}
      >
        <UnderlineIcon size={15} />
      </Btn>
      <ColorPicker
        label="Text colour"
        icon={<Baseline size={15} />}
        disabled={!text}
        value={text?.color ?? '#0f172a'}
        colors={TEXT_COLORS}
        onChange={(c) => api.current?.setColor(c)}
      />
      <Sep />

      <Btn
        label="Align left"
        disabled={!text}
        active={(text?.align ?? 'left') === 'left'}
        onClick={() => api.current?.setTextProp({ align: 'left' })}
      >
        <AlignLeft size={15} />
      </Btn>
      <Btn
        label="Align centre"
        disabled={!text}
        active={text?.align === 'center'}
        onClick={() => api.current?.setTextProp({ align: 'center' })}
      >
        <AlignCenter size={15} />
      </Btn>
      <Btn
        label="Align right"
        disabled={!text}
        active={text?.align === 'right'}
        onClick={() => api.current?.setTextProp({ align: 'right' })}
      >
        <AlignRight size={15} />
      </Btn>
      <Btn
        label="Bullet list"
        disabled={!text}
        active={text?.list === 'bullet'}
        onClick={() => api.current?.setList(text?.list === 'bullet' ? undefined : 'bullet')}
      >
        <List size={15} />
      </Btn>
      <Btn
        label="Numbered list"
        disabled={!text}
        active={text?.list === 'number'}
        onClick={() => api.current?.setList(text?.list === 'number' ? undefined : 'number')}
      >
        <ListOrdered size={15} />
      </Btn>
      <Sep />

      {shape ? (
        <>
          <ColorPicker
            label="Fill"
            icon={<PaintBucket size={15} />}
            value={(shape.kind === 'shape' && shape.fill) || '#ffffff'}
            colors={FILL_COLORS}
            onChange={(fill) => api.current?.setShapeProp({ fill })}
          />
          <ColorPicker
            label="Outline"
            icon={<PenLine size={15} />}
            value={(shape.kind === 'shape' && shape.stroke) || '#0f172a'}
            colors={TEXT_COLORS}
            onChange={(stroke) => api.current?.setShapeProp({ stroke })}
          />
          <Sep />
        </>
      ) : null}

      {image ? (
        <>
          <Btn label="Replace image" onClick={onReplaceImage}>
            <ImageIcon size={15} />
          </Btn>
          <Select
            title="Image fit (player)"
            value={image.fit ?? 'stretch'}
            onChange={(e) => onImageFit(e.currentTarget.value as 'stretch' | 'cover' | 'contain')}
            className="h-7 px-1 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            <option value="stretch">Stretch</option>
            <option value="cover">Fill (crop)</option>
            <option value="contain">Fit</option>
          </Select>
          <Sep />
        </>
      ) : null}

      <Btn
        label="Bring forward"
        disabled={!any}
        onClick={() => api.current?.reorderSelected('forward')}
      >
        <BringToFront size={15} />
      </Btn>
      <Btn
        label="Send backward"
        disabled={!any}
        onClick={() => api.current?.reorderSelected('backward')}
      >
        <SendToBack size={15} />
      </Btn>
      <Btn label="Duplicate" disabled={!any} onClick={() => api.current?.duplicateSelected()}>
        <Copy size={15} />
      </Btn>
      <Btn label="Delete element" disabled={!any} onClick={() => api.current?.deleteSelected()}>
        <Trash2 size={15} className={any ? 'text-rose-500' : undefined} />
      </Btn>

      {children ? (
        <>
          <Sep />
          <div className="flex flex-wrap items-center gap-1">{children}</div>
        </>
      ) : null}
    </div>
  )
}

// --- primitives -----------------------------------------------------------------

function Btn({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(ev) => ev.preventDefault()} // keep canvas selection
      onClick={onClick}
      className={cn(
        'grid h-7 w-7 place-items-center rounded text-slate-600 transition-colors dark:text-slate-300',
        active
          ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200'
          : 'hover:bg-slate-100 dark:hover:bg-slate-800',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent dark:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-800" />
}

function FontSizeInput({
  value,
  onChange,
}: {
  value: number | null
  onChange: (size: number) => void
}) {
  // Uncontrolled, remounted when the selection's size changes — commits on
  // blur/Enter without state-sync effects.
  return (
    <input
      key={value == null ? 'none' : Math.round(value)}
      type="number"
      title="Font size"
      min={4}
      max={400}
      disabled={value == null}
      defaultValue={value == null ? '' : String(Math.round(value))}
      onBlur={(e) => {
        const n = Number(e.currentTarget.value)
        if (Number.isFinite(n) && n >= 4) onChange(Math.min(400, n))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className="h-7 w-14 rounded border border-transparent bg-transparent px-1 text-xs font-medium text-slate-700 hover:border-slate-200 focus:border-slate-300 focus:outline-none disabled:opacity-40 dark:text-slate-200 dark:hover:border-slate-700 dark:focus:border-slate-600"
    />
  )
}

export function ColorPicker({
  label,
  icon,
  value,
  colors,
  disabled = false,
  onChange,
}: {
  label: string
  icon: ReactNode
  value: string
  colors: string[]
  disabled?: boolean
  onChange: (color: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <span ref={rootRef} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        disabled={disabled}
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'grid h-7 w-8 place-items-center rounded text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          disabled &&
            'cursor-not-allowed opacity-40 hover:bg-transparent dark:hover:bg-transparent',
        )}
      >
        <span className="grid place-items-center">
          {icon}
          <span className="mt-0.5 block h-1 w-4 rounded-sm" style={{ background: value }} />
        </span>
        <ChevronDown size={8} className="-ml-1 hidden" />
      </button>
      {open && !disabled ? (
        <span className="absolute top-8 left-0 z-40 flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
              className={cn(
                'h-5 w-5 rounded border border-slate-200 dark:border-slate-700',
                value === c && 'ring-2 ring-teal-500 ring-offset-1 dark:ring-offset-slate-900',
              )}
              style={{ background: c }}
            />
          ))}
          <input
            type="color"
            title="Custom colour"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#0f172a'}
            onChange={(e) => onChange(e.currentTarget.value)}
            className="h-6 w-7 cursor-pointer rounded border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800"
          />
        </span>
      ) : null}
    </span>
  )
}
