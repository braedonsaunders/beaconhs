// Shared slide renderer — server-safe (no hooks). Used by the studio editor
// preview, the filmstrip thumbnails, present mode, and the learner player.
//
// `canvas` slides (the Fabric editor's model) render as a container-query
// scaled stage: positions/sizes are percentages of the virtual 960×540 stage
// and font/stroke sizes use cqw units, so the same markup is pixel-faithful
// from filmstrip thumbnails to fullscreen presenting. Legacy structured
// layouts and `pptx` page images keep their original branches.

import type { CSSProperties } from 'react'
import {
  SLIDE_STAGE,
  isRichRegion,
  type Slide,
  type SlideElement,
  type SlideRegion,
  type SlideTextElement,
  type SlideTextRun,
} from '@beaconhs/db/schema'
import { LessonBlocksView } from '../_lib/blocks'

// Mirrors SLIDE_FONT_CSS in training/_editor/slide-model.ts — duplicated so
// this file stays importable from server components. Fallbacks are CSS-only;
// the Fabric editor uses the bare first family.
const CANVAS_FONTS: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'Arial, sans-serif',
  serif: 'Georgia, serif',
  mono: 'Menlo, monospace',
}

// 1 stage unit → cqw (stage width = 100cqw).
const cqw = (units: number) => `${(units / SLIDE_STAGE.width) * 100}cqw`
const pctX = (units: number) => `${(units / SLIDE_STAGE.width) * 100}%`
const pctY = (units: number) => `${(units / SLIDE_STAGE.height) * 100}%`

function canvasBaseStyle(el: SlideElement): CSSProperties {
  return {
    position: 'absolute',
    left: pctX(el.x),
    top: pctY(el.y),
    width: pctX(el.w),
    opacity: el.opacity ?? 1,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: 'top left',
  }
}

