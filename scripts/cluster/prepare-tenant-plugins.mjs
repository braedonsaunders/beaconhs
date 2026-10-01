import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const slug = /^[a-z][a-z0-9-]{0,63}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function exactKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}
// Swarm names allow at most 64 characters. Hash the full artifact identity so
// long plugin IDs stay distinct while existing-content checks remain fail-closed.
function configName(path) {
  return `beaconhs-plugin-${createHash('sha256').update(path).digest('hex').slice(0, 48)}`
}
/** Prepare only operator-provided, digest-verified artifacts; never execute them here. */
export async function prepareTenantPlugins(raw, directory) {
  const bundle = raw ? JSON.parse(raw) : { version: 1, plugins: [] }
  if (
    !exactKeys(bundle, ['version', 'plugins']) ||
    bundle.version !== 1 ||
    !Array.isArray(bundle.plugins) ||
    bundle.plugins.length > 20
  )
    throw new Error('Invalid tenant plugin bundle manifest.')
  const installations = []
  const artifacts = new Map()
  const ids = new Set()
  let totalBytes = 0
  // Validate everything before creating or writing any files.
  for (const plugin of bundle.plugins) {
    if (
      !exactKeys(plugin, ['tenantId', 'pluginId', 'sha256', 'contentBase64']) ||
      typeof plugin.tenantId !== 'string' ||
      !uuid.test(plugin.tenantId) ||
      typeof plugin.pluginId !== 'string' ||
      !slug.test(plugin.pluginId) ||
      typeof plugin.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(plugin.sha256) ||
      typeof plugin.contentBase64 !== 'string' ||
      plugin.contentBase64.length > 1400000
    )
      throw new Error('Invalid tenant plugin artifact.')
    const content = Buffer.from(plugin.contentBase64, 'base64')
    if (
      !content.length ||
      content.length > 500 * 1024 ||
      content.toString('base64') !== plugin.contentBase64 ||
      createHash('sha256').update(content).digest('hex') !== plugin.sha256
    )
      throw new Error('Tenant plugin artifact digest or encoding is invalid.')
    totalBytes += content.length
    if (totalBytes > 10 * 1024 * 1024) throw new Error('Tenant plugin bundle is too large.')
    const tenantId = plugin.tenantId.toLowerCase()
    const key = `${tenantId}:${plugin.pluginId}`
    if (ids.has(key)) throw new Error('Duplicate tenant plugin installation.')
    ids.add(key)
    const path = `${plugin.pluginId}-${plugin.sha256}.cjs`
    artifacts.set(path, content)
    installations.push({
      tenantId,
      pluginId: plugin.pluginId,
      modulePath: `/opt/beaconhs-tenant-plugins/${path}`,
    })
  }
  const artifactDirectory = resolve(directory, 'artifacts')
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 })
  for (const [path, content] of artifacts) {
    await mkdir(resolve(artifactDirectory, path, '..'), { recursive: true, mode: 0o755 })
    await writeFile(resolve(artifactDirectory, path), content, { mode: 0o644, flag: 'wx' })
  }
  await writeFile(resolve(directory, 'installations.json'), JSON.stringify(installations), {
    mode: 0o600,
  })
  const configs = [...artifacts.keys()].map((path) => ({
    name: configName(path),
    path,
    target: `/opt/beaconhs-tenant-plugins/${path}`,
  }))
  await writeFile(resolve(directory, 'configs.json'), JSON.stringify(configs), { mode: 0o600 })

  return { installations, artifactCount: artifacts.size }
}
export function renderTenantPluginCompose(
  source,
  installations,
  { legacyHost = '', appUrl = '' } = {},
) {
  const marker = '    # TENANT_PLUGIN_CONFIG_MOUNTS'
  if (source.split(marker).length !== 2)
    throw new Error('Tenant plugin compose slot is missing or duplicated.')
  const unique = new Map(
    installations.map((item) => [item.modulePath.split('/').at(-1), item.modulePath]),
  )
  const mounts = unique.size
    ? '    configs:\n' +
      [...unique]
        .map(
          ([path, target]) =>
            `      - source: ${configName(path)}\n        target: ${target}\n        mode: 0444`,
        )
        .join('\n')
    : marker
  const declarations = unique.size
    ? '\nconfigs:\n' +
      [...unique.keys()].map((path) => `  ${configName(path)}:\n    external: true`).join('\n') +
      '\n'
    : ''
  const redirectMarker = '      # LEGACY_HOST_REDIRECT_LABELS'
  if (source.split(redirectMarker).length > 2)
    throw new Error('Duplicate redirect configuration slot.')
  let redirect = redirectMarker
  if (legacyHost) {
    const url = new URL(appUrl)
    if (
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        legacyHost,
      ) ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      url.hostname === legacyHost ||
      !source.includes(redirectMarker)
    )
      throw new Error('Invalid legacy redirect configuration.')
    const labels = {
      'traefik.enable': 'true',
      'traefik.http.routers.beaconhs-legacy-redirect.rule': `Host(\`${legacyHost}\`)`,
      'traefik.http.routers.beaconhs-legacy-redirect.priority': '1000',
      'traefik.http.routers.beaconhs-legacy-redirect.entrypoints': 'websecure',
      'traefik.http.routers.beaconhs-legacy-redirect.tls': 'true',
      'traefik.http.routers.beaconhs-legacy-redirect-http.rule': `Host(\`${legacyHost}\`)`,
      'traefik.http.routers.beaconhs-legacy-redirect-http.priority': '1000',
      'traefik.http.routers.beaconhs-legacy-redirect-http.entrypoints': 'web',
      'traefik.http.routers.beaconhs-legacy-redirect-http.service': 'noop@internal',
      'traefik.http.routers.beaconhs-legacy-redirect-http.middlewares': 'beaconhs-legacy-redirect',
      'traefik.http.routers.beaconhs-legacy-redirect.service': 'noop@internal',
      'traefik.http.routers.beaconhs-legacy-redirect.middlewares': 'beaconhs-legacy-redirect',
      'traefik.http.middlewares.beaconhs-legacy-redirect.redirectregex.regex':
        '^https?://[^/]+/?(.*)',
      'traefik.http.middlewares.beaconhs-legacy-redirect.redirectregex.replacement':
        url.origin + '/$${1}',
      'traefik.http.middlewares.beaconhs-legacy-redirect.redirectregex.permanent': 'true',
    }
    redirect =
      '      labels:\n' +
      Object.entries(labels)
        .map(([key, value]) => `        ${key}: ${JSON.stringify(value)}`)
        .join('\n')
  }
  return source.replace(marker, () => mounts).replace(redirectMarker, () => redirect) + declarations
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('Output directory is required.')
    const result = await prepareTenantPlugins(
      process.env.TENANT_PLUGIN_BUNDLE ?? '',
      process.argv[2],
    )
    if (process.argv[3]) {
      const source = await readFile(process.argv[3], 'utf8')
      await writeFile(
        resolve(process.argv[2], 'compose.yaml'),
        renderTenantPluginCompose(source, result.installations, {
          legacyHost: process.env.LEGACY_APP_HOST ?? '',
          appUrl: process.env.APP_URL ?? '',
        }),
        { mode: 0o600 },
      )
    }
    console.log(`Prepared ${result.artifactCount} trusted tenant plugin artifact(s).`)
  } catch {
    // The manifest contains executable private code; never print it or parse-error excerpts.
    console.error(
      'Tenant plugin preparation failed. Check the private bundle manifest, digests, and limits.',
    )
    process.exitCode = 1
  }
}
