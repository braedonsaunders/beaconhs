/** How a report's PDF export is rendered. Stored on `layout.exportMode`. */
export type ReportExportMode = 'document' | 'credential-fronts'

function layoutExportMode(layout: unknown): unknown {
  return layout && typeof layout === 'object' && 'exportMode' in layout
    ? (layout as { exportMode?: unknown }).exportMode
    : undefined
}

export function reportExportMode(layout: unknown): ReportExportMode {
  return layoutExportMode(layout) === 'credential-fronts' ? 'credential-fronts' : 'document'
}

export function reportExportsCredentialFronts(layout: unknown): boolean {
  return reportExportMode(layout) === 'credential-fronts'
}
