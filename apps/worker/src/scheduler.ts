import './instrument'
import { registerSchedules } from '@beaconhs/jobs'
import { captureWorkerFailure, flushObservability } from './instrument'

async function main() {
  console.log('[scheduler] registering repeatable jobs…')
  await registerSchedules()
  console.log('[scheduler] done. Repeat schedules are persisted in Redis — exiting.')
  process.exit(0)
}

main().catch((err) => {
  captureWorkerFailure(err, { queue: 'scheduler', jobName: 'register-schedules' })
  console.error(err)
  void flushObservability().finally(() => process.exit(1))
})
