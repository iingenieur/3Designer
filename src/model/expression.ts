export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly expression: string,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

type Token =
  | { kind: "num"; value: number }
  | { kind: "id"; value: string }
  | { kind: "op"; value: string }
  | { kind: "end" };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: (x) => Math.sin((x * Math.PI) / 180),
  cos: (x) => Math.cos((x * Math.PI) / 180),
  tan: (x) => Math.tan((x * Math.PI) / 180),
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?|^[0-9]+\.?/i.exec(src.slice(i));
      if (!m) throw new ExpressionError(`잘못된 숫자 "${c}"`, src);
      tokens.push({ kind: "num", value: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ kind: "id", value: m[0] });
      i += m[0].length;
    } else if ("+-*/^(),".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i++;
    } else {
      throw new ExpressionError(`잘못된 문자 "${c}"`, src);
    }
  }
  tokens.push({ kind: "end" });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly vars: Record<string, number>,
    private readonly src: string,
  ) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.kind === "op" && t.value === v;
  }
  /** 다음 토큰이 연산자임을 알고 있을 때 그 문자를 소비한다. */
  private nextOp(): string {
    const t = this.next();
    if (t.kind !== "op") this.fail("연산자가 필요합니다");
    return t.value;
  }
  private fail(msg: string): never {
    throw new ExpressionError(msg, this.src);
  }

  parse(): number {
    const value = this.additive();
    if (this.peek().kind !== "end") this.fail("수식 끝에 예상치 못한 토큰");
    return value;
  }

  private additive(): number {
    let left = this.multiplicative();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.nextOp();
      const right = this.multiplicative();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  private multiplicative(): number {
    let left = this.power();
    while (this.isOp("*") || this.isOp("/")) {
      const op = this.nextOp();
      const right = this.power();
      if (op === "/") {
        if (right === 0) this.fail("0으로 나눌 수 없습니다");
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  private power(): number {
    const base = this.unary();
    if (this.isOp("^")) {
      this.next();
      return Math.pow(base, this.power());
    }
    return base;
  }

  private unary(): number {
    if (this.isOp("-")) {
      this.next();
      return -this.unary();
    }
    if (this.isOp("+")) {
      this.next();
      return this.unary();
    }
    return this.primary();
  }

  private primary(): number {
    const t = this.next();
    if (t.kind === "num") return t.value;
    if (t.kind === "op" && t.value === "(") {
      const v = this.additive();
      if (!this.isOp(")")) this.fail("닫는 괄호가 없습니다");
      this.next();
      return v;
    }
    if (t.kind === "id") {
      if (this.isOp("(")) {
        this.next();
        if (!Object.hasOwn(FUNCTIONS, t.value)) this.fail(`알 수 없는 함수 "${t.value}"`);
        const fn = FUNCTIONS[t.value];
        const args: number[] = [];
        if (!this.isOp(")")) {
          args.push(this.additive());
          while (this.isOp(",")) {
            this.next();
            args.push(this.additive());
          }
        }
        if (!this.isOp(")")) this.fail("닫는 괄호가 없습니다");
        this.next();
        return fn(...args);
      }
      if (!Object.hasOwn(this.vars, t.value)) this.fail(`알 수 없는 변수 "${t.value}"`);
      return this.vars[t.value];
    }
    this.fail("값이 필요한 자리에 값이 없습니다");
  }
}

/** 수식 문자열을 숫자로 평가한다. 실패 시 ExpressionError. */
export function evaluate(expression: string, vars: Record<string, number>): number {
  if (expression.trim() === "") throw new ExpressionError("빈 수식", expression);
  const value = new Parser(tokenize(expression), vars, expression).parse();
  if (!Number.isFinite(value)) throw new ExpressionError("결과가 유한한 숫자가 아닙니다", expression);
  return value;
}
