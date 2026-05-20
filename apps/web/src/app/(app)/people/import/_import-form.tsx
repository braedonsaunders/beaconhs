'use client'

// Bulk people import — the user pastes (or drops) a CSV; we parse it
// client-side so we can show a preview + per-row validation BEFORE the
// network round-trip. On confirm we send the parsed rows to the server
// action which performs the inserts.
//
// CSV parsing is hand-rolled (no papaparse dependency) — the format is
// simple comma-separated with optional quoted fields. Header row is required
// and must include `first_name` and `last_name` at minimum; other columns
// are optional.

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { importPeopleCsv, type ImportResult } from '../_actions/import'

const REQUIRED_HEADERS = ['first_name', 'last_name']
const OPTIONAL_HEADERS = [
  'email',
  'employee_no',
  'hire_date',
  'department',
  'trade',
]

type ParsedRow = {
  lineNo: number
  firstName: string
  lastName: string
  email: string | null
  employeeNo: string | null
  hireDate: string | null
  department: string | null
  trade: string | null
  errors: string[]
}

export function ImportPeopleForm({
  knownDepartments,
  knownTrades,
}: {
  knownDepartments: string[]
  knownTrades: string[]
}) {
  const router = useRouter()
  const [csvText, setCsvText] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const knownDeptSet = useMemo(
    () => new Set(knownDepartments.map((d) => d.toLowerCase())),
    [knownDepartments],
  )
  const knownTradeSet = useMemo(
    () => new Set(knownTrades.map((t) => t.toLowerCase())),
    [knownTrades],
  )

  const { rows, headerError } = useMemo(
    () => parseCsv(csvText, knownDeptSet, knownTradeSet),
    [csvText, knownDeptSet, knownTradeSet],
  )
  const validRows = rows.filter((r) => r.errors.length === 0)
  const invalidRows = rows.filter((r) => r.errors.length > 0)

  function onFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      setCsvText(String(reader.result ?? ''))
      setResult(null)
    }
    reader.readAsText(file)
  }

  function submit() {
    if (validRows.length === 0) {
      toast.error('No valid rows to import')
      return
    }
    startTransition(async () => {
      const res = await importPeopleCsv({
        rows: validRows.map((r) => ({
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email,
          employeeNo: r.employeeNo,
          hireDate: r.hireDate,
          department: r.department,
          trade: r.trade,
        })),
      })
      setResult(res)
      if (res.ok) {
        if (res.created > 0) {
          toast.success(`Imported ${res.created} ${res.created === 1 ? 'person' : 'people'}`)
        }
        if (res.skipped > 0) {
          toast.error(`Skipped ${res.skipped} row${res.skipped === 1 ? '' : 's'}`)
        }
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload size={16} />
            Paste or upload CSV
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <div className="mb-1 font-medium text-slate-700">Expected columns (header row required)</div>
            <div className="flex flex-wrap gap-1">
              {REQUIRED_HEADERS.map((h) => (
                <Badge key={h} variant="destructive">
                  {h}
                </Badge>
              ))}
              {OPTIONAL_HEADERS.map((h) => (
                <Badge key={h} variant="secondary">
                  {h}
                </Badge>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Badge variant="destructive" className="px-1.5 py-0">required</Badge> first_name, last_name
              </span>
              <span className="ml-3 inline-flex items-center gap-1">
                <Badge variant="secondary" className="px-1.5 py-0">optional</Badge> everything else
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              hire_date must be in YYYY-MM-DD format. department / trade are matched by name to existing records (case-insensitive).
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
            <Textarea
              rows={6}
              placeholder="first_name,last_name,email,employee_no,hire_date,department,trade&#10;Jane,Doe,jane@acme.com,EMP-001,2024-01-15,Operations,Electrician"
              value={csvText}
              onChange={(e) => {
                setCsvText(e.currentTarget.value)
                setResult(null)
              }}
              className="font-mono text-xs"
            />
            <div className="flex flex-col gap-2">
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0]
                  if (f) onFile(f)
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => inputRef.current?.click()}
              >
                <FileText size={14} className="mr-1" />
                Upload CSV file
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCsvText('')
                  setResult(null)
                }}
                disabled={!csvText}
              >
                Clear
              </Button>
            </div>
          </div>
          {headerError ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>{headerError}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {rows.length > 0 && !headerError ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Preview
              <Badge variant="success">{validRows.length} valid</Badge>
              {invalidRows.length > 0 ? (
                <Badge variant="destructive">{invalidRows.length} invalid</Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Employee #</TableHead>
                    <TableHead>Hire date</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Trade</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.lineNo}
                      className={r.errors.length > 0 ? 'bg-rose-50/50' : undefined}
                    >
                      <TableCell className="font-mono text-xs text-slate-500">{r.lineNo}</TableCell>
                      <TableCell className="font-medium">
                        {r.firstName} {r.lastName}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">{r.email ?? '—'}</TableCell>
                      <TableCell className="text-xs text-slate-600">{r.employeeNo ?? '—'}</TableCell>
                      <TableCell className="text-xs text-slate-600">{r.hireDate ?? '—'}</TableCell>
                      <TableCell className="text-xs text-slate-600">{r.department ?? '—'}</TableCell>
                      <TableCell className="text-xs text-slate-600">{r.trade ?? '—'}</TableCell>
                      <TableCell>
                        {r.errors.length === 0 ? (
                          <Badge variant="success">OK</Badge>
                        ) : (
                          <div className="space-y-0.5">
                            {r.errors.map((e, i) => (
                              <div key={i} className="text-[11px] text-rose-700">
                                {e}
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <Button
                type="button"
                onClick={submit}
                disabled={pending || validRows.length === 0}
              >
                {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                Import {validRows.length} {validRows.length === 1 ? 'person' : 'people'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result?.ok ? (
        <Card className="border-emerald-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-emerald-800">
              <CheckCircle2 size={16} />
              Import complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              Created <span className="font-semibold">{result.created}</span> · skipped{' '}
              <span className="font-semibold">{result.skipped}</span>
            </div>
            {result.errors.length > 0 ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs">
                <div className="mb-1 font-medium text-rose-800">Errors</div>
                <ul className="space-y-0.5 text-rose-700">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      Line {e.line}: {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

// ---- CSV parser ------------------------------------------------------------

function parseCsv(
  text: string,
  knownDepartments: Set<string>,
  knownTrades: Set<string>,
): { rows: ParsedRow[]; headerError: string | null } {
  const trimmed = text.trim()
  if (!trimmed) return { rows: [], headerError: null }
  const lines = splitCsvLines(trimmed)
  if (lines.length === 0) return { rows: [], headerError: null }
  const header = parseCsvRow(lines[0]!).map((h) => h.trim().toLowerCase())

  for (const req of REQUIRED_HEADERS) {
    if (!header.includes(req)) {
      return {
        rows: [],
        headerError: `Missing required column: ${req}. Header was: ${header.join(', ')}`,
      }
    }
  }

  const idx = (name: string) => header.indexOf(name)
  const iFirst = idx('first_name')
  const iLast = idx('last_name')
  const iEmail = idx('email')
  const iEmpNo = idx('employee_no')
  const iHire = idx('hire_date')
  const iDept = idx('department')
  const iTrade = idx('trade')

  const out: ParsedRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const lineText = lines[i]!.trim()
    if (!lineText) continue
    const fields = parseCsvRow(lines[i]!)
    const get = (col: number): string | null => {
      if (col < 0 || col >= fields.length) return null
      const v = fields[col]!.trim()
      return v.length === 0 ? null : v
    }
    const firstName = get(iFirst) ?? ''
    const lastName = get(iLast) ?? ''
    const email = get(iEmail)
    const employeeNo = get(iEmpNo)
    const hireDate = get(iHire)
    const department = get(iDept)
    const trade = get(iTrade)

    // Only blocking errors land in `errors[]`. Unknown department/trade are
    // tolerated (we just save the row with that column blank) — they're not
    // surfaced because the row is still valid.
    const errors: string[] = []
    if (!firstName) errors.push('first_name is required')
    if (!lastName) errors.push('last_name is required')
    if (hireDate && !/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) {
      errors.push(`bad hire_date format (need YYYY-MM-DD)`)
    }

    out.push({
      lineNo: i + 1,
      firstName,
      lastName,
      email,
      employeeNo,
      hireDate,
      department,
      trade,
      errors,
    })
  }

  return { rows: out, headerError: null }
}

function splitCsvLines(text: string): string[] {
  // Split on newlines but respect quoted fields containing \n.
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      cur += ch
      continue
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // Handle CRLF as one line break.
      if (ch === '\r' && text[i + 1] === '\n') i++
      if (cur.length > 0) out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.length > 0) out.push(cur)
  return out
}

function parseCsvRow(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else {
      if (ch === ',') {
        out.push(cur)
        cur = ''
      } else if (ch === '"') {
        inQuotes = true
      } else {
        cur += ch
      }
    }
  }
  out.push(cur)
  return out
}
