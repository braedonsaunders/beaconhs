// Public REST API error type + JSON error envelope. Every /api/v1 handler
// throws ApiError and lets the withApiKey wrapper render it, so error shapes
// are consistent and documented in the OpenAPI spec (ApiError schema).

import { NextResponse } from 'next/server'

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'method_not_allowed'
  | 'rate_limited'
  | 'internal'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  static unauthorized(message = 'Missing or invalid API key') {
    return new ApiError(401, 'unauthorized', message)
  }
  static forbidden(message = 'API key lacks the required permission') {
    return new ApiError(403, 'forbidden', message)
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'not_found', message)
  }
  static invalid(message: string, details?: unknown) {
    return new ApiError(400, 'invalid_request', message, details)
  }
  static methodNotAllowed(message: string) {
    return new ApiError(405, 'method_not_allowed', message)
  }
}

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; details?: unknown }
}

/** Render any thrown value as a JSON error response. */
export function errorResponse(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof ApiError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message } }
    if (typeof err.details !== 'undefined') body.error.details = err.details
    return NextResponse.json(body, { status: err.status, headers: noStore() })
  }
  // Never leak internals; the real error is logged server-side by the caller.
  return NextResponse.json(
    { error: { code: 'internal', message: 'Internal server error' } },
    { status: 500, headers: noStore() },
  )
}

/** API responses are per-request and key-scoped — never cache them. */
export function noStore(): Record<string, string> {
  return { 'Cache-Control': 'no-store' }
}
