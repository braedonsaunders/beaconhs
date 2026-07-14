const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`)
}

export function assertString(
  value: string,
  label: string,
  options: { min?: number; max: number; pattern?: RegExp },
): void {
  const min = options.min ?? 0
  if (
    typeof value !== 'string' ||
    value.length < min ||
    value.length > options.max ||
    (options.pattern && !options.pattern.test(value))
  ) {
    throw new Error(`${label} is invalid or exceeds ${options.max} characters.`)
  }
}

export function assertOptionalString(value: string | undefined, label: string, max: number): void {
  if (value !== undefined) assertString(value, label, { max })
}

export function assertRelativeAppPath(value: string | undefined, label: string): void {
  if (value === undefined) return
  assertString(value, label, { min: 1, max: 2_048 })
  if (!value.startsWith('/') || value.startsWith('//') || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be a safe app-relative path.`)
  }
}

export function assertJsonBytes(value: unknown, label: string, maxBytes: number): void {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error(`${label} must be JSON serializable.`)
  }
  if (serialized === undefined) throw new Error(`${label} must be JSON serializable.`)
  if (Buffer.byteLength(serialized) > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} serialized bytes.`)
  }
}

export function assertIdentifier(value: string, label: string, max = 200): void {
  assertString(value, label, {
    min: 1,
    max,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  })
}

export function assertQueueJobId(value: string | undefined, label = 'Queue jobId'): void {
  if (value === undefined) return
  if (!value || value.length > 512 || /[:\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid, too long, or contains BullMQ-reserved characters.`)
  }
}
