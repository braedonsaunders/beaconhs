// GET /api/v1/docs — interactive API reference (Scalar) rendered over the
// generated spec at /api/v1/openapi.json. Standalone HTML so it works outside
// the app shell; the admin API-keys page links here.

import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Exact package artifact, independently verified against npm's 1.62.5 tarball.
// SRI prevents the nonce-trusted CDN response from changing underneath us.
const SCALAR_SCRIPT_URL =
  'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.62.5/dist/browser/standalone.js'
const SCALAR_SCRIPT_INTEGRITY =
  'sha384-qgSpG+a6nhdzdIVlaUPfNI6jwGGnmHPTGC2JXXgWBjPMTSDI4hcdVQzagOL6ZKLm'

function html(nonce: string): string {
  const nonceAttribute = nonce ? ` nonce="${nonce}"` : ''
  return `<!doctype html>
<html>
  <head>
    <title>BeaconHS API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <script${nonceAttribute} id="api-reference" data-url="/api/v1/openapi.json"></script>
    <script${nonceAttribute}>
      var configuration = { theme: 'default', metaData: { title: 'BeaconHS API Reference' } }
      document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration)
    </script>
    <script${nonceAttribute} src="${SCALAR_SCRIPT_URL}" integrity="${SCALAR_SCRIPT_INTEGRITY}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  </body>
</html>`
}

export async function GET(): Promise<Response> {
  const nonce = (await headers()).get('x-nonce') ?? ''
  return new Response(html(nonce), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
