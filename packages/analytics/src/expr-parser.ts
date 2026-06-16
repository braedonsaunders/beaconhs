// Clean-room expression parser + serializer: a human-typed formula string
// (e.g. `datediff("day", max([Occurred at]), now())` or
// `case([Age] < 7, "0-6 days", "older")`) ⇄ the BhqlExpr AST the engine
// compiles. Pure + runtime-free (types only), so the builder can import it.
//
// This is an original implementation — a standard tokenizer + precedence-climbing
// (Pratt) parser. It is NOT derived from any other project's source.

import type { BhqlAggFn, BhqlExpr } from '@beaconhs/db/schema'

const AGG_FNS = new Set<BhqlAggFn>(['count', 'count_distinct', 'sum', 'avg', 'min', 'max'])
/** Scalar functions the engine whitelists (mirrors compile.ts EXPR_FUNCTIONS). */
export const EXPR_SCALAR_FNS = [
  'now',
  'coalesce',
  'nullif',
  'abs',
  'round',
  'ceil',
  'floor',
  'power',
  'sqrt',
  'lower',
  'upper',
  'length',
  'trim',
  'concat',
  'datediff',
  'datetrunc',
  'datepart',
] as const
const SCALAR_FN_SET = new Set<string>(EXPR_SCALAR_FNS)

/** Display metadata for editor help / autocomplete. */
export const EXPR_FN_HELP: Record<string, { sig: string; doc: string }> = {
  now: { sig: 'now()', doc: 'The current date/time.' },
  datediff: {
    sig: 'datediff("unit", start, end)',
    doc: 'Whole units (day, week, month, quarter, year, hour, minute) between two dates.',
  },
  datetrunc: { sig: 'datetrunc("unit", date)', doc: 'Truncate a date to the start of a unit.' },
  datepart: {
    sig: 'datepart("part", date)',
    doc: 'Extract a part (dow, month, year, …) as a number.',
  },
  coalesce: { sig: 'coalesce(a, b, …)', doc: 'First non-null argument.' },
  nullif: { sig: 'nullif(a, b)', doc: 'NULL when a = b, else a.' },
  round: { sig: 'round(x, places?)', doc: 'Round a number.' },
  abs: { sig: 'abs(x)', doc: 'Absolute value.' },
  ceil: { sig: 'ceil(x)', doc: 'Round up.' },
  floor: { sig: 'floor(x)', doc: 'Round down.' },
  power: { sig: 'power(x, n)', doc: 'x to the n-th power.' },
  sqrt: { sig: 'sqrt(x)', doc: 'Square root.' },
  lower: { sig: 'lower(text)', doc: 'Lower-case.' },
  upper: { sig: 'upper(text)', doc: 'Upper-case.' },
  length: { sig: 'length(text)', doc: 'Character count.' },
  trim: { sig: 'trim(text)', doc: 'Trim surrounding whitespace.' },
  concat: { sig: 'concat(a, b, …)', doc: 'Join values into text.' },
  count: { sig: 'count()', doc: 'Row count (aggregate).' },
  count_distinct: { sig: 'count_distinct([Field])', doc: 'Distinct values (aggregate).' },
  sum: { sig: 'sum([Field])', doc: 'Sum (aggregate).' },
  avg: { sig: 'avg([Field])', doc: 'Average (aggregate).' },
  min: { sig: 'min([Field])', doc: 'Minimum (aggregate).' },
  max: { sig: 'max([Field])', doc: 'Maximum (aggregate).' },
  case: { sig: 'case(cond, value, …, else?)', doc: 'Conditional: first matching cond → value.' },
  if: { sig: 'if(cond, then, else)', doc: 'Two-way conditional.' },
}

// ---- tokenizer -------------------------------------------------------------

type Tok =
  | { t: 'num'; v: number; i: number }
  | { t: 'str'; v: string; i: number }
  | { t: 'col'; v: string; i: number } // [Bracketed name]
  | { t: 'ident'; v: string; i: number } // bare word / function name
  | { t: 'op'; v: string; i: number }
  | { t: 'kw'; v: 'and' | 'or' | 'not'; i: number }
  | { t: 'lp'; i: number }
  | { t: 'rp'; i: number }
  | { t: 'comma'; i: number }
  | { t: 'eof'; i: number }

class ParseError extends Error {
  constructor(
    message: string,
    public pos: number,
  ) {
    super(message)
  }
}