function CanvasText({ el }: { el: SlideTextElement }) {
  const lines: SlideTextRun[][] = el.runs?.length
    ? el.runs
    : (el.text ?? '').split('\n').map((line) => [{ text: line }])
  return (
    <div
      style={{
        ...canvasBaseStyle(el),
        minHeight: pctY(el.h),
        fontFamily: CANVAS_FONTS[el.fontFamily ?? 'sans'],
        fontSize: cqw(el.fontSize),
        fontWeight: el.bold ? 700 : 400,
        fontStyle: el.italic ? 'italic' : 'normal',
        textDecoration: el.underline ? 'underline' : undefined,
        color: el.color ?? '#0f172a',
        textAlign: el.align ?? 'left',
        lineHeight: el.lineHeight ?? 1.2,
        overflowWrap: 'break-word',
      }}
    >
      {lines.map((line, li) => (
        <div key={li} style={{ minHeight: '1em' }}>
          {line.map((run, ri) => {
            const bold = run.bold ?? el.bold
            const italic = run.italic ?? el.italic
            const underline = run.underline ?? el.underline
            const color = run.color ?? undefined
            const plain = !run.bold && !run.italic && !run.underline && !run.color
            if (plain) return <span key={ri}>{run.text}</span>
            return (
              <span
                key={ri}
                style={{
                  fontWeight: bold ? 700 : 400,
                  fontStyle: italic ? 'italic' : 'normal',
                  textDecoration: underline ? 'underline' : undefined,
                  color,
                }}
              >
                {run.text}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function CanvasElementView({
  el,
  attachmentUrls,
}: {
  el: SlideElement
  attachmentUrls: Record<string, string | null | undefined>
}) {
  if (el.kind === 'text') return <CanvasText el={el} />

  if (el.kind === 'image') {
    const url = el.attachmentId ? attachmentUrls[el.attachmentId] : el.url
    const style: CSSProperties = {
      ...canvasBaseStyle(el),
      height: pctY(el.h),
      borderRadius: el.radius ? cqw(el.radius) : undefined,
      overflow: 'hidden',
    }
    if (!url) {
      return (
        <div
          style={{
            ...style,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f8fafc',
            border: '1px dashed #94a3b8',
            color: '#94a3b8',
            fontSize: cqw(12),
          }}
        >
          Image
        </div>
      )
    }
    const fit = el.fit === 'cover' ? 'cover' : el.fit === 'contain' ? 'contain' : 'fill'
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" style={{ ...style, objectFit: fit, display: 'block' }} />
    )
  }

  // shape
  const strokeW = el.strokeWidth ? cqw(el.strokeWidth) : '0'
  if (el.shape === 'line') {
    return (
      <div
        style={{
          ...canvasBaseStyle(el),
          height: 0,
          borderTop: `${cqw(el.strokeWidth ?? 2)} solid ${el.stroke ?? '#0f172a'}`,
        }}
      />
    )
  }
  return (
    <div
      style={{
        ...canvasBaseStyle(el),
        height: pctY(el.h),
        background: el.fill ?? 'transparent',
        border: el.strokeWidth ? `${strokeW} solid ${el.stroke ?? 'transparent'}` : undefined,
        borderRadius: el.shape === 'ellipse' ? '50%' : el.radius ? cqw(el.radius) : undefined,
        boxSizing: 'border-box',
      }}
    />
  )
}

/** Freeform Fabric-authored slide — scales with its container. */
function CanvasSlideContent({
  slide,
  attachmentUrls,
}: {
  slide: Slide
  attachmentUrls: Record<string, string | null | undefined>
}) {
  return (
    <div
      className="absolute inset-0"
      style={{ background: slide.bgColor ?? '#ffffff', containerType: 'inline-size' }}
    >
      {(slide.elements ?? []).map((el) => (
        <CanvasElementView key={el.id} el={el} attachmentUrls={attachmentUrls} />
      ))}
    </div>
  )
}

// Regions are RichDoc (TipTap HTML, sanitized server-side at save) or legacy
// LessonBlock[]. Consumers inject `.slide-rich` typography via lessonProseCss.
function Region({
  region,
  attachmentUrls,
}: {
  region: SlideRegion | undefined
  attachmentUrls: Record<string, string | null | undefined>
}) {
  if (!region) return null
  if (isRichRegion(region)) {
    return <div className="slide-rich" dangerouslySetInnerHTML={{ __html: region.html }} />
  }
  return <LessonBlocksView blocks={region} attachmentUrls={attachmentUrls} />
}

const BG: Record<NonNullable<Slide['bg']>, string> = {
  white: 'bg-white text-slate-900',
  slate: 'bg-slate-100 text-slate-900',
  teal: 'bg-teal-900 text-white',
  dark: 'bg-slate-900 text-white',
}

// Block content carries light-theme text classes; on dark backgrounds remap
// the common ones so regions stay readable.
const DARK_REGION =
  '[&_.text-slate-700]:text-slate-200 [&_.text-slate-800]:text-slate-100 [&_.text-slate-900]:text-white [&_.text-slate-600]:text-slate-300 [&_.text-slate-500]:text-slate-300'

export function SlideView({
  slide,
  attachmentUrls = {},
  className = '',
}: {
  slide: Slide
  attachmentUrls?: Record<string, string | null | undefined>
  className?: string
}) {
  const bg = BG[slide.bg ?? 'white']
  const isDark = slide.bg === 'teal' || slide.bg === 'dark'
  const regionCls = isDark ? DARK_REGION : ''
  const imgUrl = slide.imageAttachmentId ? attachmentUrls[slide.imageAttachmentId] : null

  return (
    <div className={`relative aspect-[16/9] w-full overflow-hidden ${bg} ${className}`}>
      {slide.layout === 'canvas' ? (
        <CanvasSlideContent slide={slide} attachmentUrls={attachmentUrls} />
      ) : null}

      {slide.layout === 'pptx' ? (
        imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgUrl} alt={slide.title ?? 'Slide'} className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs text-slate-400">
            Slide image unavailable
          </div>
        )
      ) : null}

      {slide.layout === 'title' ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-[8%] text-center">
          <h1 className="text-[clamp(1.4rem,4.5cqw,3rem)] leading-tight font-bold">
            {slide.title || 'Title slide'}
          </h1>
          {slide.subtitle ? (
            <p
              className={`text-[clamp(0.85rem,2.2cqw,1.4rem)] ${isDark ? 'text-white/70' : 'text-slate-500'}`}
            >
              {slide.subtitle}
            </p>
          ) : null}
        </div>
      ) : null}

      {slide.layout === 'title-content' ? (
        <div className="flex h-full flex-col gap-4 px-[7%] py-[6%]">
          <h2 className="shrink-0 text-[clamp(1.1rem,3cqw,2rem)] leading-tight font-bold">
            {slide.title || 'Slide title'}
          </h2>
          <div className={`min-h-0 flex-1 overflow-hidden ${regionCls}`}>
            <Region region={slide.body} attachmentUrls={attachmentUrls} />
          </div>
        </div>
      ) : null}

      {slide.layout === 'two-col' ? (
        <div className="flex h-full flex-col gap-4 px-[7%] py-[6%]">
          {slide.title ? (
            <h2 className="shrink-0 text-[clamp(1.1rem,3cqw,2rem)] leading-tight font-bold">
              {slide.title}
            </h2>
          ) : null}
          <div className={`grid min-h-0 flex-1 grid-cols-2 gap-[5%] overflow-hidden ${regionCls}`}>
            <Region region={slide.left} attachmentUrls={attachmentUrls} />
            <Region region={slide.right} attachmentUrls={attachmentUrls} />
          </div>
        </div>
      ) : null}

      {slide.layout === 'image-text' ? (
        <div className="grid h-full grid-cols-2">
          <div className="relative h-full overflow-hidden">
            {imgUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgUrl} alt={slide.title ?? ''} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center bg-slate-200 text-xs text-slate-400">
                Add an image
              </div>
            )}
          </div>
          <div className="flex h-full flex-col gap-3 overflow-hidden px-[8%] py-[8%]">
            {slide.title ? (
              <h2 className="shrink-0 text-[clamp(1rem,2.6cqw,1.7rem)] leading-tight font-bold">
                {slide.title}
              </h2>
            ) : null}
            <div className={`min-h-0 flex-1 overflow-hidden ${regionCls}`}>
              <Region region={slide.body} attachmentUrls={attachmentUrls} />
            </div>
          </div>
        </div>
      ) : null}

      {slide.layout === 'image-full' ? (
        <>
          {imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt={slide.title ?? ''} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center bg-slate-200 text-xs text-slate-400">
              Add an image
            </div>
          )}
          {slide.title ? (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-[7%] pt-[10%] pb-[5%]">
              <h2 className="text-[clamp(1rem,3cqw,2rem)] leading-tight font-bold text-white">
                {slide.title}
              </h2>
              {slide.subtitle ? (
                <p className="text-[clamp(0.75rem,1.8cqw,1.1rem)] text-white/80">
                  {slide.subtitle}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** Tiny filmstrip thumbnail — same layouts at postage-stamp size. */
export function SlideThumb({
  slide,
  attachmentUrls = {},
  className = '',
}: {
  slide: Slide
  attachmentUrls?: Record<string, string | null | undefined>
  className?: string
}) {
  const imgUrl = slide.imageAttachmentId ? attachmentUrls[slide.imageAttachmentId] : null
  const bg = BG[slide.bg ?? 'white']
  return (
    <div
      className={`relative aspect-[16/9] w-full overflow-hidden rounded border border-slate-200 ${bg} ${className}`}
    >
      {slide.layout === 'canvas' ? (
        <CanvasSlideContent slide={slide} attachmentUrls={attachmentUrls} />
      ) : slide.layout === 'pptx' || slide.layout === 'image-full' ? (
        imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-slate-100" />
        )
      ) : (
        <div className="flex h-full flex-col justify-center gap-0.5 px-2">
          <span className="truncate text-[8px] leading-tight font-bold">
            {slide.title || (slide.layout === 'title' ? 'Title' : 'Slide')}
          </span>
          <span className="block h-0.5 w-2/3 rounded bg-current opacity-20" />
          <span className="block h-0.5 w-1/2 rounded bg-current opacity-20" />
        </div>
      )}
    </div>
  )
}
