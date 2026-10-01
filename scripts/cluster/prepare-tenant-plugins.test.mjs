import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareTenantPlugins, renderTenantPluginCompose } from './prepare-tenant-plugins.mjs'
const bytes = Buffer.from('exports.createPlugin = () => ({ apiVersion: 1, id: "example" });')
const plugin = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  pluginId: 'example',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  contentBase64: bytes.toString('base64'),
}
async function temporary(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'tenant-plugin-test-'))
  try {
    await fn(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
test('empty installation stays empty and prepares a mountable directory', () =>
  temporary(async (directory) => {
    assert.deepEqual(await prepareTenantPlugins('', directory), {
      installations: [],
      artifactCount: 0,
    })
    assert.equal(await readFile(join(directory, 'installations.json'), 'utf8'), '[]')
  }))
test('verified artifact gets an immutable digest path and a checksum without executing it', () =>
  temporary(async (directory) => {
    const result = await prepareTenantPlugins(
      JSON.stringify({ version: 1, plugins: [plugin] }),
      directory,
    )
    assert.equal(result.artifactCount, 1)
    assert.equal(
      result.installations[0].modulePath,
      `/opt/beaconhs-tenant-plugins/example-${plugin.sha256}.cjs`,
    )
    assert.deepEqual(
      await readFile(join(directory, 'artifacts', `example-${plugin.sha256}.cjs`)),
      bytes,
    )
    const configs = JSON.parse(await readFile(join(directory, 'configs.json'), 'utf8'))
    assert.equal(
      configs[0].name,
      `beaconhs-plugin-${createHash('sha256').update(configs[0].path).digest('hex').slice(0, 48)}`,
    )
    assert.ok(configs[0].name.length <= 64)
    const compose = renderTenantPluginCompose(
      'services:\n  web:\n    # TENANT_PLUGIN_CONFIG_MOUNTS\n    image: example\n',
      result.installations,
    )
    assert.match(compose, /external: true/)
    assert.ok(compose.includes(result.installations[0].modulePath))
    assert.ok(!compose.includes(plugin.contentBase64))
  }))
test('rejects path traversal, duplicate installs, corrupt data and unknown fields before writes', () =>
  temporary(async (directory) => {
    for (const plugins of [
      [{ ...plugin, pluginId: '../escape' }],
      [plugin, plugin],
      [{ ...plugin, sha256: '0'.repeat(64) }],
      [{ ...plugin, contentBase64: plugin.contentBase64 + '\n' }],
      [{ ...plugin, path: '/etc/escape' }],
    ]) {
      await assert.rejects(prepareTenantPlugins(JSON.stringify({ version: 1, plugins }), directory))
      await assert.rejects(access(join(directory, 'artifacts')))
    }
  }))

test('redirect stays independent of the retired app and preserves path/query capture', () => {
  const source =
    'services:\n  web:\n    # TENANT_PLUGIN_CONFIG_MOUNTS\n    deploy:\n      # LEGACY_HOST_REDIRECT_LABELS\n'
  const output = renderTenantPluginCompose(source, [], {
    legacyHost: 'old.example.com',
    appUrl: 'https://new.example.com',
  })
  assert.match(output, /noop@internal/)
  assert.ok(output.includes('https://new.example.com/$${1}'))
  assert.ok(output.includes('websecure'))
  assert.throws(() =>
    renderTenantPluginCompose(source, [], {
      legacyHost: 'old.example.com`)',
      appUrl: 'https://new.example.com',
    }),
  )
  assert.throws(() =>
    renderTenantPluginCompose(source, [], {
      legacyHost: 'old.example.com',
      appUrl: 'https://old.example.com',
    }),
  )
})

test('maximum plugin identifiers produce bounded, distinct Swarm names', () =>
  temporary(async (directory) => {
    const plugins = [
      { ...plugin, pluginId: 'a'.repeat(64) },
      { ...plugin, pluginId: 'a'.repeat(63) + 'b' },
    ]
    const { installations } = await prepareTenantPlugins(
      JSON.stringify({ version: 1, plugins }),
      directory,
    )
    const configs = JSON.parse(await readFile(join(directory, 'configs.json'), 'utf8'))
    assert.equal(new Set(configs.map((item) => item.name)).size, 2)
    for (const item of configs)
      assert.match(item.name, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}[a-zA-Z0-9]$/)
    const compose = renderTenantPluginCompose(
      'services:\n  web:\n    # TENANT_PLUGIN_CONFIG_MOUNTS\n    image: example\n',
      installations,
    )
    for (const item of configs) assert.ok(compose.includes(`source: ${item.name}`))
  }))
