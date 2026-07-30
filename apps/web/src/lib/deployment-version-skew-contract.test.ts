import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const nextConfig = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8')
const dockerfile = readFileSync(new URL('../../../../Dockerfile', import.meta.url), 'utf8')
const devWorkflow = readFileSync(
  new URL('../../../../.github/workflows/deploy-dev.yml', import.meta.url),
  'utf8',
)

describe('self-hosted Next.js version-skew protection', () => {
  it('embeds the immutable deployment version into the Next.js build', () => {
    expect(nextConfig).toContain('deploymentId: process.env.DEPLOYMENT_VERSION')
    expect(dockerfile).toContain('ARG DEPLOYMENT_VERSION')
    expect(dockerfile).toContain('ENV DEPLOYMENT_VERSION=${DEPLOYMENT_VERSION}')
    expect(devWorkflow).toContain('DEPLOYMENT_VERSION=${{ github.sha }}')
  })

  it('uses one protected Server Action encryption key across dev builds', () => {
    expect(dockerfile).toContain('--mount=type=secret,id=next_server_actions_key,required=true')
    expect(dockerfile).toContain(
      'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat /run/secrets/next_server_actions_key)"',
    )
    expect(devWorkflow).toContain(
      'next_server_actions_key=${{ secrets.DEV_NEXT_SERVER_ACTIONS_ENCRYPTION_KEY }}',
    )
  })
})
