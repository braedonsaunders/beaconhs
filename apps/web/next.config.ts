import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@beaconhs/db',
    '@beaconhs/tenant',
    '@beaconhs/compliance',
    '@beaconhs/auth',
    '@beaconhs/forms-core',
    '@beaconhs/forms-pdf',
    '@beaconhs/ui',
    '@beaconhs/audit',
    '@beaconhs/emails',
    '@beaconhs/jobs',
    '@beaconhs/plugin-sdk',
    '@beaconhs/storage',
  ],
  serverExternalPackages: [
    'postgres',
    'bullmq',
    'ioredis',
    'puppeteer-core',
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
    // jsdom-backed sanitizer — keep it (and jsdom) out of the Next bundle.
    'isomorphic-dompurify',
    // DOCX generation (jszip etc.) — Node-only, used in the export route.
    '@turbodocx/html-to-docx',
    // DOCX → HTML import (mammoth) — Node-only, used in createDocument.
    'mammoth',
  ],
  // The per-module /…/assignments pages were decommissioned into the unified
  // compliance hub. Preserve bookmarks by redirecting them to the obligations
  // list, filtered to the matching kind.
  async redirects() {
    const moved = (mod: string, kind: string) => [
      { source: `/${mod}/assignments`, destination: `/compliance/obligations?kind=${kind}`, permanent: false },
      { source: `/${mod}/assignments/:path*`, destination: `/compliance/obligations?kind=${kind}`, permanent: false },
    ]
    return [
      ...moved('journals', 'journal'),
      ...moved('inspections', 'inspection'),
      ...moved('documents', 'document'),
      ...moved('training', 'training'),
    ]
  },
}

export default nextConfig
