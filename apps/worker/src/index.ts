import { Worker } from 'bullmq'
import { connection } from '@beaconhs/jobs'
import { processEmail } from './workers/email'
import { processPdf } from './workers/pdf'
import { processNotification } from './workers/notify'
import { processScheduledTick } from './workers/scheduled'

console.log('[worker] starting beaconhs worker…')

const workers = [
  new Worker('emails', processEmail, { connection, concurrency: 10 }),
  new Worker('pdfs', processPdf, { connection, concurrency: 3 }),
  new Worker('notifications', processNotification, { connection, concurrency: 10 }),
  new Worker('scheduled', processScheduledTick, { connection, concurrency: 5 }),
]

for (const w of workers) {
  w.on('completed', (job) => console.log(`✔ ${w.name}#${job.id} ${job.name}`))
  w.on('failed', (job, err) =>
    console.error(`✗ ${w.name}#${job?.id} ${job?.name}: ${err.message}`),
  )
  w.on('error', (err) => console.error(`! ${w.name}: ${err.message}`))
}

const shutdown = async () => {
  console.log('[worker] shutting down…')
  await Promise.all(workers.map((w) => w.close()))
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
