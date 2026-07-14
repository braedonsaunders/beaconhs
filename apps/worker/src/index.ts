import { Worker } from 'bullmq'
import './instrument'
import { closeJobConnections, getBlockingConnection } from '@beaconhs/jobs'
import { processEmail } from './workers/email'
import { processPdf } from './workers/pdf'
import { processNotification } from './workers/notify'
import { processScheduledTick } from './workers/scheduled'
import { processReportRun } from './workers/reports'
import { processOutboundDispatch } from './workers/outbound'
import { processPush } from './workers/push'
import { captureWorkerFailure, flushObservability } from './instrument'

console.log('[worker] starting beaconhs worker…')

const connection = getBlockingConnection()
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

let shutdownPromise: Promise<void> | null = null

const shutdown = (signal: NodeJS.Signals) => {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    console.log(`[worker] ${signal} received; draining active jobs…`)
    const closeResults = await Promise.allSettled(workers.map((worker) => worker.close()))
    let exitCode = 0
    for (let index = 0; index < closeResults.length; index++) {
      const result = closeResults[index]!
      if (result.status === 'fulfilled') continue
      exitCode = 1
      const worker = workers[index]!
      captureWorkerFailure(result.reason, { queue: worker.name, jobName: 'shutdown' })
      console.error(`[worker] ${worker.name} did not close cleanly:`, result.reason)
    }
    try {
      await closeJobConnections()
    } catch (error) {
      exitCode = 1
      captureWorkerFailure(error, { queue: 'redis', jobName: 'shutdown' })
      console.error('[worker] Redis connections did not close cleanly:', error)
    }
    try {
      await flushObservability()
    } catch (error) {
      exitCode = 1
      console.error('[worker] observability flush failed during shutdown:', error)
    }
    process.exit(exitCode)
  })()
  return shutdownPromise
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
