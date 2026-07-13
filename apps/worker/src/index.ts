import { Worker } from 'bullmq'
import './instrument'
import { getConnection } from '@beaconhs/jobs'
import { processEmail } from './workers/email'
import { processPdf } from './workers/pdf'
import { processNotification } from './workers/notify'
import { processScheduledTick } from './workers/scheduled'
import { processReportRun } from './workers/reports'
import { processOutboundDispatch } from './workers/outbound'
import { processPush } from './workers/push'
import { captureWorkerFailure, flushObservability } from './instrument'

console.log('[worker] starting beaconhs worker…')

const connection = getConnection()
const workers = [
  new Worker('emails', processEmail, { connection, concurrency: 10 }),
  new Worker('pdfs', processPdf, { connection, concurrency: 3 }),
  new Worker('notifications', processNotification, { connection, concurrency: 10 }),
  new Worker('scheduled', processScheduledTick, { connection, concurrency: 5 }),
  new Worker('reports', processReportRun, { connection, concurrency: 2 }),
  new Worker('outbound', processOutboundDispatch, { connection, concurrency: 5 }),
  new Worker('push', processPush, { connection, concurrency: 10 }),
]

for (const w of workers) {
  w.on('completed', (job) => console.log(`✔ ${w.name}#${job.id} ${job.name}`))
  w.on('failed', (job, err) => {
    captureWorkerFailure(err, {
      queue: w.name,
      jobId: job?.id,
      jobName: job?.name,
    })
    console.error(`✗ ${w.name}#${job?.id} ${job?.name}: ${err.message}`)
  })
  w.on('error', (err) => {
    captureWorkerFailure(err, { queue: w.name })
    console.error(`! ${w.name}: ${err.message}`)
  })
}

const shutdown = async () => {
  console.log('[worker] shutting down…')
  await Promise.all(workers.map((w) => w.close()))
  await flushObservability()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
