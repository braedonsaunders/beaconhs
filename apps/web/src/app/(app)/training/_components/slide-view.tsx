// Shared slide renderer — server-safe (no hooks). Used by the studio editor
// preview, the filmstrip thumbnails, present mode, and the learner player.
// Structured layouts over the bespoke LessonBlock regions; `pptx` slides are
// pixel-perfect page images from the PowerPoint import.

import { isRichRegion, type Slide, type SlideRegion } from '@beaconhs/db/schema'
import { LessonBlocksView } from '../_lib/blocks'

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
      {slide.layout === 'pptx' || slide.layout === 'image-full' ? (
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
