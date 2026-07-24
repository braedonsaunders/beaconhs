import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { optimizeUploadedImage, UPLOADED_IMAGE_POLICY } from './image-upload-optimization'

describe('uploaded image optimization', () => {
  it('resizes and recompresses an oversized camera photo', async () => {
    const original = await sharp({
      create: {
        width: 4_096,
        height: 3_072,
        channels: 3,
        background: { r: 90, g: 140, b: 190 },
      },
    })
      .jpeg({ quality: 100 })
      .toBuffer()

    const result = await optimizeUploadedImage({
      body: original,
      contentType: 'image/jpeg',
      filename: 'site-photo.jpeg',
    })

    expect(result.optimized).toBe(true)
    expect(result.contentType).toBe('image/jpeg')
    expect(result.filename).toBe('site-photo.jpg')
    expect(result.width).toBeLessThanOrEqual(UPLOADED_IMAGE_POLICY.maxDimension)
    expect(result.height).toBeLessThanOrEqual(UPLOADED_IMAGE_POLICY.maxDimension)
    expect(result.sizeBytes).toBe(result.body.length)
    expect(result.sizeBytes).toBeLessThanOrEqual(UPLOADED_IMAGE_POLICY.targetBytes)
  })

  it('retains a small image without rewriting it', async () => {
    const original = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 20, g: 40, b: 60 },
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer()

    const result = await optimizeUploadedImage({
      body: original,
      contentType: 'image/jpeg; charset=binary',
      filename: 'small.jpg',
    })

    expect(result.optimized).toBe(false)
    expect(result.body).toEqual(original)
    expect(result.contentType).toBe('image/jpeg')
    expect(result.filename).toBe('small.jpg')
    expect(result.width).toBe(640)
    expect(result.height).toBe(480)
  })

  it('converts a large transparent image to webp', async () => {
    const original = await sharp({
      create: {
        width: 3_000,
        height: 2_000,
        channels: 4,
        background: { r: 120, g: 80, b: 40, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer()

    const result = await optimizeUploadedImage({
      body: original,
      contentType: 'image/png',
      filename: 'markup.png',
    })

    expect(result.optimized).toBe(true)
    expect(result.contentType).toBe('image/webp')
    expect(result.filename).toBe('markup.webp')
  })
})
