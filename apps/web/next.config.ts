import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'
import { staticSecurityHeaders } from './src/lib/security-headers'

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: staticSecurityHeaders(process.env.NODE_ENV === 'production'),
      },
    ]
  },
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
    '@beaconhs/integrations',
    '@beaconhs/jobs',
    '@beaconhs/storage',
    '@beaconhs/sync',
    '@beaconhs/email-render',
  ],
  serverExternalPackages: [
    'postgres',
    // SMTP transport for the email-provider abstraction (Node-only) — used by the
    // "send test" server action; keep nodemailer out of the Next bundle.
    'nodemailer',
    // SQL drivers used by the data-sync database connector (server-only).
    'mysql2',
    'mssql',
    'bullmq',
    'ioredis',
    // Web Push (Node crypto) — used by the test-push server action.
    'web-push',
    // PDF text extraction (serverless pdf.js) for the assistant document tools.
    'unpdf',
    // Native canvas backend for unpdf's renderPageAsImage — the assistant
    // rasterizes scanned-PDF pages to PNG for vision reading. Ships per-platform
    // prebuilt .node binaries; must stay external so Next never tries to bundle it.
    '@napi-rs/canvas',
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
}

export default withSentryConfig(nextConfig, {
  silent: true,
})
