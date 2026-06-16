// Pure round-trip test for the expression parser/serializer (no DB).
import { parseExpression, serializeExpression } from '@beaconhs/analytics'

const cols: Record<string, string> = {
  'Occurred at': 'occurred_at',
  Age: 'age',
  Hours: 'hours',
  'Created at': 'created_at',
}
const resolveColumn = (label: string) => cols[label] ?? null
const labelForField = (key: string) => Object.entries(cols).find(([, v]) => v === key)?.[0] ?? key

const tests = [
  'datediff("day", max([Occurred at]), now())',
  'case([Age] < 7, "0-6 days", [Age] < 30, "7-29 days", "60+ days")',
  '(sum([Hours]) / count()) * 100',
  'coalesce([Hours], 0) + 1',
  'datepart("dow", [Created at])',
  'if([Age] > 90, "stale", "ok")',
  'upper(concat([Occurred at], "-x"))',
]
let failed = 0
for (const t of tests) {
  const r = parseExpression(t, { resolveColumn })
  if (!r.ok) {
    console.log(`FAIL  ${t}\n      → ${r.error} (pos ${r.pos})`)
    failed++
    continue
  }
  const back = serializeExpression(r.expr, { labelForField })
  // Re-parse the serialized form to prove it round-trips to the same shape.
  const r2 = parseExpression(back, { resolveColumn })
  const stable = r2.ok && JSON.stringify(r2.expr) === JSON.stringify(r.expr)
  console.log(`${stable ? 'OK  ' : 'DRIFT'} ${t}\n      ast=${r.expr.ex}  reserialized=${back}`)
  if (!stable) failed++
}
// One expected failure: an unknown column should be rejected.
const bad = parseExpression('sum([Nope])', { resolveColumn })
console.log(`${!bad.ok ? 'OK   (rejects unknown field)' : 'FAIL (accepted unknown field)'} `)
if (bad.ok) failed++

console.log(failed === 0 ? '\nAll expression tests passed.' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
