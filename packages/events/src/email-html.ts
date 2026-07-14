import { escapeHtml } from '@beaconhs/email-render'

type ComplianceRollupEntry = {
  label: string
  to: string
  dueOn?: string | null
}

type MaintenanceRollupEntry = {
  itemName: string
  assetTag: string
  title: string
  dueOn: string
}

/** Build the compliance digest from escaped data values and trusted markup only. */
export function complianceRollupEmailHtml(input: {
  body: string
  entries: ComplianceRollupEntry[]
  url: string
}): string {
  const list = input.entries
    .slice(0, 25)
    .map(
      (entry) =>
        `<li>${escapeHtml(entry.label)} — ${escapeHtml(entry.to)}${
          entry.dueOn ? ` (due ${escapeHtml(entry.dueOn)})` : ''
        }</li>`,
    )
    .join('')
  return `<p>${escapeHtml(input.body)}</p><ul>${list}</ul><p><a href="${escapeHtml(input.url)}">View obligation</a></p>`
}

/** Build the equipment digest from escaped data values and trusted markup only. */
export function maintenanceRollupEmailHtml(input: {
  title: string
  entries: MaintenanceRollupEntry[]
  url: string
}): string {
  const list = input.entries
    .slice(0, 25)
    .map(
      (entry) =>
        `<li>${escapeHtml(entry.itemName)} (${escapeHtml(entry.assetTag)}) — ${escapeHtml(
          entry.title,
        )}, due ${escapeHtml(entry.dueOn)}</li>`,
    )
    .join('')
  const more = input.entries.length > 25 ? `<p>…and ${input.entries.length - 25} more.</p>` : ''
  return `<p>${escapeHtml(input.title)}.</p><ul>${list}</ul>${more}<p><a href="${escapeHtml(input.url)}">Open the maintenance cockpit</a></p>`
}
