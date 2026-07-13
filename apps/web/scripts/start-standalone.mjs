import { access, cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const standaloneRoot = resolve(webRoot, '.next/standalone/apps/web')
const server = resolve(standaloneRoot, 'server.js')

async function requireArtifact(path, label) {
  try {
    await access(path)
  } catch {
    throw new Error(`${label} is missing. Run pnpm --filter @beaconhs/web build first.`)
  }
}

async function replaceDirectory(source, target, label) {
  await requireArtifact(source, label)
  await rm(target, { recursive: true, force: true })
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true })
}

await requireArtifact(server, 'The standalone web server')
await Promise.all([
  replaceDirectory(resolve(webRoot, 'public'), resolve(standaloneRoot, 'public'), 'Public assets'),
  replaceDirectory(
    resolve(webRoot, '.next/static'),
    resolve(standaloneRoot, '.next/static'),
    'Compiled static assets',
  ),
])

await import(pathToFileURL(server).href)
