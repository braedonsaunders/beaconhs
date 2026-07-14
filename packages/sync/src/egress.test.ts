import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isPublicIpAddress,
  normalizeOutboundHostname,
  resolveOutboundRedirect,
  resolvePublicHost,
  secureFetch,
  validateOutboundRequestConfiguration,
} from './egress'
import { connectDb } from './db-drivers'
import { planSnapshotArchives } from './snapshot-policy'

test('public IP policy rejects local, private, special, mapped, and documentation ranges', () => {
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '203.0.113.9',
    '::1',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '2001:db8::1',
    'fc00::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
  ]) {
    assert.equal(isPublicIpAddress(address), false, address)
  }
  assert.equal(isPublicIpAddress('8.8.8.8'), true)
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true)
})

test('hostname normalization rejects URL-shaped and malformed database hosts', () => {
  assert.equal(normalizeOutboundHostname('Example.COM.'), 'example.com')
  assert.throws(() => normalizeOutboundHostname('https://example.com'), /not valid/)
  assert.throws(() => normalizeOutboundHostname('example.com/path'), /not valid/)
  assert.throws(() => normalizeOutboundHostname('[fe80::1%25lo0]'), /not valid/)
})

test('DNS policy rejects a hostname if any answer is non-public', async () => {
  let reservedResolverCalled = false
  await assert.rejects(
    resolvePublicHost('test', {
      resolver: async () => {
        reservedResolverCalled = true
        return [{ address: '93.184.216.34', family: 4 }]
      },
    }),
    /reserved for local or private use/,
  )
  assert.equal(reservedResolverCalled, false)

  await assert.rejects(
    resolvePublicHost('mixed.example.net', {
      resolver: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    }),
    /blocked non-public/,
  )

  const resolved = await resolvePublicHost('public.example.net', {
    resolver: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ],
  })
  assert.deepEqual(resolved, {
    hostname: 'public.example.net',
    address: '93.184.216.34',
    family: 4,
    ipLiteral: false,
  })

  await assert.rejects(
    resolvePublicHost('slow.example.net', {
      timeoutMs: 5,
      resolver: () => new Promise(() => {}),
    }),
    /DNS lookup timed out/,
  )
})

test('every DNS resolution is revalidated so a rebinding answer fails closed', async () => {
  let calls = 0
  const resolver = async () => {
    calls++
    return calls === 1
      ? [{ address: '93.184.216.34', family: 4 as const }]
      : [{ address: '127.0.0.1', family: 4 as const }]
  }

  await resolvePublicHost('hooks.example.net', { resolver })
  await assert.rejects(resolvePublicHost('hooks.example.net', { resolver }), /blocked non-public/)
  assert.equal(calls, 2)
})

test('outbound configuration and redirect policy reject unsafe request metadata', () => {
  assert.throws(
    () => validateOutboundRequestConfiguration('http://hooks.example.net'),
    /must use HTTPS/,
  )
  assert.throws(
    () =>
      validateOutboundRequestConfiguration('https://hooks.example.net', {
        Expect: '100-continue',
      }),
    /header "expect" is not allowed/,
  )
  assert.throws(
    () =>
      validateOutboundRequestConfiguration('https://hooks.example.net', {
        'X-Forwarded-Host': 'metadata.internal',
      }),
    /header "x-forwarded-host" is not allowed/,
  )
  assert.throws(
    () =>
      validateOutboundRequestConfiguration('https://hooks.example.net', {
        'Accept-Encoding': 'gzip',
      }),
    /header "accept-encoding" must be identity/,
  )
  const secretHeader = 'do-not-echo-this-secret'
  assert.throws(
    () =>
      validateOutboundRequestConfiguration('https://hooks.example.net', {
        Authorization: `Bearer ${secretHeader}\r\nX-Injected: true`,
      }),
    (error: unknown) =>
      error instanceof Error &&
      /header "authorization" contains invalid data/.test(error.message) &&
      !error.message.includes(secretHeader),
  )

  const current = new URL('https://hooks.example.net/start')
  assert.equal(resolveOutboundRedirect(current, '/next').href, 'https://hooks.example.net/next')
  assert.throws(
    () => resolveOutboundRedirect(current, 'https://internal.example.org/next'),
    /Cross-origin outbound redirects are not allowed/,
  )
  assert.throws(
    () => resolveOutboundRedirect(current, 'http://hooks.example.net/next'),
    /must use HTTPS/,
  )
})

test('secure fetch rejects unsafe schemes, credentials, normalized private literals, and hop headers', async () => {
  await assert.rejects(secureFetch('http://example.com'), /must use HTTPS/)
  await assert.rejects(secureFetch('https://user:pass@example.com'), /must not include credentials/)
  await assert.rejects(secureFetch('https://example.com:0'), /port must be between/)
  await assert.rejects(secureFetch('https://2130706433'), /blocked non-public/)
  await assert.rejects(
    secureFetch('https://8.8.8.8', { headers: { Host: 'localhost' } }),
    /header "host" is not allowed/,
  )
  await assert.rejects(
    secureFetch('https://private.example.net', {
      resolver: async () => [{ address: '10.0.0.8', family: 4 }],
    }),
    /blocked non-public/,
  )
  await assert.rejects(
    secureFetch('https://8.8.8.8', { headers: { 'x-large': 'x'.repeat(16 * 1024) } }),
    /request headers exceeded/,
  )
  await assert.rejects(
    secureFetch('https://8.8.8.8', {
      method: 'POST',
      body: 'too large',
      maxRequestBytes: 4,
    }),
    /request body exceeded 4 bytes/,
  )
  await assert.rejects(
    secureFetch('https://8.8.8.8', { maxResponseBytes: 16 * 1024 * 1024 + 1 }),
    /Maximum response size/,
  )

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    secureFetch('https://8.8.8.8', { signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  )
})

test('an abort signal interrupts an in-flight DNS resolution', async () => {
  const controller = new AbortController()
  const pending = secureFetch('https://public.example.net', {
    signal: controller.signal,
    resolver: () => new Promise(() => {}),
  })
  controller.abort()
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  )
})

test('database connections reject private hosts and unencrypted credentials before loading a driver', async () => {
  const base = {
    dbKind: 'postgres' as const,
    database: 'app',
    username: 'service',
    password: 'secret',
  }
  await assert.rejects(connectDb({ ...base, host: '127.0.0.1', ssl: true }), /blocked non-public/)
  await assert.rejects(
    connectDb({ ...base, host: 'db.example.com', ssl: false }),
    /require SSL\/TLS/,
  )
})

test('snapshot archive policy fails closed for processing failures and empty entities', () => {
  assert.deepEqual(planSnapshotArchives(['people', 'equipment'], { people: 2, equipment: 0 }, 0), {
    eligible: ['people'],
    blockedEmpty: ['equipment'],
    blockedByFailures: false,
    missingAuthority: false,
  })
  assert.deepEqual(planSnapshotArchives(['people'], { people: 5 }, 1), {
    eligible: [],
    blockedEmpty: [],
    blockedByFailures: true,
    missingAuthority: false,
  })
  assert.equal(planSnapshotArchives([], {}, 0).missingAuthority, true)
})
