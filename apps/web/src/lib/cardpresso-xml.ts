export type CardPressoRequestConfig = {
  loginName: string
  loginPassword: string
  cardDocument: string
  printer: string
  frontItemId: string
  backItemId: string
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function buildCardPressoPrintXml(
  config: CardPressoRequestConfig,
  images: { front: Buffer; back?: Buffer | null },
): string {
  const items = [
    `<item id="${xml(config.frontItemId)}" type="image">${images.front.toString('base64')}</item>`,
    ...(images.back
      ? [
          `<item id="${xml(config.backItemId)}" type="image">${images.back.toString('base64')}</item>`,
        ]
      : []),
  ].join('')
  return `<?xml version="1.0" encoding="utf-8"?><cardPresso xmlns="http://tempuri.org/wpsRequest.xsd"><login><name>${xml(config.loginName)}</name><password>${xml(config.loginPassword)}</password></login><cardDocument filename="${xml(config.cardDocument)}" printer="${xml(config.printer)}">${items}</cardDocument></cardPresso>`
}
