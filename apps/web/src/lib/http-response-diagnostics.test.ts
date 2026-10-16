import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { annotateDiagnosticContext } from './diagnostic-context'
import type { RequestContext } from '@beaconhs/tenant'
import { observeHttpResponse } from './http-response-diagnostics'

afterEach(() => vi.restoreAllMocks())

function observe(completed: boolean, status = 200, headersSent = true) {
  const request = new IncomingMessage(new Socket())
  request.url = '/journals/private-id?token=secret'
  request.method = 'GET'
  const response = new ServerResponse(request)
  response.statusCode = status
  Object.defineProperty(response, 'writableFinished', { value: completed })
  Object.defineProperty(response, 'headersSent', { value: headersSent })
  observeHttpResponse(request, response)
  response.emit('close')
  request.destroy()
}

describe('HTTP response diagnostics', () => {
  it('records unfinished responses without calling an unsent default status a success', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    observe(false, 200, false)
    const line = String(warn.mock.calls[0]?.[0])
    expect(JSON.parse(line)).toMatchObject({
      routeFamily: 'journals',
      completed: false,
      statusCode: null,
    })
    expect(line).not.toMatch(/private-id|token|secret/)
  })
  it('records server errors but does not log successful fast requests', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    observe(true)
    expect(warn).not.toHaveBeenCalled()
    observe(true, 500)
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      completed: true,
      statusCode: 500,
    })
  })
})

it('captures failed server actions with authenticated correlation without exposing action IDs', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const request = new IncomingMessage(new Socket())
  request.url = '/training/secret-id?query=secret'
  request.method = 'POST'
  request.headers = { 'next-action': 'SECRET-ACTION-ID' }
  const response = new ServerResponse(request)
  response.statusCode = 404
  Object.defineProperty(response, 'writableFinished', { value: true })
  Object.defineProperty(response, 'headersSent', { value: true })
  observeHttpResponse(request, response)
  annotateDiagnosticContext(request.headers, {
    userId: 'peter',
    tenantId: 'external-training',
  } as RequestContext)
  response.emit('close')
  const line = String(warn.mock.calls[0]?.[0])
  expect(JSON.parse(line)).toMatchObject({
    kind: 'server_action_failed',
    routeFamily: 'training',
    actorUserId: 'peter',
    tenantId: 'external-training',
    statusCode: 404,
  })
  expect(line).not.toMatch(/secret|SECRET-ACTION-ID/)
  request.destroy()
})

it('classifies an abandoned prefetch as cancellation rather than a crash', () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const request = new IncomingMessage(new Socket())
  request.headers = { 'next-router-prefetch': '1' }
  const response = new ServerResponse(request)
  observeHttpResponse(request, response)
  response.emit('close')
  expect(warn).not.toHaveBeenCalled()
  expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
    kind: 'request_cancelled',
    prefetch: true,
  })
  request.destroy()
})
