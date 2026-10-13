import { describe, it, expect } from "vitest";
import { evaluate, ExpressionError } from "./expression";

const vars = { D: 40, H: 20, boltPCD: 30 };

describe("evaluate", () => {
  it("evaluates numbers and arithmetic", () => {
    expect(evaluate("2 + 3 * 4", {})).toBe(14);
    expect(evaluate("(2 + 3) * 4", {})).toBe(20);
    expect(evaluate("10 / 4", {})).toBe(2.5);
    expect(evaluate("-3 + 5", {})).toBe(2);
    expect(evaluate("2 ^ 3", {})).toBe(8);
  });

  it("resolves variables", () => {
    expect(evaluate("D/2", vars)).toBe(20);
    expect(evaluate("H - 2", vars)).toBe(18);
    expect(evaluate("boltPCD", vars)).toBe(30);
  });

  it("supports functions", () => {
    expect(evaluate("sqrt(16)", {})).toBe(4);
    expect(evaluate("max(1, 5, 3)", {})).toBe(5);
    expect(evaluate("min(D, H)", vars)).toBe(20);
    expect(evaluate("abs(-2)", {})).toBe(2);
    expect(evaluate("cos(0)", {})).toBe(1);
  });

  it("throws on unknown variable", () => {
    expect(() => evaluate("X + 1", vars)).toThrow(ExpressionError);
    expect(() => evaluate("X + 1", vars)).toThrow('알 수 없는 변수 "X"');
  });

  it("does not resolve Object.prototype keys as variables or functions", () => {
    expect(() => evaluate("constructor", {})).toThrow(ExpressionError);
    expect(() => evaluate("toString(1)", {})).toThrow(ExpressionError);
  });

  it("throws on division by zero", () => {
    expect(() => evaluate("1 / 0", {})).toThrow(ExpressionError);
  });

  it("throws on syntax error", () => {
    expect(() => evaluate("2 +", {})).toThrow(ExpressionError);
    expect(() => evaluate("2 2", {})).toThrow(ExpressionError);
    expect(() => evaluate("", {})).toThrow(ExpressionError);
  });
});
