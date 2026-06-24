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
    '@beaconhs/sync',
    '@beaconhs/email-render',
  ],
  serverExternalPackages: [
    'postgres',
    // SMTP transport for the email-provider abstraction (Node-only) — used by the
    // "send test" server action; keep nodemailer out of the Next bundle.
    'nodemailer',
    // MJML email compiler (Node-only, heavy) — used in the email-template save
    // server action; keep it out of the Next bundle.
    'mjml',
    // SQL drivers used by the data-sync database connector (server-only).
    'mysql2',
    'mssql',
    'bullmq',
    'ioredis',
    // Web Push (Node crypto) — used by the test-push server action.
    'web-push',
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
      {
        source: `/${mod}/assignments`,
        destination: `/compliance/obligations?kind=${kind}`,
        permanent: false,
      },
      {
        source: `/${mod}/assignments/:path*`,
        destination: `/compliance/obligations?kind=${kind}`,
        permanent: false,
      },
    ]
    return [
      ...moved('journals', 'journal'),
      ...moved('inspections', 'inspection'),
      ...moved('documents', 'document'),
      ...moved('training', 'training'),
      // The Tools landing once linked the bulk-QR generator at /equipment/bulk-qr;
      // the real route is /equipment/qr/bulk. Preserve any stale bookmarks / PDFs.
      { source: '/equipment/bulk-qr', destination: '/equipment/qr/bulk', permanent: false },
      // Plugins retired in favour of the data-sync Integrations hub; the Library
      // & catalogues page is gone — those catalogues now live on each module's
      // Manage hub (and atmospheric sensors moved under Equipment).
      { source: '/admin/plugins', destination: '/admin/integrations', permanent: false },
      { source: '/admin/library', destination: '/admin', permanent: false },
    ]
  },
}

export default nextConfig
