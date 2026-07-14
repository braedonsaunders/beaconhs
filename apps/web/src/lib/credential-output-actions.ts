import type { CredentialFormat, CredentialOutput } from './credential-designs'

type CredentialOutputAction = {
  output: CredentialOutput
  label: 'Open PDF'
  href: string
}

/**
 * Each distinct credential design gets one action. Printing and saving happen
 * in the browser's PDF viewer instead of multiplying controls in BeaconHS.
 */
export function credentialOutputActions(
  outputs: CredentialOutput[],
  endpoint: string,
): CredentialOutputAction[] {
  return outputs.map((output) => ({
    output,
    label: 'Open PDF',
    href: `${endpoint}?${new URLSearchParams({ output: output.id })}`,
  }))
}

export function credentialFormatLabel(format: CredentialFormat): string {
  if (format === 'wallet') return 'CR80 wallet'
  if (format === 'letter-portrait') return '8.5 x 11 portrait'
  return '11 x 8.5 landscape'
}
