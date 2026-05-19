// One-off smoke test runner — enqueues all due schedules then exits.
import { reportsQueue } from '@beaconhs/jobs'
import { scanReportSchedules } from './lib/report-scheduler'

const main = async () => {
  console.log('[smoke] scanning for due schedules…')
  await scanReportSchedules()
  console.log('[smoke] done — closing queue')
  await reportsQueue.close()
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
