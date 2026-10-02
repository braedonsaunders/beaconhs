import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
