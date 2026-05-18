// Tiny formula evaluator for `formula` field type.
// Supports: + - * / parentheses, field refs by id, numeric literals,
// and the functions min / max / sum / avg / if(cond, then, else).
// Comparisons inside if: ==, !=, <, <=, >, >=, &&, ||
//
// Intentionally limited and self-contained — no eval(), no Function().

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const c = input[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < input.length && /[0-9.]/.test(input[j]!)) j++
      tokens.push({ kind: 'num', value: Number(input.slice(i, j)) })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j]!)) j++
      tokens.push({ kind: 'ident', value: input.slice(i, j) })
      i = j
      continue
    }
    if (c === '(') {
      tokens.push({ kind: 'lparen' })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen' })
      i++
      continue
    }
    if (c === ',') {
      tokens.push({ kind: 'comma' })
      i++
      continue
    }
    // Multi-char operators
    if ('=!<>&|'.includes(c) && '=&|'.includes(input[i + 1] ?? '')) {
      tokens.push({ kind: 'op', value: input.slice(i, i + 2) })
      i += 2
      continue
    }
    if ('+-*/<>'.includes(c)) {
      tokens.push({ kind: 'op', value: c })
      i++
      continue
    }
    throw new Error(`Unexpected char "${c}" at position ${i}`)
  }
  return tokens
}

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }
  private take(): Token {
    const t = this.tokens[this.pos++]
    if (!t) throw new Error('Unexpected end of expression')
    return t
  }
  private expect(kind: Token['kind']): Token {
    const t = this.take()
    if (t.kind !== kind) throw new Error(`Expected ${kind} got ${t.kind}`)
    return t
  }

  parseExpr(): Node {
    return this.parseOr()
  }
  private parseOr(): Node {
    let left = this.parseAnd()
    while (this.peek()?.kind === 'op' && (this.peek() as { value: string }).value === '||') {
      this.take()
      left = { type: 'bin', op: '||', left, right: this.parseAnd() }
    }
    return left
  }
  private parseAnd(): Node {
    let left = this.parseCmp()
    while (this.peek()?.kind === 'op' && (this.peek() as { value: string }).value === '&&') {
      this.take()
      left = { type: 'bin', op: '&&', left, right: this.parseCmp() }
    }
    return left
  }
  private parseCmp(): Node {
    let left = this.parseAdd()
    while (
      this.peek()?.kind === 'op' &&
      ['==', '!=', '<', '<=', '>', '>='].includes((this.peek() as { value: string }).value)
    ) {
      const op = (this.take() as { value: string }).value
      left = { type: 'bin', op, left, right: this.parseAdd() }
    }
    return left
  }
  private parseAdd(): Node {
    let left = this.parseMul()
    while (
      this.peek()?.kind === 'op' &&
      ['+', '-'].includes((this.peek() as { value: string }).value)
    ) {
      const op = (this.take() as { value: string }).value
      left = { type: 'bin', op, left, right: this.parseMul() }
    }
    return left
  }
  private parseMul(): Node {
    let left = this.parseUnary()
    while (
      this.peek()?.kind === 'op' &&
      ['*', '/'].includes((this.peek() as { value: string }).value)
    ) {
      const op = (this.take() as { value: string }).value
      left = { type: 'bin', op, left, right: this.parseUnary() }
    }
    return left
  }
  private parseUnary(): Node {
    if (this.peek()?.kind === 'op' && (this.peek() as { value: string }).value === '-') {
      this.take()
      return { type: 'unary', op: '-', operand: this.parseUnary() }
    }
    return this.parsePrimary()
  }
  private parsePrimary(): Node {
    const t = this.take()
    if (t.kind === 'num') return { type: 'num', value: t.value }
    if (t.kind === 'lparen') {
      const e = this.parseExpr()
      this.expect('rparen')
      return e
    }
    if (t.kind === 'ident') {
      // function call?
      if (this.peek()?.kind === 'lparen') {
        this.take()
        const args: Node[] = []
        if (this.peek()?.kind !== 'rparen') {
          args.push(this.parseExpr())
          while (this.peek()?.kind === 'comma') {
            this.take()
            args.push(this.parseExpr())
          }
        }
        this.expect('rparen')
        return { type: 'call', name: t.value, args }
      }
      return { type: 'ref', name: t.value }
    }
    throw new Error(`Unexpected token ${t.kind}`)
  }
}

type Node =
  | { type: 'num'; value: number }
  | { type: 'ref'; name: string }
  | { type: 'unary'; op: string; operand: Node }
  | { type: 'bin'; op: string; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] }

function evalNode(node: Node, values: Record<string, unknown>): number | boolean {
  switch (node.type) {
    case 'num':
      return node.value
    case 'ref': {
      const v = values[node.name]
      if (typeof v === 'boolean') return v
      const n = Number(v ?? 0)
      return Number.isFinite(n) ? n : 0
    }
    case 'unary': {
      const x = evalNode(node.operand, values)
      if (node.op === '-') return -(x as number)
      return 0
    }
    case 'bin': {
      const l = evalNode(node.left, values)
      const r = evalNode(node.right, values)
      switch (node.op) {
        case '+':
          return (l as number) + (r as number)
        case '-':
          return (l as number) - (r as number)
        case '*':
          return (l as number) * (r as number)
        case '/':
          return (r as number) === 0 ? 0 : (l as number) / (r as number)
        case '==':
          return l === r
        case '!=':
          return l !== r
        case '<':
          return (l as number) < (r as number)
        case '<=':
          return (l as number) <= (r as number)
        case '>':
          return (l as number) > (r as number)
        case '>=':
          return (l as number) >= (r as number)
        case '&&':
          return Boolean(l) && Boolean(r)
        case '||':
          return Boolean(l) || Boolean(r)
      }
      return 0
    }
    case 'call': {
      const args = node.args.map((a) => evalNode(a, values))
      switch (node.name) {
        case 'min':
          return Math.min(...(args as number[]))
        case 'max':
          return Math.max(...(args as number[]))
        case 'sum':
          return (args as number[]).reduce((a, b) => a + b, 0)
        case 'avg': {
          const nums = args as number[]
          return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
        }
        case 'if': {
          const [cond, t, f] = args
          return cond ? (t as number) : (f as number)
        }
        case 'round':
          return Math.round(args[0] as number)
        case 'floor':
          return Math.floor(args[0] as number)
        case 'ceil':
          return Math.ceil(args[0] as number)
        default:
          throw new Error(`Unknown function ${node.name}`)
      }
    }
  }
}

export function evaluateFormula(expr: string, values: Record<string, unknown>): number {
  const tokens = tokenize(expr)
  const parser = new Parser(tokens)
  const node = parser.parseExpr()
  const result = evalNode(node, values)
  return Number(result)
}
