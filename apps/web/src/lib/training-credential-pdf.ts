export {
  renderSkillCredentialPdf,
  renderSkillCredentialPngs,
  renderTrainingCredentialPdf,
  renderTrainingCredentialPngs,
  renderTrainingWalletCardBatchPdf,
  type RenderedCredentialPdf,
  type RenderedCredentialPrint,
} from '@beaconhs/forms-pdf'

import type { RenderedCredentialPdf } from '@beaconhs/forms-pdf'

export function pdfResponse(rendered: RenderedCredentialPdf): Response {
  return new Response(new Uint8Array(rendered.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(rendered.bytes.length),
      'Content-Disposition': `inline; filename="${rendered.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