function tokenize(input: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const n = input.length
  while (i < n) {
    const c = input[i]!
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    const start = i
    if (c >= '0' && c <= '9') {
      let j = i + 1
      while (j < n && ((input[j]! >= '0' && input[j]! <= '9') || input[j] === '.')) j++
      toks.push({ t: 'num', v: Number(input.slice(i, j)), i: start })
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let out = ''
      while (j < n && input[j] !== c) {
        if (input[j] === '\\' && j + 1 < n) {
          out += input[j + 1]
          j += 2
        } else {
          out += input[j]
          j++
        }
      }
      if (j >= n) throw new ParseError('Unterminated string', start)
      toks.push({ t: 'str', v: out, i: start })
      i = j + 1
      continue
    }
    if (c === '[') {
      const close = input.indexOf(']', i + 1)
      if (close === -1) throw new ParseError('Unclosed [column] reference', start)
      toks.push({ t: 'col', v: input.slice(i + 1, close).trim(), i: start })
      i = close + 1
      continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1
      while (j < n && /[a-zA-Z0-9_]/.test(input[j]!)) j++
      const word = input.slice(i, j)
      const lw = word.toLowerCase()
      if (lw === 'and' || lw === 'or' || lw === 'not') toks.push({ t: 'kw', v: lw, i: start })
      else if (lw === 'true' || lw === 'false')
        toks.push({ t: 'num', v: lw === 'true' ? 1 : 0, i: start }) // booleans via lit below
      else toks.push({ t: 'ident', v: word, i: start })
      i = j
      continue
    }
    // multi-char operators first
    const two = input.slice(i, i + 2)
    if (two === '!=' || two === '<=' || two === '>=' || two === '<>') {
      toks.push({ t: 'op', v: two === '<>' ? '!=' : two, i: start })
      i += 2
      continue
    }
    if ('+-*/=<>'.includes(c)) {
      toks.push({ t: 'op', v: c, i: start })
      i++
      continue
    }
    if (c === '(') {
      toks.push({ t: 'lp', i: start })
      i++
      continue
    }
    if (c === ')') {
      toks.push({ t: 'rp', i: start })
      i++
      continue
    }
    if (c === ',') {
      toks.push({ t: 'comma', i: start })
      i++
      continue
    }
    throw new ParseError(`Unexpected character "${c}"`, start)
  }
  toks.push({ t: 'eof', i: n })
  return toks
}

// ---- parser (precedence climbing) ------------------------------------------

export type ExprParseOpts = {
  /** Resolve a [Column Label] (or a related "Rel → Field" label) to a field key,
   *  or null if unknown. */
  resolveColumn: (label: string) => string | null
}

const BIN_PREC: Record<string, number> = {
  '=': 3,
  '!=': 3,
  '<': 3,
  '<=': 3,
  '>': 3,
  '>=': 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
}

class Parser {
  private p = 0
  constructor(
    private toks: Tok[],
    private opts: ExprParseOpts,
  ) {}

  private peek(): Tok {
    return this.toks[this.p]!
  }
  private next(): Tok {
    return this.toks[this.p++]!
  }
  private expect(t: Tok['t']): Tok {
    const tok = this.peek()
    if (tok.t !== t) throw new ParseError(`Expected ${t}`, tok.i)
    return this.next()
  }

  parse(): BhqlExpr {
    const e = this.parseOr()
    if (this.peek().t !== 'eof') throw new ParseError('Unexpected trailing input', this.peek().i)
    return e
  }

