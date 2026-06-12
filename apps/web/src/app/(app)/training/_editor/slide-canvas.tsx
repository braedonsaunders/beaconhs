'use client'

// Fabric-powered slide stage — the PowerPoint-style editing surface for one
// canvas slide. Elements live in React state (controlled via onElementsChange);
// this component reconciles them onto a Fabric canvas (engine shared from
// @beaconhs/design-studio), translates Fabric interactions back into element
// patches, and exposes an imperative handle the slide ribbon drives.
//
// Coordinates are virtual stage units (960×540); the canvas renders at the
// measured container width with a matching Fabric zoom, so objects are placed
// in unit space and never rescaled by layout.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { loadFabric } from '@beaconhs/design-studio/fabric'
import type {
  Slide,
  SlideElement,
  SlideShapeElement,
  SlideTextElement,
  SlideTextRun,
} from '@beaconhs/db/schema'
import {
  SLIDE_FONT_CSS,
  STAGE_H,
  STAGE_W,
  applyListStyle,
  applyTextStyle,
  genElementId,
  withRuns,
} from './slide-model'

const SNAP = 6 // unit distance for centre-snapping while dragging

export type SlideCanvasHandle = {
  addElement: (el: SlideElement) => void
  /** Toggle bold/italic/underline — inline when a text range is selected
   * during editing, otherwise across the selected text boxes. */
  toggleStyle: (prop: 'bold' | 'italic' | 'underline') => void
  setColor: (color: string) => void
  setTextProp: (
    patch: Partial<Pick<SlideTextElement, 'fontSize' | 'align' | 'lineHeight' | 'fontFamily'>>,
  ) => void
  setList: (list: 'bullet' | 'number' | undefined) => void
  setShapeProp: (patch: Partial<Pick<SlideShapeElement, 'fill' | 'stroke' | 'strokeWidth'>>) => void
  deleteSelected: () => void
  duplicateSelected: () => void
  reorderSelected: (dir: 'forward' | 'backward') => void
  selectedIds: () => string[]
}

type ObjectEntry = { obj: any; el: SlideElement; sig: string; natural?: { w: number; h: number } }

const round1 = (v: number) => Math.round(v * 10) / 10
const isBoldWeight = (w: unknown) =>
  w === 'bold' || w === '700' || w === '800' || (typeof w === 'number' && w >= 600)

function urlForElement(
  el: SlideElement,
  urls: Record<string, string | null | undefined>,
): string | null {
  if (el.kind !== 'image') return null
  if (el.attachmentId) return urls[el.attachmentId] ?? null
  return el.url ?? null
}

// Signature changes force a rebuild of the Fabric object (async images, shape
// geometry that Fabric can't cheaply mutate in place).
function signatureFor(el: SlideElement, url: string | null): string {
  if (el.kind === 'image') return `image:${url ?? 'placeholder'}`
  if (el.kind === 'shape') return `shape:${el.shape}:${el.shape === 'line' ? el.w : ''}`
  return 'text'
}

// --- runs <-> Fabric per-character styles ------------------------------------

function runsToFabricStyles(el: SlideTextElement): Record<number, Record<number, any>> {
  const styles: Record<number, Record<number, any>> = {}
  if (!el.runs) return styles
  el.runs.forEach((line, li) => {
    let ci = 0
    for (const run of line) {
      const o: Record<string, unknown> = {}
      if (run.bold != null && run.bold !== !!el.bold) o.fontWeight = run.bold ? '700' : '400'
      if (run.italic != null && run.italic !== !!el.italic)
        o.fontStyle = run.italic ? 'italic' : 'normal'
      if (run.underline != null && run.underline !== !!el.underline) o.underline = !!run.underline
      if (run.color && run.color !== (el.color ?? '#0f172a')) o.fill = run.color
      if (Object.keys(o).length) {
        for (let k = 0; k < run.text.length; k++) {
          ;(styles[li] ??= {})[ci + k] = { ...o }
        }
      }
      ci += run.text.length
    }
  })
  return styles
}

