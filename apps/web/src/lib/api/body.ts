import {
  readBoundedJsonBody,
  RequestBodyLengthError,
  RequestBodyParseError,
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
} from '@/lib/request-body'
import { ApiError } from './errors'

const API_JSON_MAX_BYTES = 2 * 1024 * 1024
const API_JSON_TIMEOUT_MS = 10_000

export async function readApiJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw ApiError.invalid('Content-Type must be application/json')
  }
  try {
    return await readBoundedJsonBody(request, {
      maxBytes: API_JSON_MAX_BYTES,
      timeoutMs: API_JSON_TIMEOUT_MS,
    })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw ApiError.tooLarge()
    if (error instanceof RequestBodyTimeoutError) {
      throw new ApiError(408, 'invalid_request', 'Request body timed out')
    }
    if (error instanceof RequestBodyLengthError || error instanceof RequestBodyParseError) {
      throw ApiError.invalid(error.message)
    }
    throw error
  }
}
