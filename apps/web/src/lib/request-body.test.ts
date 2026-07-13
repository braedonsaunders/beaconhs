import { describe, expect, it } from 'vitest'
import {
  readBoundedJsonBody,
  readBoundedRequestBody,
  RequestBodyLengthError,
  RequestBodyParseError,
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
} from './request-body'

function request(body?: BodyInit, contentLength?: string): Request {
  const init: RequestInit & { duplex?: 'half' } = {
    method: 'POST',
    body,
    headers: contentLength === undefined ? undefined : { 'content-length': contentLength },
  }
  if (body instanceof ReadableStream) init.duplex = 'half'
  return new Request('https://app.example.test/upload', init)
}

const limits = { maxBytes: 4, timeoutMs: 1_000 }

describe('bounded request bodies', () => {
  it('accepts a body exactly at the byte boundary', async () => {
    await expect(readBoundedRequestBody(request('abcd', '4'), limits)).resolves.toEqual(
      Buffer.from('abcd'),
    )
  })

  it('rejects declared and streamed overflow', async () => {
    await expect(readBoundedRequestBody(request('a', '5'), limits)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    )
    await expect(readBoundedRequestBody(request('abcde'), limits)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    )
  })

  it('rejects malformed and dishonest lengths', async () => {
    await expect(readBoundedRequestBody(request('a', '-1'), limits)).rejects.toBeInstanceOf(
      RequestBodyLengthError,
    )
    await expect(readBoundedRequestBody(request('a', '2'), limits)).rejects.toBeInstanceOf(
      RequestBodyLengthError,
    )
  })

  it('times out a stalled stream', async () => {
    const stalled = new ReadableStream<Uint8Array>({ start() {} })
    await expect(
      readBoundedRequestBody(request(stalled), { maxBytes: 4, timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(RequestBodyTimeoutError)
  })

  it('parses JSON and rejects malformed or invalid UTF-8 input', async () => {
    await expect(
      readBoundedJsonBody(request('{"ok":true}'), { maxBytes: 32, timeoutMs: 1_000 }),
    ).resolves.toEqual({ ok: true })
    await expect(
      readBoundedJsonBody(request('{'), { maxBytes: 32, timeoutMs: 1_000 }),
    ).rejects.toBeInstanceOf(RequestBodyParseError)
    await expect(
      readBoundedJsonBody(request(new Uint8Array([0xff])), {
        maxBytes: 32,
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(RequestBodyParseError)
  })
})
