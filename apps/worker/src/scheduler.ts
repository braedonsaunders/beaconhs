import { registerSchedules } from '@beaconhs/jobs'

async function main() {
  console.log('[scheduler] registering repeatable jobs…')
  await registerSchedules()
  console.log('[scheduler] done. Repeat schedules are persisted in Redis — exiting.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
