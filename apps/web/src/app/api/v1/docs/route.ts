// GET /api/v1/docs — interactive API reference (Scalar) rendered over the
// generated spec at /api/v1/openapi.json. Standalone HTML so it works outside
// the app shell; the admin API-keys page links here.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HTML = `<!doctype html>
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
    <script id="api-reference" data-url="/api/v1/openapi.json"></script>
    <script>
      var configuration = { theme: 'default', metaData: { title: 'BeaconHS API Reference' } }
      document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration)
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`

export async function GET(): Promise<Response> {
  return new Response(HTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
