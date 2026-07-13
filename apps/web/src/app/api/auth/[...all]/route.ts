import { getAuth } from '@beaconhs/auth'
import { toNextJsHandler } from 'better-auth/next-js'

let handlers: ReturnType<typeof toNextJsHandler> | undefined

function getHandlers() {
  handlers ??= toNextJsHandler(getAuth())
  return handlers
}

export function GET(request: Request) {
  return getHandlers().GET(request)
}

export function POST(request: Request) {
  return getHandlers().POST(request)
}
