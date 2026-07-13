import { Redis } from 'ioredis'
import type { ConnectionOptions } from 'bullmq'
import { getRedisUrl } from './config'

// BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`
// for blocking consumers; we use the same connection for producers in dev.
//
// We share one ioredis instance across every Queue/Worker, but do not create it
// while importing route modules. Next's production build evaluates the module
// graph without runtime services; only an actual queue or worker operation may
// materialize the connection. Under TS 6, ioredis 5.11's `Redis` class is no
// longer nominally assignable to BullMQ's `ConnectionOptions` union (upstream
// type drift between the two packages), so we assert the type at this boundary.
let connection: ConnectionOptions | undefined

export function getConnection(): ConnectionOptions {
  connection ??= new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
  }) as unknown as ConnectionOptions
  return connection
}
