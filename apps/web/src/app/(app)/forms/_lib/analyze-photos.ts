import 'server-only'

// Shared safety photo-analysis helper — resolves attachment bytes + runs the
// vision model. Reused by the fill-time `photo_ai` element (via a 'use server'
// action) and the `analyze_photos` flow action (called directly in the on-submit
// runner). RLS-bound: attachments are read through ctx.db so a caller can only
// reach their own tenant's images.

import { inArray } from 'drizzle-orm'
import { attachments } from '@beaconhs/db/schema'
import { getObject } from '@beaconhs/storage'
import { runVisionAnalysis, type SafetyVisionAnalysis } from '@beaconhs/ai'
import type { RequestContext } from '@beaconhs/tenant'
import { getTenantAiConfig } from '@/lib/ai-config'

// Cost / latency bounds — analyse at most a handful of images, skip huge files.
const MAX_IMAGES = 4
const MAX_BYTES = 8 * 1024 * 1024

export type { SafetyVisionAnalysis }

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
  const ids = (attachmentIds ?? []).filter(Boolean).slice(0, MAX_IMAGES)
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
  for (const r of rows) {
    if (r.kind !== 'image') continue
    if (r.sizeBytes && r.sizeBytes > MAX_BYTES) continue
    try {
      const buf = await getObject({ key: r.r2Key })
      images.push(new Uint8Array(buf))
    } catch {
      // Skip an unreadable object rather than failing the whole analysis.
    }
  }
  if (images.length === 0) return null

  return runVisionAnalysis(aiConfig, { images, prompt: opts?.prompt })
}
