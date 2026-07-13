import { ensureBucket } from '@beaconhs/storage'

async function main(): Promise<void> {
  await ensureBucket()
  console.log('[storage-init] private bucket policy, lifecycle, and anonymous-read probe passed')
}

main().catch((error: unknown) => {
  console.error('[storage-init] failed:', error instanceof Error ? error.message : 'unknown error')
  process.exitCode = 1
})