function fabricStylesToRuns(obj: any, el: SlideTextElement): SlideTextRun[][] {
  const text: string = obj.text ?? ''
  const styles = obj.styles ?? {}
  return text.split('\n').map((line, li) => {
    if (!line.length) return [{ text: '' }]
    const runs: SlideTextRun[] = []
    for (let ci = 0; ci < line.length; ci++) {
      const s = styles?.[li]?.[ci] ?? {}
      const run: SlideTextRun = { text: line[ci]! }
      if (s.fontWeight != null) run.bold = isBoldWeight(s.fontWeight)
      if (s.fontStyle != null) run.italic = s.fontStyle === 'italic'
      if (s.underline != null) run.underline = !!s.underline
      if (typeof s.fill === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.fill)) run.color = s.fill
      const prev = runs[runs.length - 1]
      if (
        prev &&
        prev.bold === run.bold &&
        prev.italic === run.italic &&
        prev.underline === run.underline &&
        prev.color === run.color
      ) {
        prev.text += run.text
      } else {
        runs.push(run)
      }
    }
    return runs
  })
}

// -----------------------------------------------------------------------------

export const SlideCanvasEditor = forwardRef<
  SlideCanvasHandle,
  {
    slide: Slide
    urls: Record<string, string | null | undefined>
    onElementsChange: (elements: SlideElement[]) => void
    onSelectionChange: (ids: string[]) => void
    onRequestImage: (elementId: string) => void
  }
