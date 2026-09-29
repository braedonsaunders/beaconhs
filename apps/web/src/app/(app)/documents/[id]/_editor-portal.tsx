'use client'

import { useLayoutEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { DocumentPane } from './_document-pane'
import type { DocumentEditorModel } from './_editor-model'

const SLOT_ID = 'document-editor-slot'

/**
 * The document page refreshes while a published PDF renders, and that route's
 * loading state can replace the page. This editor stays in the layout. It is
 * positioned over the page's right-hand slot, and when that slot disappears
 * the frame keeps its last pixel size so Writer does not reload or collapse
 * back to one painted page.
 */
export function DocumentEditorPortal({ model }: { model: DocumentEditorModel }) {
  const pathname = usePathname()
  const onWorkspace =
    pathname === `/documents/${model.documentId}` || pathname === `/documents/${model.documentId}/`
  const parkRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!onWorkspace) return
    const park = parkRef.current
    if (!park) return
    let frame = 0
    let slotObserver: ResizeObserver | null = null
    let observedSlot: Element | null = null

    const place = () => {
      const slot = document.getElementById(SLOT_ID)
      if (slot && observedSlot !== slot) {
        slotObserver?.disconnect()
        slotObserver = new ResizeObserver(() => {
          cancelAnimationFrame(frame)
          frame = requestAnimationFrame(place)
        })
        slotObserver.observe(slot)
        observedSlot = slot
      }
      if (slot && slot.clientWidth >= 40 && slot.clientHeight >= 40) {
        const rect = slot.getBoundingClientRect()
        const wasHidden = park.style.visibility !== 'visible'
        park.style.position = 'fixed'
        park.style.left = `${rect.left}px`
        park.style.top = `${rect.top}px`
        park.style.width = `${rect.width}px`
        park.style.height = `${rect.height}px`
        park.style.visibility = 'visible'
        park.style.pointerEvents = 'auto'
        park.style.zIndex = 'auto'
        if (wasHidden) window.dispatchEvent(new Event('beaconhs-collabora-relayout'))
        return
      }
      park.style.visibility = 'hidden'
      park.style.pointerEvents = 'none'
    }

    place()
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const onMove = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      slotObserver?.disconnect()
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [onWorkspace, model.documentId])

  if (!onWorkspace) return null

  return (
    <div ref={parkRef} className="min-h-0" style={{ position: 'fixed', visibility: 'hidden' }}>
      <DocumentPane
        key={model.documentId}
        documentId={model.documentId}
        canManage
        canPublish={model.canPublish}
        defaultMode={model.defaultMode}
        master={model.master}
        latestPublished={model.latestPublished}
        aiEnabled={model.aiEnabled}
      />
    </div>
  )
}
