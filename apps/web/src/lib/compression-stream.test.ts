import { createServer, get, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { type EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const compression = require('next/dist/compiled/compression') as () => (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void
const { pipeNodeReadableToNodeResponse } = require('next/dist/server/pipe-readable') as {
  pipeNodeReadableToNodeResponse: (source: Readable, response: ServerResponse) => Promise<void>
}

describe('Next compression drain cleanup', () => {
  it.each(['gzip', 'identity'])(
    'delivers a backpressured %s stream without retaining once listeners',
    async (encoding) => {
      const body = randomBytes(2 * 1024 * 1024)
      let drainListeners = 0
      let pipe: Promise<void> | undefined
      const server = createServer((request, response) => {
        compression()(request, response, () => {})
        response.setHeader('Content-Type', 'text/plain')
        const chunks = Array.from({ length: 32 }, (_, index) =>
          body.subarray(index * 65536, (index + 1) * 65536),
        )
        pipe = pipeNodeReadableToNodeResponse(Readable.from(chunks), response).then(() => {
          const probe = () => {}
          const target = response.on('drain', probe) as unknown as EventEmitter
          response.off('drain', probe)
          drainListeners = target.listenerCount('drain')
        })
      })
      try {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Missing test server port')
        const result = await new Promise<{ bytes: Buffer; status: number | undefined }>(
          (resolve, reject) => {
            const request = get(
              { host: '127.0.0.1', port: address.port, headers: { 'Accept-Encoding': encoding } },
              (response) => {
                const chunks: Buffer[] = []
                response.on('data', (chunk: Buffer) => chunks.push(chunk))
                response.on('error', reject)
                response.on('end', () =>
                  resolve({ bytes: Buffer.concat(chunks), status: response.statusCode }),
                )
              },
            )
            request.setTimeout(5000, () => request.destroy(new Error('Test response timed out')))
            request.on('error', reject)
          },
        )
        await pipe
        expect(result.status).toBe(200)
        expect((encoding === 'gzip' ? gunzipSync(result.bytes) : result.bytes).equals(body)).toBe(
          true,
        )
        // The final write can finish without another drain; prior once-handlers must be gone.
        expect(drainListeners).toBeLessThanOrEqual(1)
      } finally {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    },
  )
})
