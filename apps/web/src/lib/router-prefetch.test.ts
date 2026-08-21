import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { isRouterPrefetch, rejectRouterPrefetch } from './router-prefetch'

function request(headers: Record<string, string>) {
  return new NextRequest('https://beaconhs.test/reports/definitions/x/export', { headers })
}

describe('isRouterPrefetch', () => {
  it('treats Next.js router prefetch as prefetch', () => {
    expect(isRouterPrefetch(request({ 'next-router-prefetch': '1' }))).toBe(true)
  })

  it('treats Purpose and Sec-Purpose prefetch headers as prefetch', () => {
    expect(isRouterPrefetch(request({ purpose: 'prefetch' }))).toBe(true)
    expect(isRouterPrefetch(request({ 'sec-purpose': 'prefetch' }))).toBe(true)
  })

  it('lets a real click through', () => {
    expect(isRouterPrefetch(request({}))).toBe(false)
    expect(rejectRouterPrefetch(request({}))).toBeNull()
  })

  it('returns 204 without a body for prefetch', () => {
    const response = rejectRouterPrefetch(request({ 'next-router-prefetch': '1' }))
    expect(response?.status).toBe(204)
  })
})
