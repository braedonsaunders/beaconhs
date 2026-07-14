import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  normalizeTrainingExternalUrl,
  safeTrainingExternalUrl,
  trainingFrameSandbox,
} from './training-external-url'
import {
  configuredTrainingBlockedOrigins,
  validateTrainingExternalUrl,
} from './training-external-url.server'

const publicResolver = async () => [{ address: '93.184.216.34', family: 4 as const }]

describe('training external URL policy', () => {
  it.each([
    ['plain HTTP', 'http://media.acme.com/video.mp4', /must use HTTPS/],
    ['JavaScript', 'javascript:alert(1)', /must use HTTPS/],
    ['data URL', 'data:text/html,<script>alert(1)<\/script>', /must use HTTPS/],
    ['credentials', 'https://user:pass@media.acme.com/video.mp4', /username or password/],
    ['localhost', 'https://localhost/embed', /external public DNS hostname/],
    ['private IPv4', 'https://10.0.0.8/embed', /external public DNS hostname/],
    ['IPv6 loopback', 'https://[::1]/embed', /external public DNS hostname/],
  ])('rejects %s links before persistence or render', (_label, url, error) => {
    expect(() => normalizeTrainingExternalUrl(url)).toThrow(error)
    expect(safeTrainingExternalUrl(url)).toBeNull()
  })

  it.each([
    ['APP_URL', { APP_URL: 'https://app.beaconhs.com' }, 'https://app.beaconhs.com/api/auth'],
    [
      'BETTER_AUTH_URL',
      { BETTER_AUTH_URL: 'https://auth.beaconhs.com' },
      'https://auth.beaconhs.com/session',
    ],
    [
      'Collabora browser origin',
      { COLLABORA_URL: 'https://office.beaconhs.com' },
      'https://office.beaconhs.com/browser/hash/cool.html',
    ],
    [
      'Collabora WOPI origin',
      { COLLABORA_WOPI_URL: 'https://wopi.beaconhs.com' },
      'https://wopi.beaconhs.com/wopi/files/id',
    ],
  ])('rejects the configured %s', async (_label, environment, url) => {
    const resolver = vi.fn(publicResolver)
    await expect(validateTrainingExternalUrl(url, { environment, resolver })).rejects.toThrow(
      /cannot point to BeaconHS or its document editor/,
    )
    expect(resolver).not.toHaveBeenCalled()
  })

  it('blocks alternate ports on an application host because cookies are host-based', () => {
    expect(() =>
      normalizeTrainingExternalUrl('https://app.beaconhs.com:8443/embed', {
        blockedOrigins: ['https://app.beaconhs.com'],
      }),
    ).toThrow(/cannot point to BeaconHS/)
  })

  it('normalizes only exact, vetted YouTube and Vimeo URL shapes', () => {
    expect(normalizeTrainingExternalUrl('https://youtu.be/dQw4w9WgXcQ?si=tracking')).toEqual({
      url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      provider: 'youtube',
    })
    expect(
      normalizeTrainingExternalUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30'),
    ).toEqual({
      url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      provider: 'youtube',
    })
    expect(normalizeTrainingExternalUrl('https://player.vimeo.com/video/123456789')).toEqual({
      url: 'https://player.vimeo.com/video/123456789',
      provider: 'vimeo',
    })
    expect(normalizeTrainingExternalUrl('https://vimeo.com/123456789')).toEqual({
      url: 'https://player.vimeo.com/video/123456789',
      provider: 'vimeo',
    })
    expect(
      normalizeTrainingExternalUrl('https://www.youtube.com/embed/dQw4w9WgXcQ?start=30'),
    ).toEqual({
      url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30',
      provider: 'youtube',
    })
    expect(
      normalizeTrainingExternalUrl('https://player.vimeo.com/video/123456789?h=private-token'),
    ).toEqual({
      url: 'https://player.vimeo.com/video/123456789?h=private-token',
      provider: 'vimeo',
    })

    expect(() =>
      normalizeTrainingExternalUrl('https://www.youtube.com/channel/not-a-video'),
    ).toThrow(/valid YouTube/)
    expect(
      normalizeTrainingExternalUrl('https://youtube.com.attacker.net/watch?v=dQw4w9WgXcQ'),
    ).toEqual({
      url: 'https://youtube.com.attacker.net/watch?v=dQw4w9WgXcQ',
      provider: null,
    })
  })

  it('accepts a credential-free external HTTPS link and requires public DNS at save', async () => {
    const url = 'https://media.acme.com/training/video.mp4?edition=2#t=30'
    expect(normalizeTrainingExternalUrl(url)).toEqual({ url, provider: null })
    await expect(
      validateTrainingExternalUrl(url, { environment: {}, resolver: publicResolver }),
    ).resolves.toBe(url)

    await expect(
      validateTrainingExternalUrl(url, {
        environment: {},
        resolver: async () => [{ address: '169.254.169.254', family: 4 }],
      }),
    ).rejects.toThrow(/resolve only to public addresses/)
  })

  it('deduplicates configured origins and fails closed on malformed deployment URLs', () => {
    expect(
      configuredTrainingBlockedOrigins({
        APP_URL: 'https://app.beaconhs.com/path',
        BETTER_AUTH_URL: 'https://app.beaconhs.com',
        COLLABORA_URL: 'https://office.beaconhs.com',
      }),
    ).toEqual(['https://app.beaconhs.com', 'https://office.beaconhs.com'])
    expect(() => configuredTrainingBlockedOrigins({ APP_URL: 'not a URL' })).toThrow(
      /APP_URL must be a valid/,
    )
  })

  it('keeps same-origin capability only for vetted hosted-video players', () => {
    expect(trainingFrameSandbox(null)).toBe('allow-scripts allow-presentation')
    expect(trainingFrameSandbox('youtube')).toContain('allow-same-origin')
    expect(trainingFrameSandbox('vimeo')).toContain('allow-same-origin')
  })
})
