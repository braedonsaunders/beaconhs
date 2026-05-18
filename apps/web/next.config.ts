import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: [
    '@beaconhs/db',
    '@beaconhs/tenant',
    '@beaconhs/auth',
    '@beaconhs/forms-core',
    '@beaconhs/forms-pdf',
    '@beaconhs/ui',
    '@beaconhs/audit',
    '@beaconhs/emails',
    '@beaconhs/jobs',
    '@beaconhs/plugin-sdk',
  ],
  serverExternalPackages: ['postgres', 'bullmq', 'ioredis', 'puppeteer-core'],
}

export default nextConfig
