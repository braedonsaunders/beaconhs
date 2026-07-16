export type DocumentDiffKind = 'equal' | 'added' | 'removed'

export type DocumentDiffLine = {
  kind: DocumentDiffKind
  text: string
  beforeLine: number | null
  afterLine: number | null
}

export type DocumentDiffRow =
  DocumentDiffLine | { kind: 'skipped'; count: number; beforeLine: null; afterLine: null }

export type DocumentTextDiff = {
  lines: DocumentDiffLine[]
  additions: number
  removals: number
}

type Operation = { kind: DocumentDiffKind; text: string }

const MAX_MYERS_DISTANCE = 400
const MAX_MYERS_LINES = 12_000

function lines(value: string): string[] {
  if (!value) return []
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
}

function replacementDiff(before: string[], after: string[]): Operation[] {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }

  return [
    ...before.slice(0, prefix).map((text) => ({ kind: 'equal' as const, text })),
    ...before
      .slice(prefix, before.length - suffix)
      .map((text) => ({ kind: 'removed' as const, text })),
    ...after.slice(prefix, after.length - suffix).map((text) => ({ kind: 'added' as const, text })),
    ...(suffix > 0
      ? before.slice(before.length - suffix).map((text) => ({ kind: 'equal' as const, text }))
      : []),
  ]
}

function myersDiff(before: string[], after: string[]): Operation[] | null {
  const maximum = before.length + after.length
  let frontier = new Map<number, number>([[1, 0]])
  const trace: Map<number, number>[] = []

  for (let distance = 0; distance <= maximum; distance += 1) {
    if (distance > MAX_MYERS_DISTANCE) return null
    trace.push(new Map(frontier))

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? 0
      const right = (frontier.get(diagonal - 1) ?? 0) + 1
      let x = diagonal === -distance || (diagonal !== distance && right <= down) ? down : right
      let y = x - diagonal

      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1
        y += 1
      }
      frontier.set(diagonal, x)

      if (x < before.length || y < after.length) continue

      const operations: Operation[] = []
      let backX = before.length
      let backY = after.length

      for (let backDistance = distance; backDistance >= 0; backDistance -= 1) {
        const previous = trace[backDistance]!
        const backDiagonal = backX - backY
        const previousDown = previous.get(backDiagonal + 1) ?? 0
        const previousRight = (previous.get(backDiagonal - 1) ?? 0) + 1
        const previousDiagonal =
          backDiagonal === -backDistance ||
          (backDiagonal !== backDistance && previousRight <= previousDown)
            ? backDiagonal + 1
            : backDiagonal - 1
        const previousX = previous.get(previousDiagonal) ?? 0
        const previousY = previousX - previousDiagonal

        while (backX > previousX && backY > previousY) {
          operations.push({ kind: 'equal', text: before[backX - 1]! })
          backX -= 1
          backY -= 1
        }
        if (backDistance === 0) break

        if (backX === previousX) {
          operations.push({ kind: 'added', text: after[backY - 1]! })
          backY -= 1
        } else {
          operations.push({ kind: 'removed', text: before[backX - 1]! })
          backX -= 1
        }
      }

      return operations.reverse()
    }
  }
  return null
}

export function diffDocumentText(beforeText: string, afterText: string): DocumentTextDiff {
  const before = lines(beforeText)
  const after = lines(afterText)
  const operations =
    before.length + after.length <= MAX_MYERS_LINES
      ? (myersDiff(before, after) ?? replacementDiff(before, after))
      : replacementDiff(before, after)

  let beforeLine = 1
  let afterLine = 1
  let additions = 0
  let removals = 0
  const result: DocumentDiffLine[] = []

  for (const operation of operations) {
    if (operation.kind === 'equal') {
      result.push({ ...operation, beforeLine, afterLine })
      beforeLine += 1
      afterLine += 1
    } else if (operation.kind === 'removed') {
      result.push({ ...operation, beforeLine, afterLine: null })
      beforeLine += 1
      removals += 1
    } else {
      result.push({ ...operation, beforeLine: null, afterLine })
      afterLine += 1
      additions += 1
    }
  }

  return { lines: result, additions, removals }
}

export function contextualizeDocumentDiff(
  diffLines: DocumentDiffLine[],
  context = 3,
): DocumentDiffRow[] {
  if (diffLines.every((line) => line.kind === 'equal')) return []

  const visible = new Set<number>()
  for (const [index, line] of diffLines.entries()) {
    if (line.kind === 'equal') continue
    for (
      let contextIndex = Math.max(0, index - context);
      contextIndex <= Math.min(diffLines.length - 1, index + context);
      contextIndex += 1
    ) {
      visible.add(contextIndex)
    }
  }

  const rows: DocumentDiffRow[] = []
  let skipped = 0
  for (const [index, line] of diffLines.entries()) {
    if (!visible.has(index)) {
      skipped += 1
      continue
    }
    if (skipped > 0) {
      rows.push({ kind: 'skipped', count: skipped, beforeLine: null, afterLine: null })
      skipped = 0
    }
    rows.push(line)
  }
  if (skipped > 0) {
    rows.push({ kind: 'skipped', count: skipped, beforeLine: null, afterLine: null })
  }
  return rows
}