>(function SlideCanvasEditor(
  { slide, urls, onElementsChange, onSelectionChange, onRequestImage },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<any>(null)
  const canvasRef = useRef<any>(null)
  const entriesRef = useRef(new Map<string, ObjectEntry>())
  const pendingSelectRef = useRef<string | null>(null)

  const slideRef = useRef(slide)
  slideRef.current = slide
  const urlsRef = useRef(urls)
  urlsRef.current = urls
  const onElementsChangeRef = useRef(onElementsChange)
  onElementsChangeRef.current = onElementsChange
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange
  const onRequestImageRef = useRef(onRequestImage)
  onRequestImageRef.current = onRequestImage

  // Synchronous source of truth between renders: Fabric can fire several
  // handlers in one tick (e.g. text editing exit fires `editing:exited` AND
  // `object:modified`) — each must see the previous one's commit, but React
  // state only catches up on the next render. The reconcile effect re-syncs
  // this ref from the authoritative `slide.elements` prop.
  const elementsLiveRef = useRef<SlideElement[]>(slide.elements ?? [])

  const elements = useCallback(() => elementsLiveRef.current, [])
  const commitElements = useCallback((next: SlideElement[]) => {
    elementsLiveRef.current = next
    onElementsChangeRef.current(next)
  }, [])
  const findEl = useCallback(
    (id: string | null | undefined) => elements().find((e) => e.id === id) ?? null,
    [elements],
  )
  const replaceElements = useCallback(
    (patches: Map<string, Partial<SlideElement> | SlideElement>) => {
      commitElements(
        elements().map((e) => {
          const p = patches.get(e.id)
          if (!p) return e
          return ('id' in p ? p : { ...e, ...p }) as SlideElement
        }),
      )
    },
    [commitElements, elements],
  )

  // --- Fabric object factory / updater ---------------------------------------

  const applyBaseProps = useCallback((obj: any, el: SlideElement) => {
    obj.set({
      left: el.x,
      top: el.y,
      originX: 'left',
      originY: 'top',
      angle: el.rotation ?? 0,
      opacity: el.opacity ?? 1,
      selectable: !el.locked,
      evented: !el.locked,
      lockMovementX: !!el.locked,
      lockMovementY: !!el.locked,
      lockScalingX: !!el.locked,
      lockScalingY: !!el.locked,
      lockRotation: !!el.locked,
    })
  }, [])

  const applyTextProps = useCallback((obj: any, el: SlideTextElement) => {
    obj.set({
      text: el.text,
      width: el.w,
      fontFamily: SLIDE_FONT_CSS[el.fontFamily ?? 'sans'],
      fontSize: el.fontSize,
      fontWeight: el.bold ? '700' : '400',
      fontStyle: el.italic ? 'italic' : 'normal',
      underline: !!el.underline,
      fill: el.color ?? '#0f172a',
      textAlign: el.align ?? 'left',
      lineHeight: el.lineHeight ?? 1.2,
      scaleX: 1,
      scaleY: 1,
    })
    obj.styles = runsToFabricStyles(el)
    obj.initDimensions?.()
  }, [])

  const applyShapeProps = useCallback((obj: any, el: SlideShapeElement) => {
    if (el.shape === 'ellipse') {
      obj.set({
        rx: el.w / 2,
        ry: el.h / 2,
        fill: el.fill ?? 'transparent',
        stroke: el.stroke ?? 'transparent',
        strokeWidth: el.strokeWidth ?? 0,
        scaleX: 1,
        scaleY: 1,
      })
    } else if (el.shape === 'line') {
      obj.set({
        stroke: el.stroke ?? '#0f172a',
        strokeWidth: el.strokeWidth ?? 2,
        scaleX: 1,
        scaleY: 1,
      })
    } else {
      obj.set({
        width: el.w,
        height: el.h,
        fill: el.fill ?? 'transparent',
        stroke: el.stroke ?? 'transparent',
        strokeWidth: el.strokeWidth ?? 0,
        rx: el.radius ?? 0,
        ry: el.radius ?? 0,
        scaleX: 1,
        scaleY: 1,
      })
    }
  }, [])

  const createObject = useCallback(
    (el: SlideElement, sig: string) => {
      const fabric = fabricRef.current
      const canvas = canvasRef.current
      if (!fabric || !canvas) return
      const entries = entriesRef.current

      const register = (obj: any) => {
        obj.beaconId = el.id
        applyBaseProps(obj, el)
        obj.setCoords()
        entries.set(el.id, { ...(entries.get(el.id) ?? {}), obj, el, sig } as ObjectEntry)
        canvas.add(obj)
      }

      if (el.kind === 'text') {
        const tb = new fabric.Textbox(el.text, { editable: true })
        applyTextProps(tb, el)
        register(tb)
        return
      }

      if (el.kind === 'shape') {
        if (el.shape === 'ellipse') {
          const o = new fabric.Ellipse({})
          applyShapeProps(o, el)
          register(o)
        } else if (el.shape === 'line') {
          const o = new fabric.Line([0, 0, el.w, 0], {})
          applyShapeProps(o, el)
          register(o)
        } else {
          const o = new fabric.Rect({})
          applyShapeProps(o, el)
          register(o)
        }
        return
      }

      // image — placeholder rect immediately, swap to the bitmap when loaded
      const url = urlForElement(el, urlsRef.current)
      const placeholder = new fabric.Rect({
        width: el.w,
        height: el.h,
        fill: url ? '#f1f5f9' : '#f8fafc',
        stroke: '#94a3b8',
        strokeDashArray: url ? undefined : [8, 5],
        strokeWidth: 1.5,
        rx: el.radius ?? 0,
        ry: el.radius ?? 0,
      })
      register(placeholder)
      if (!url) return
      void fabric.FabricImage.fromURL(url)
        .then((img: any) => {
          const entry = entriesRef.current.get(el.id)
          const live = canvasRef.current
          // Stale load (slide switched, element removed, or source replaced).
          if (!live || !entry || entry.sig !== sig || entry.obj !== placeholder) return
          const natural = { w: img.width || 1, h: img.height || 1 }
          const index = live.getObjects().indexOf(placeholder)
          live.remove(placeholder)
          img.beaconId = el.id
          const current = findEl(el.id) ?? el
          img.set({ scaleX: current.w / natural.w, scaleY: current.h / natural.h })
          applyBaseProps(img, current)
          img.setCoords()
          entriesRef.current.set(el.id, { obj: img, el: current, sig, natural })
          live.add(img)
          if (index >= 0) live.moveObjectTo?.(img, index)
          if (live.getActiveObject() === placeholder) live.setActiveObject(img)
          live.requestRenderAll()
        })
        .catch(() => {
          // Keep the placeholder — author can replace the image.
        })
    },
    [applyBaseProps, applyShapeProps, applyTextProps, findEl],
  )

  const updateObject = useCallback(
    (entry: ObjectEntry, el: SlideElement) => {
      const obj = entry.obj
      if (el.kind === 'text' && obj.isEditing) {
        entry.el = el
        return // never stomp an active editing session
      }
      applyBaseProps(obj, el)
      if (el.kind === 'text') applyTextProps(obj, el)
      if (el.kind === 'shape') applyShapeProps(obj, el)
      if (el.kind === 'image') {
        if (entry.natural) {
          obj.set({ scaleX: el.w / entry.natural.w, scaleY: el.h / entry.natural.h })
        } else {
          obj.set({ width: el.w, height: el.h, scaleX: 1, scaleY: 1 })
        }
      }
      obj.setCoords()
      entry.el = el
    },
    [applyBaseProps, applyShapeProps, applyTextProps],
  )

  const reconcile = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const entries = entriesRef.current
    // Re-adopt the authoritative prop (parent state has caught up by the time
    // the effect runs) so optimistic live-ref values never drift.
    elementsLiveRef.current = slideRef.current.elements ?? []
    const els = elementsLiveRef.current
    canvas.backgroundColor = slideRef.current.bgColor ?? '#ffffff'

    const seen = new Set<string>()
    for (const el of els) {
      seen.add(el.id)
      const url = urlForElement(el, urlsRef.current)
      const sig = signatureFor(el, url)
      const entry = entries.get(el.id)
      if (!entry) {
        createObject(el, sig)
      } else if (entry.sig !== sig) {
        const wasActive = canvas.getActiveObject() === entry.obj
        canvas.remove(entry.obj)
        entries.delete(el.id)
        createObject(el, sig)
        const next = entries.get(el.id)
        if (wasActive && next) canvas.setActiveObject(next.obj)
      } else {
        updateObject(entry, el)
      }
    }
    for (const [id, entry] of entries) {
      if (!seen.has(id)) {
        canvas.remove(entry.obj)
        entries.delete(id)
      }
    }
    // Stacking mirrors array order.
    els.forEach((el, idx) => {
      const obj = entries.get(el.id)?.obj
      if (obj) canvas.moveObjectTo?.(obj, idx)
    })
    if (pendingSelectRef.current) {
      const obj = entries.get(pendingSelectRef.current)?.obj
      pendingSelectRef.current = null
      if (obj && obj.selectable) canvas.setActiveObject(obj)
    }
    canvas.requestRenderAll()
  }, [createObject, updateObject])

  // --- interaction read-back ---------------------------------------------------

  const patchFromObject = useCallback((el: SlideElement, obj: any): Partial<SlideElement> => {
    const sx = obj.scaleX ?? 1
    const sy = obj.scaleY ?? 1
    const patch: Record<string, unknown> = {
      x: round1(obj.left ?? el.x),
      y: round1(obj.top ?? el.y),
    }
    const angle = Math.round(obj.angle ?? 0)
    patch.rotation = angle === 0 ? undefined : angle
    if (el.kind === 'text') {
      const fontSize = round1((obj.fontSize ?? (el as SlideTextElement).fontSize) * sy)
      patch.w = round1((obj.width ?? el.w) * sx)
      patch.h = round1((obj.height ?? el.h) * sy)
      patch.fontSize = fontSize
      obj.set({ width: patch.w, fontSize, scaleX: 1, scaleY: 1 })
      obj.initDimensions?.()
    } else if (el.kind === 'shape' && el.shape === 'line') {
      patch.w = round1((obj.width ?? el.w) * sx)
    } else {
      patch.w = round1(obj.getScaledWidth?.() ?? (obj.width ?? el.w) * sx)
      patch.h = round1(obj.getScaledHeight?.() ?? (obj.height ?? el.h) * sy)
    }
    return patch as Partial<SlideElement>
  }, [])

  const commitModified = useCallback(
    (target: any) => {
      const fabric = fabricRef.current
      const canvas = canvasRef.current
      if (!canvas) return
      const patches = new Map<string, Partial<SlideElement>>()
      if (fabric && target instanceof fabric.ActiveSelection) {
        const children = target.getObjects()
        canvas.discardActiveObject() // bakes absolute coords back onto children
        for (const obj of children) {
          const el = findEl(obj.beaconId)
          if (el) patches.set(el.id, patchFromObject(el, obj))
        }
      } else {
        const el = findEl(target?.beaconId)
        if (el) patches.set(el.id, patchFromObject(el, target))
      }
      if (patches.size) replaceElements(patches)
    },
    [findEl, patchFromObject, replaceElements],
  )

  const syncTextFromObject = useCallback(
    (obj: any) => {
      const el = findEl(obj?.beaconId)
      if (!el || el.kind !== 'text') return
      let next = withRuns({ ...el, h: round1(obj.height ?? el.h) }, fabricStylesToRuns(obj, el))
      if (next.list) next = applyListStyle(next, next.list)
      replaceElements(new Map([[el.id, next]]))
    },
    [findEl, replaceElements],
  )

  // --- mount ---------------------------------------------------------------------

  useEffect(() => {
    let disposed = false
    const entries = entriesRef.current
    void loadFabric().then((fabric) => {
      if (disposed || !canvasElRef.current || !wrapRef.current) return
      fabricRef.current = fabric
      const width = Math.max(wrapRef.current.clientWidth, 320)
      const canvas = new fabric.Canvas(canvasElRef.current, {
        width,
        height: (width * STAGE_H) / STAGE_W,
        preserveObjectStacking: true,
        selection: true,
        backgroundColor: slideRef.current.bgColor ?? '#ffffff',
      })
      canvas.setZoom(width / STAGE_W)
      canvasRef.current = canvas

      const reportSelection = () => {
        const active = canvas.getActiveObjects?.() ?? []
        onSelectionChangeRef.current(
          active.map((o: any) => o.beaconId).filter((id: unknown): id is string => !!id),
        )
      }
      canvas.on('selection:created', reportSelection)
      canvas.on('selection:updated', reportSelection)
      canvas.on('selection:cleared', () => onSelectionChangeRef.current([]))
      canvas.on('object:modified', (e: any) => commitModified(e.target))
      canvas.on('text:editing:exited', (e: any) => syncTextFromObject(e.target))
      canvas.on('mouse:dblclick', (e: any) => {
        const el = findEl(e.target?.beaconId)
        if (el?.kind === 'image' && !el.locked) onRequestImageRef.current(el.id)
      })
      // Magnetic centre guides while dragging un-rotated objects.
      canvas.on('object:moving', (e: any) => {
        const obj = e.target
        if (!obj || obj.angle) return
        const w = obj.getScaledWidth?.() ?? 0
        const h = obj.getScaledHeight?.() ?? 0
        if (Math.abs(obj.left + w / 2 - STAGE_W / 2) < SNAP) obj.set({ left: STAGE_W / 2 - w / 2 })
        if (Math.abs(obj.top + h / 2 - STAGE_H / 2) < SNAP) obj.set({ top: STAGE_H / 2 - h / 2 })
      })

      reconcile()

      const ro = new ResizeObserver(() => {
        const live = canvasRef.current
        const wrap = wrapRef.current
        if (!live || !wrap) return
        const w = Math.max(wrap.clientWidth, 320)
        live.setDimensions({ width: w, height: (w * STAGE_H) / STAGE_W })
        live.setZoom(w / STAGE_W)
        live.requestRenderAll()
      })
      ro.observe(wrapRef.current)
      ;(canvas as any).__beaconResizeObserver = ro
    })
    return () => {
      disposed = true
      const canvas = canvasRef.current
      ;(canvas as any)?.__beaconResizeObserver?.disconnect()
      canvasRef.current = null
      entries.clear()
      void canvas?.dispose()
    }
    // Mounted once per slide — the parent keys this component by slide id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    reconcile()
  }, [slide.elements, slide.bgColor, urls, reconcile])

  // --- keyboard --------------------------------------------------------------------

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const active = canvas.getActiveObject?.()
      if (active?.isEditing) return // Fabric owns keys during text editing
      const selected: any[] = canvas.getActiveObjects?.() ?? []
      if (!selected.length) return
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        deleteSelectedInternal()
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        duplicateSelectedInternal()
        return
      }
      const step = e.shiftKey ? 10 : 1
      const move: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const delta = move[e.key]
      if (!delta) return
      e.preventDefault()
      const patches = new Map<string, Partial<SlideElement>>()
      for (const obj of selected) {
        const el = findEl(obj.beaconId)
        if (!el || el.locked) continue
        patches.set(el.id, { x: round1(el.x + delta[0]), y: round1(el.y + delta[1]) })
      }
      if (patches.size) replaceElements(patches)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [findEl, replaceElements],
  )

  // --- imperative handle (driven by the ribbon) ---------------------------------------

  const selectedIdsInternal = useCallback((): string[] => {
    const canvas = canvasRef.current
    return (canvas?.getActiveObjects?.() ?? [])
      .map((o: any) => o.beaconId)
      .filter((id: unknown): id is string => !!id)
  }, [])

  const deleteSelectedInternal = useCallback(() => {
    const canvas = canvasRef.current
    const ids = new Set(selectedIdsInternal())
    if (!ids.size) return
    canvas?.discardActiveObject()
    commitElements(elements().filter((e) => !ids.has(e.id)))
    onSelectionChangeRef.current([])
  }, [commitElements, elements, selectedIdsInternal])

  const duplicateSelectedInternal = useCallback(() => {
    const ids = new Set(selectedIdsInternal())
    if (!ids.size) return
    const clones: SlideElement[] = elements()
      .filter((e) => ids.has(e.id))
      .map((e) => ({
        ...structuredClone(e),
        id: genElementId(),
        x: e.x + 16,
        y: e.y + 16,
        locked: undefined,
      }))
    commitElements([...elements(), ...clones])
    if (clones.length === 1) pendingSelectRef.current = clones[0]!.id
  }, [commitElements, elements, selectedIdsInternal])

  // Inline (range) styling while editing; returns false when there is no range.
  const applyInline = useCallback(
    (style: Record<string, unknown>): boolean => {
      const canvas = canvasRef.current
      const obj = canvas?.getActiveObject?.()
      if (!obj?.isEditing || obj.selectionStart === obj.selectionEnd) return false
      obj.setSelectionStyles(style)
      canvas.requestRenderAll()
      const el = findEl(obj.beaconId)
      if (el?.kind === 'text') {
        replaceElements(new Map([[el.id, withRuns(el, fabricStylesToRuns(obj, el))]]))
      }
      return true
    },
    [findEl, replaceElements],
  )

  const selectedTextElements = useCallback(
    (): SlideTextElement[] =>
      selectedIdsInternal()
        .map((id) => findEl(id))
        .filter((e): e is SlideTextElement => e?.kind === 'text'),
    [findEl, selectedIdsInternal],
  )

  useImperativeHandle(
    ref,
    (): SlideCanvasHandle => ({
      addElement: (el) => {
        pendingSelectRef.current = el.id
        commitElements([...elements(), el])
      },
      toggleStyle: (prop) => {
        const canvas = canvasRef.current
        const obj = canvas?.getActiveObject?.()
        const el = findEl(obj?.beaconId)
        if (obj?.isEditing && obj.selectionStart !== obj.selectionEnd && el?.kind === 'text') {
          const styles: any[] = obj.getSelectionStyles?.() ?? []
          const fabricKey =
            prop === 'bold' ? 'fontWeight' : prop === 'italic' ? 'fontStyle' : 'underline'
          const isOn = (s: any) =>
            prop === 'bold'
              ? s.fontWeight != null
                ? isBoldWeight(s.fontWeight)
                : !!el.bold
              : prop === 'italic'
                ? s.fontStyle != null
                  ? s.fontStyle === 'italic'
                  : !!el.italic
                : s.underline != null
                  ? !!s.underline
                  : !!el.underline
          const allOn = styles.length > 0 && styles.every(isOn)
          const value =
            prop === 'bold'
              ? allOn
                ? '400'
                : '700'
              : prop === 'italic'
                ? allOn
                  ? 'normal'
                  : 'italic'
                : !allOn
          if (applyInline({ [fabricKey]: value })) return
        }
        const targets = selectedTextElements()
        if (!targets.length) return
        const on = !targets[0]![prop]
        replaceElements(new Map(targets.map((t) => [t.id, applyTextStyle(t, { [prop]: on })])))
      },
      setColor: (color) => {
        if (applyInline({ fill: color })) return
        const patches = new Map<string, SlideElement>()
        for (const id of selectedIdsInternal()) {
          const el = findEl(id)
          if (el?.kind === 'text') patches.set(id, applyTextStyle(el, { color }))
        }
        if (patches.size) replaceElements(patches)
      },
      setTextProp: (patch) => {
        const targets = selectedTextElements()
        if (!targets.length) return
        replaceElements(new Map(targets.map((t) => [t.id, { ...t, ...patch }])))
      },
      setList: (list) => {
        const targets = selectedTextElements()
        if (!targets.length) return
        replaceElements(new Map(targets.map((t) => [t.id, applyListStyle(t, list)])))
      },
      setShapeProp: (patch) => {
        const patches = new Map<string, SlideElement>()
        for (const id of selectedIdsInternal()) {
          const el = findEl(id)
          if (el?.kind === 'shape') patches.set(id, { ...el, ...patch })
        }
        if (patches.size) replaceElements(patches)
      },
      deleteSelected: deleteSelectedInternal,
      duplicateSelected: duplicateSelectedInternal,
      reorderSelected: (dir) => {
        const ids = new Set(selectedIdsInternal())
        if (!ids.size) return
        const els = [...elements()]
        const indices = els.map((e, i) => (ids.has(e.id) ? i : -1)).filter((i) => i >= 0)
        if (dir === 'forward') {
          for (const i of [...indices].reverse()) {
            if (i < els.length - 1 && !ids.has(els[i + 1]!.id)) {
              ;[els[i], els[i + 1]] = [els[i + 1]!, els[i]!]
            }
          }
        } else {
          for (const i of indices) {
            if (i > 0 && !ids.has(els[i - 1]!.id)) {
              ;[els[i], els[i - 1]] = [els[i - 1]!, els[i]!]
            }
          }
        }
        commitElements(els)
      },
      selectedIds: selectedIdsInternal,
    }),
    [
      applyInline,
      commitElements,
      deleteSelectedInternal,
      duplicateSelectedInternal,
      elements,
      findEl,
      replaceElements,
      selectedIdsInternal,
      selectedTextElements,
    ],
  )

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        // Keep keyboard shortcuts live without stealing focus from Fabric's
        // hidden textarea once text editing starts.
        if (!(canvasRef.current?.getActiveObject?.()?.isEditing ?? false)) {
          e.currentTarget.focus({ preventScroll: true })
        }
      }}
      className="relative w-full overflow-hidden rounded-lg border border-slate-200 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      style={{ aspectRatio: '16 / 9' }}
    >
      <canvas ref={canvasElRef} />
    </div>
  )
})