  private parseOr(): BhqlExpr {
    let left = this.parseAnd()
    while (this.peek().t === 'kw' && (this.peek() as { v: string }).v === 'or') {
      this.next()
      left = { ex: 'logic', op: 'or', args: [left, this.parseAnd()] }
    }
    return left
  }
  private parseAnd(): BhqlExpr {
    let left = this.parseNot()
    while (this.peek().t === 'kw' && (this.peek() as { v: string }).v === 'and') {
      this.next()
      left = { ex: 'logic', op: 'and', args: [left, this.parseNot()] }
    }
    return left
  }
  private parseNot(): BhqlExpr {
    if (this.peek().t === 'kw' && (this.peek() as { v: string }).v === 'not') {
      this.next()
      return { ex: 'logic', op: 'not', args: [this.parseNot()] }
    }
    return this.parseBinary(3)
  }
  /** Comparison + arithmetic via precedence climbing. */
  private parseBinary(minPrec: number): BhqlExpr {
    let left = this.parseUnary()
    for (;;) {
      const tok = this.peek()
      if (tok.t !== 'op' || !(tok.v in BIN_PREC)) break
      const prec = BIN_PREC[tok.v]!
      if (prec < minPrec) break
      this.next()
      const right = this.parseBinary(prec + 1)
      const op = tok.v
      if (op === '+' || op === '-' || op === '*' || op === '/')
        left = { ex: 'arith', op, left, right }
      else left = { ex: 'compare', op: op as '=' | '!=' | '<' | '<=' | '>' | '>=', left, right }
    }
    return left
  }
  private parseUnary(): BhqlExpr {
    const tok = this.peek()
    if (tok.t === 'op' && tok.v === '-') {
      this.next()
      return { ex: 'arith', op: '-', left: { ex: 'lit', value: 0 }, right: this.parseUnary() }
    }
    return this.parsePrimary()
  }
  private parsePrimary(): BhqlExpr {
    const tok = this.next()
    switch (tok.t) {
      case 'num':
        return { ex: 'lit', value: tok.v }
      case 'str':
        return { ex: 'lit', value: tok.v }
      case 'col': {
        const key = this.opts.resolveColumn(tok.v)
        if (!key) throw new ParseError(`Unknown field "${tok.v}"`, tok.i)
        return { ex: 'field', field: key }
      }
      case 'lp': {
        const e = this.parseOr()
        this.expect('rp')
        return e
      }
      case 'ident':
        return this.parseCall(tok)
      default:
        throw new ParseError('Expected a value', tok.i)
    }
  }
  private parseArgs(): BhqlExpr[] {
    this.expect('lp')
    const args: BhqlExpr[] = []
    if (this.peek().t !== 'rp') {
      args.push(this.parseOr())
      while (this.peek().t === 'comma') {
        this.next()
        args.push(this.parseOr())
      }
    }
    this.expect('rp')
    return args
  }
  private parseCall(name: Tok & { t: 'ident' }): BhqlExpr {
    const fn = name.v.toLowerCase()
    const args = this.parseArgs()
    if (fn === 'case' || fn === 'if') {
      if (fn === 'if') {
        if (args.length !== 3)
          throw new ParseError('if(cond, then, else) needs 3 arguments', name.i)
        return { ex: 'case', branches: [{ when: args[0]!, then: args[1]! }], else: args[2] }
      }
      const branches: { when: BhqlExpr; then: BhqlExpr }[] = []
      let els: BhqlExpr | undefined
      let k = 0
      while (k + 1 < args.length) {
        branches.push({ when: args[k]!, then: args[k + 1]! })
        k += 2
      }
      if (k < args.length) els = args[k]
      if (!branches.length)
        throw new ParseError('case() needs at least one cond, value pair', name.i)
      return { ex: 'case', branches, else: els }
    }
    if (AGG_FNS.has(fn as BhqlAggFn)) {
      if (fn === 'count') return { ex: 'agg', fn: 'count' }
      if (!args[0]) throw new ParseError(`${fn}() needs a field argument`, name.i)
      return { ex: 'agg', fn: fn as BhqlAggFn, arg: args[0] }
    }
    if (SCALAR_FN_SET.has(fn)) return { ex: 'call', fn, args }
    throw new ParseError(`Unknown function "${name.v}"`, name.i)
  }
}

export type ExprParseResult =
  | { ok: true; expr: BhqlExpr }
  | { ok: false; error: string; pos: number }

/** Parse a formula string into a BhqlExpr. Never throws. */
export function parseExpression(input: string, opts: ExprParseOpts): ExprParseResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Empty expression', pos: 0 }
  try {
    const expr = new Parser(tokenize(trimmed), opts).parse()
    return { ok: true, expr }
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message, pos: e.pos }
    return { ok: false, error: e instanceof Error ? e.message : 'Could not parse', pos: 0 }
  }
}

// ---- serializer (AST → editable string) ------------------------------------

export type ExprSerializeOpts = {
  /** Render a field key back to its display label (without the brackets). */
  labelForField: (key: string) => string
}

function quoteStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function serializeExpression(expr: BhqlExpr, opts: ExprSerializeOpts): string {
  const s = (e: BhqlExpr): string => {
    switch (e.ex) {
      case 'field':
        return `[${opts.labelForField(e.field)}]`
      case 'lit':
        if (e.value === null) return 'null'
        if (typeof e.value === 'boolean') return String(e.value)
        if (typeof e.value === 'number') return String(e.value)
        return quoteStr(e.value)
      case 'arith':
        return `(${s(e.left)} ${e.op} ${s(e.right)})`
      case 'compare':
        return `(${s(e.left)} ${e.op} ${s(e.right)})`
      case 'logic':
        if (e.op === 'not') return `not ${s(e.args[0]!)}`
        return `(${e.args.map(s).join(e.op === 'and' ? ' and ' : ' or ')})`
      case 'case': {
        const parts = e.branches.flatMap((b) => [s(b.when), s(b.then)])
        if (e.else !== undefined) parts.push(s(e.else))
        return `case(${parts.join(', ')})`
      }
      case 'call':
        return `${e.fn}(${e.args.map(s).join(', ')})`
      case 'agg':
        return e.fn === 'count' ? 'count()' : `${e.fn}(${e.arg ? s(e.arg) : ''})`
    }
  }
  return s(expr)
}
