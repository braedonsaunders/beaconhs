/** Tenant branding is admin-entered JSON; keep CSS colours well-formed. */
export function resolveHexColor(value: string | null | undefined, fallback: string): string {
  const color = value?.trim()
  return color && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : fallback
}
