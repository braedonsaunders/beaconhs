import sharp from 'sharp'

export const UPLOADED_IMAGE_POLICY = {
  maxDimension: 2_560,
  reencodeThresholdBytes: 2 * 1024 * 1024,
  targetBytes: 4 * 1024 * 1024,
  maxInputPixels: 100_000_000,
} as const

const STATIC_IMAGE_TYPES = new Set([
  'image/avif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export type OptimizedUploadedImage = {
  body: Buffer
  contentType: string
  filename: string
  sizeBytes: number
  width: number
  height: number
  optimized: boolean
}

function normalizedType(contentType: string): string {
  return contentType.split(';', 1)[0]!.trim().toLowerCase()
}

function filenameWithExtension(filename: string, extension: 'jpg' | 'webp'): string {
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  return `${stem || 'photo'}.${extension}`
}

/**
 * Normalize large uploaded photos once at the shared attachment boundary.
 *
 * Animated GIFs are validated and retained because flattening them would
 * silently change their meaning. Static camera formats are auto-oriented,
 * stripped of bulky metadata, resized, and encoded into a browser-safe format.
 */
export async function optimizeUploadedImage(input: {
  body: Buffer
  contentType: string
  filename: string
}): Promise<OptimizedUploadedImage> {
  const contentType = normalizedType(input.contentType)
  const source = sharp(input.body, {
    animated: false,
    failOn: 'warning',
    limitInputPixels: UPLOADED_IMAGE_POLICY.maxInputPixels,
  })
  const metadata = await source.metadata()
  const width = metadata.autoOrient.width ?? metadata.width
  const height = metadata.autoOrient.height ?? metadata.height
  if (!width || !height) throw new Error('Uploaded image dimensions could not be read')

  if (contentType === 'image/gif' || !STATIC_IMAGE_TYPES.has(contentType)) {
    return {
      body: input.body,
      contentType,
      filename: input.filename,
      sizeBytes: input.body.length,
      width,
      height,
      optimized: false,
    }
  }

  const needsOptimization =
    input.body.length > UPLOADED_IMAGE_POLICY.reencodeThresholdBytes ||
    width > UPLOADED_IMAGE_POLICY.maxDimension ||
    height > UPLOADED_IMAGE_POLICY.maxDimension ||
    contentType === 'image/heic' ||
    contentType === 'image/heif'

  if (!needsOptimization) {
    return {
      body: input.body,
      contentType,
      filename: input.filename,
      sizeBytes: input.body.length,
      width,
      height,
      optimized: false,
    }
  }

  const encode = async (dimension: number, quality: number) => {
    const resized = source.clone().autoOrient().resize({
      width: dimension,
      height: dimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    return metadata.hasAlpha
      ? {
          body: await resized.webp({ quality, alphaQuality: 90, effort: 4 }).toBuffer(),
          contentType: 'image/webp',
          extension: 'webp' as const,
        }
      : {
          body: await resized.jpeg({ quality, progressive: true, mozjpeg: true }).toBuffer(),
          contentType: 'image/jpeg',
          extension: 'jpg' as const,
        }
  }

  const attempts = [
    [UPLOADED_IMAGE_POLICY.maxDimension, 84],
    [2_048, 78],
    [1_600, 72],
    [1_280, 66],
  ] as const
  let encoded: Awaited<ReturnType<typeof encode>> | null = null
  for (const [dimension, quality] of attempts) {
    encoded = await encode(dimension, quality)
    if (encoded.body.length <= UPLOADED_IMAGE_POLICY.targetBytes) break
  }
  if (!encoded || encoded.body.length > UPLOADED_IMAGE_POLICY.targetBytes) {
    throw new Error('Uploaded image could not be reduced to the safe storage size')
  }

  const outputMetadata = await sharp(encoded.body).metadata()
  if (!outputMetadata.width || !outputMetadata.height) {
    throw new Error('Optimized image dimensions could not be read')
  }
  return {
    body: encoded.body,
    contentType: encoded.contentType,
    filename: filenameWithExtension(input.filename, encoded.extension),
    sizeBytes: encoded.body.length,
    width: outputMetadata.width,
    height: outputMetadata.height,
    optimized: true,
  }
}
