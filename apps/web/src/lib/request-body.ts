export class RequestBodyTooLargeError extends Error {
  override readonly name = 'RequestBodyTooLargeError'
}

export class RequestBodyLengthError extends Error {
  override readonly name = 'RequestBodyLengthError'
}

export class RequestBodyTimeoutError extends Error {
  override readonly name = 'RequestBodyTimeoutError'
}

export class RequestBodyParseError extends Error {
  override readonly name = 'RequestBodyParseError'
}

type BoundedBodyOptions = {
  maxBytes: number
  timeoutMs: number
}

/**
 * Read an HTTP request body with declared-length, streamed-length, and elapsed
 * time limits. The streamed count is authoritative, so a missing or dishonest
 * Content-Length cannot make a route allocate an unbounded buffer.
 */
export async function readBoundedRequestBody(
  request: Request,
  options: BoundedBodyOptions,
): Promise<Buffer> {
  const { maxBytes, timeoutMs } = options
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RequestBodyLengthError('Invalid server body limit')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RequestBodyLengthError('Invalid server body timeout')
  }

  const contentLength = request.headers.get('content-length')
  let declaredLength: number | null = null
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new RequestBodyLengthError('Invalid Content-Length')
    }
    declaredLength = Number(contentLength)
    if (!Number.isSafeInteger(declaredLength)) {
      throw new RequestBodyLengthError('Invalid Content-Length')
    }
    if (declaredLength > maxBytes) throw new RequestBodyTooLargeError('Request body too large')
  }

  if (!request.body) {
    if (declaredLength !== null && declaredLength !== 0) {
      throw new RequestBodyLengthError('Content-Length does not match the request body')
    }
    return Buffer.alloc(0)
  }

  const reader = request.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new RequestBodyTimeoutError('Request body timed out')),
      timeoutMs,
    )
  })

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      if (!value || value.byteLength === 0) continue
      total += value.byteLength
      if (total > maxBytes) throw new RequestBodyTooLargeError('Request body too large')
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    await reader.cancel('Request body rejected').catch(() => {})
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    reader.releaseLock()
  }

  if (declaredLength !== null && total !== declaredLength) {
    throw new RequestBodyLengthError('Content-Length does not match the request body')
  }
  return Buffer.concat(chunks, total)
}

export async function readBoundedJsonBody(
  request: Request,
  options: BoundedBodyOptions,
): Promise<unknown> {
  const body = await readBoundedRequestBody(request, options)
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    return JSON.parse(text) as unknown
  } catch {
    throw new RequestBodyParseError('Invalid JSON request body')
  }
}
