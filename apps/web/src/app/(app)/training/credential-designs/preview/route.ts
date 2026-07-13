// Card studio "Preview PDF" — renders the POSTed (possibly unsaved) design
// through the same renderer the live credential routes use, with sample data
// and the tenant's real name/logo, and streams the PDF back inline.

import { eq } from 'drizzle-orm'
import QRCode from 'qrcode'
import { tenants } from '@beaconhs/db/schema'
import { renderDesignDocumentPdf } from '@beaconhs/forms-pdf'
import {
  createCertificateDesignDocument,
  createWalletDesignDocument,
  type CredentialDesignData,
} from '@beaconhs/design-studio'
import { requireRequestContext } from '@/lib/auth'
import {
  CREDENTIAL_OUTPUTS_SETTINGS_KEY,
  normalizeCredentialOutputs,
} from '@/lib/credential-designs'
import { canDesignTrainingCredentials } from '@/lib/training-credential-access'
import {
  readBoundedJsonBody,
  RequestBodyLengthError,
  RequestBodyParseError,
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
} from '@/lib/request-body'

const MAX_DESIGN_BYTES = 512_000
const MAX_DESIGN_READ_MS = 15_000

export async function POST(request: Request) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId || !canDesignTrainingCredentials(ctx)) {
    return new Response('Forbidden', { status: 403 })
  }

  let body: unknown
  try {
    body = await readBoundedJsonBody(request, {
      maxBytes: MAX_DESIGN_BYTES,
      timeoutMs: MAX_DESIGN_READ_MS,
    })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response('Design too large', { status: 413 })
    }
    if (error instanceof RequestBodyTimeoutError) {
      return new Response('Design request timed out', { status: 408 })
    }
    if (error instanceof RequestBodyLengthError || error instanceof RequestBodyParseError) {
      return new Response('Invalid request body', { status: 400 })
    }
    return new Response('Invalid request body', { status: 400 })
  }
  if (!body || typeof body !== 'object' || !('output' in body) || !body.output) {
    return new Response('Missing design', { status: 400 })
  }

  // Same normalization path as saving — clamps, colors, document shape.
  const [output] = normalizeCredentialOutputs({
    [CREDENTIAL_OUTPUTS_SETTINGS_KEY]: [body.output],
  })
  if (!output) return new Response('Invalid design', { status: 400 })
  const document =
    output.document ??
    (output.format === 'wallet'
      ? createWalletDesignDocument(output)
      : createCertificateDesignDocument(output))

  const tenant = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ name: tenants.name, branding: tenants.branding })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId!))
      .limit(1)
    return row ?? null
  })

  const verifyUrl = `${new URL(request.url).origin}/verify/sample`
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 8,
    color: { dark: '#0f172a', light: '#ffffff' },
  })

  // Sample record — ISO dates so the field Format transforms apply exactly as
  // they will on real credentials.
  const data: CredentialDesignData = {
    tenantName: tenant?.name ?? 'Your organization',
    tenantLogoUrl: tenant?.branding?.logoUrl ?? null,
    recipientFullName: 'Avery Chen',
    recipientEmployeeNo: 'BH-1048',
    recipientPhotoUrl: null,
    credentialName: 'Confined Space Entry and Monitor',
    credentialCode: 'CSE-201',
    authorityName: 'Internal Health & Safety',
    completedOn: '2026-06-11',
    expiresOn: '2027-06-11',
    instructor: 'Morgan Patel',
    grade: 96,
    verifyUrl,
    verifyToken: 'sample-token-73b08c2b',
    qrDataUrl,
    issuedAt: '2026-06-11',
  }

  try {
    const bytes = await renderDesignDocumentPdf({
      document,
      data,
      title: `${output.name} — preview`,
    })
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename="preview-${output.id}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[credential-designs] preview render failed:', err)
    return new Response('Preview render failed', { status: 500 })
  }
}
