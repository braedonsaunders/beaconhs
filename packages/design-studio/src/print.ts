import type { PrintProvider, PrintProfile } from './schema'

export const PRINT_PROVIDERS: {
  id: PrintProvider
  label: string
  requiresLocalBridge: boolean
  notes: string
}[] = [
  {
    id: 'browser-pdf',
    label: 'System print dialog',
    requiresLocalBridge: false,
    notes: 'Universal PDF/PNG output for any printer driver.',
  },
  {
    id: 'zebra-browser-print',
    label: 'Zebra Browser Print',
    requiresLocalBridge: true,
    notes: 'Uses Zebra Browser Print for USB or network card printers where installed.',
  },
  {
    id: 'evolis-sdk',
    label: 'Evolis SDK',
    requiresLocalBridge: true,
    notes: 'Uses Evolis SDK / service bridge for supported Evolis card printers.',
  },
  {
    id: 'hid-fargo-sdk',
    label: 'HID FARGO SDK',
    requiresLocalBridge: true,
    notes: 'Uses HID FARGO SDK / local bridge for Fargo card issuance setups.',
  },
]

export function defaultPrintProfile(media: PrintProfile['media']): PrintProfile {
  return {
    provider: 'browser-pdf',
    media,
    duplex: media === 'cr80',
    edgeToEdge: true,
    orientation: 'landscape',
  }
}
