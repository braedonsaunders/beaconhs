import 'server-only'

// Shared safety photo-analysis helper — resolves attachment bytes + runs the
// vision model. Reused by the fill-time `photo_ai` element (via a 'use server'
// action) and the `analyze_photos` flow action (called directly in the on-submit
// runner). RLS-bound: attachments are read through ctx.db so a caller can only
// reach their own tenant's images.

import { inArray } from 'drizzle-orm'
import { attachments } from '@beaconhs/db/schema'
import { getObject, headObject } from '@beaconhs/storage'
import { AI_VISION_LIMITS, runVisionAnalysis, type SafetyVisionAnalysis } from '@beaconhs/ai'
import type { RequestContext } from '@beaconhs/tenant'
import { getTenantAiConfig } from '@/lib/ai-config'
import { isUuid } from '@/lib/list-params'

// Cost / latency bounds — analyse at most a handful of images, skip huge files.
/**
 * Run the construction-safety vision analysis over the given attachment ids.
 * Returns null when AI is unconfigured, no ids are image attachments, or every
 * image is unreadable / oversized.
 */
export async function analyzePhotoAttachments(
  ctx: RequestContext,
  attachmentIds: string[],
  opts?: { prompt?: string },
): Promise<SafetyVisionAnalysis | null> {
  const ids = [...new Set(attachmentIds ?? [])]
    .filter((id) => isUuid(id))
    .slice(0, AI_VISION_LIMITS.images)
  if (ids.length === 0) return null

  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig) return null

  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: attachments.id,
        r2Key: attachments.r2Key,
        kind: attachments.kind,
        sizeBytes: attachments.sizeBytes,
      })
      .from(attachments)
      .where(inArray(attachments.id, ids)),
  )

  const images: Uint8Array[] = []
  let totalBytes = 0
  for (const r of rows) {
    if (r.kind !== 'image') continue
    if (
      r.sizeBytes <= 0 ||
      r.sizeBytes > AI_VISION_LIMITS.imageBytes ||
      totalBytes > AI_VISION_LIMITS.totalImageBytes - r.sizeBytes
    ) {
      continue
    }
    try {
      const metadata = await headObject({ key: r.r2Key })
      if (!metadata || metadata.contentLength !== r.sizeBytes) continue
      const buf = await getObject({ key: r.r2Key })
      if (buf.length !== r.sizeBytes) continue
      images.push(new Uint8Array(buf))
      totalBytes += buf.length
    } catch {
      // Skip an unreadable object rather than failing the whole analysis.
    }
  }
  if (images.length === 0) return null

  return runVisionAnalysis(aiConfig, { images, prompt: opts?.prompt })
}
