/** A bounded, non-executing subset of Python literals used by Artisan .alog files.
 * Numeric lexemes and tuple identity survive edits without JS precision loss.
 */
export type Literal =
  | { kind: "dict"; entries: Array<{ key: string; value: Literal }> }
  | { kind: "list"; items: Literal[] }
  | { kind: "tuple"; items: Literal[] }
  | { kind: "string"; value: string }
  | { kind: "number"; raw: string }
  | { kind: "constant"; value: boolean | null };
export type DictLiteral = Extract<Literal, { kind: "dict" }>;
export const LITERAL_LIMITS = Object.freeze({
  bytes: 2 * 1024 * 1024,
  depth: 64,
  nodes: 200000,
  items: 50000,
  keys: 4096,
  string: 256 * 1024,
});
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const numberPattern = /^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

export function parsePythonLiteral(text: string): DictLiteral {
  if (
    typeof text !== "string" ||
    text.length > LITERAL_LIMITS.bytes ||
    new TextEncoder().encode(text).byteLength > LITERAL_LIMITS.bytes
  )
    throw new Error("原生文件大小不可超过 2 MiB / size limit");
  let at = 0,
    nodes = 0;
  const fail = (reason: string): never => {
    throw new Error(`ALOG 字符 ${at + 1}: ${reason}`);
  };
  const space = () => {
    while (/[ \t\r\n\f]/.test(text[at] ?? "") && at < text.length) at++;
  };
  const string = (): string => {
    if (text[at] === "u" || text[at] === "U") at++;
    const quote = text[at++];
    if (quote !== "'" && quote !== '"') fail("字典键须为字符串 / expected quoted string");
    let out = "";
    while (at < text.length) {
      let ch = text[at++];
      if (ch === quote) return out;
      if (ch === "\n" || ch === "\r" || ch === "\0") fail("字符串包含未转义换行或 NUL");
      if (ch === "\\") {
        if (at >= text.length) fail("未结束的转义");
        ch = text[at++];
        const simple: Record<string, string> = {
          "\\": "\\",
          "'": "'",
          '"': '"',
          a: "\x07",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
          v: "\v",
        };
        if (Object.hasOwn(simple, ch)) out += simple[ch];
        else if (ch === "\n") {
          /* Python escaped line continuation. */
        } else if (ch === "\r") {
          if (text[at] === "\n") at++;
        } else if (ch === "x" || ch === "u" || ch === "U") {
          const size = ch === "x" ? 2 : ch === "u" ? 4 : 8,
            hex = text.slice(at, at + size);
          if (hex.length !== size || !/^[\da-f]+$/i.test(hex)) fail("无效 Unicode / hex 转义");
          const code = parseInt(hex, 16);
          if (code > 0x10ffff) fail("Unicode code point 超出范围");
          out += String.fromCodePoint(code);
          at += size;
        } else if (/[0-7]/.test(ch)) {
          let octal = ch;
          while (octal.length < 3 && /[0-7]/.test(text[at] ?? "") && at < text.length)
            octal += text[at++];
          out += String.fromCodePoint(parseInt(octal, 8));
        } else out += `\\${ch}`; // Python repr preserves unknown escapes; never interpret as code.
      } else out += ch;
      if (out.length > LITERAL_LIMITS.string) fail("字符串超过长度限制 / string limit");
    }
    return fail("字符串未结束 / unterminated string");
  };
  const value = (depth: number): Literal => {
    if (depth > LITERAL_LIMITS.depth) fail("嵌套深度超过限制 / depth limit");
    if (++nodes > LITERAL_LIMITS.nodes) fail("节点数量超过限制 / node limit");
    space();
    const ch = text[at];
    if (ch === "{") {
      at++;
      space();
      const entries: DictLiteral["entries"] = [],
        seen = new Set<string>();
      if (text[at] === "}") {
        at++;
        return { kind: "dict", entries };
      }
      while (at < text.length) {
        const key = string();
        if (forbiddenKeys.has(key)) fail("禁止原型相关字典键 / unsafe key");
        if (seen.has(key)) fail("重复字典键 / duplicate key");
        seen.add(key);
        space();
        if (text[at++] !== ":") fail("字典键后缺少冒号");
        entries.push({ key, value: value(depth + 1) });
        if (entries.length > LITERAL_LIMITS.keys) fail("字典键数量超过限制 / key limit");
        space();
        const sep = text[at++];
        if (sep === "}") return { kind: "dict", entries };
        if (sep !== ",") fail("字典项须用逗号分隔");
        space();
        if (text[at] === "}") {
          at++;
          return { kind: "dict", entries };
        }
      }
      return fail("字典未结束");
    }
    if (ch === "[" || ch === "(") {
      at++;
      space();
      const close = ch === "[" ? "]" : ")",
        items: Literal[] = [];
      if (text[at] === close) {
        at++;
        return { kind: ch === "[" ? "list" : "tuple", items };
      }
      let comma = false;
      while (at < text.length) {
        items.push(value(depth + 1));
        if (items.length > LITERAL_LIMITS.items) fail("数组数量超过限制 / array limit");
        space();
        const sep = text[at++];
        if (sep === close)
          return ch === "(" && items.length === 1 && !comma
            ? items[0]
            : { kind: ch === "[" ? "list" : "tuple", items };
        if (sep !== ",") fail("数组项须用逗号分隔");
        comma = true;
        space();
        if (text[at] === close) {
          at++;
          return { kind: ch === "[" ? "list" : "tuple", items };
        }
      }
      return fail("数组未结束");
    }
    if (ch === "'" || ch === '"' || ((ch === "u" || ch === "U") && /['"]/.test(text[at + 1] ?? "")))
      return { kind: "string", value: string() };
    for (const [token, constant] of [
      ["True", true],
      ["False", false],
      ["None", null],
    ] as const) {
      if (text.startsWith(token, at)) {
        at += token.length;
        return { kind: "constant", value: constant };
      }
    }
    const match = text.slice(at).match(numberPattern);
    if (match) {
      const raw = match[0];
      at += raw.length;
      if (!Number.isFinite(Number(raw))) fail("数值须有限 / non-finite number");
      return { kind: "number", raw };
    }
    return fail("不支持的原生字面量；禁止名称、调用或可执行表达式 / unsupported literal");
  };
  const root = value(0);
  space();
  if (at !== text.length) fail("字面量后含多余内容 / trailing content");
  if (root.kind !== "dict") fail("原生文件根节点须为字典");
  return root as DictLiteral;
}

export function quotePythonString(value: string): string {
  let out = "'";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === "'" || ch === "\\") out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff))
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}'`;
}
export function writePythonLiteral(node: Literal): string {
  switch (node.kind) {
    case "dict":
      return `{${node.entries.map(({ key, value }) => `${quotePythonString(key)}: ${writePythonLiteral(value)}`).join(", ")}}`;
    case "list":
      return `[${node.items.map(writePythonLiteral).join(", ")}]`;
    case "tuple":
      return `(${node.items.map(writePythonLiteral).join(", ")}${node.items.length === 1 ? "," : ""})`;
    case "string":
      return quotePythonString(node.value);
    case "number":
      return node.raw;
    case "constant":
      return node.value === null ? "None" : node.value ? "True" : "False";
  }
}
/** Inspection only: numerical metadata may exceed JS precision; retain AST for writing. */
export function literalToValue(node: Literal): unknown {
  if (node.kind === "dict") {
    const out = Object.create(null) as Record<string, unknown>;
    for (const { key, value } of node.entries) out[key] = literalToValue(value);
    return out;
  }
  if (node.kind === "list" || node.kind === "tuple") return node.items.map(literalToValue);
  if (node.kind === "number") return Number(node.raw);
  return node.value;
}
export function fromValue(value: unknown): Literal {
  if (value === null || typeof value === "boolean") return { kind: "constant", value };
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "number" && Number.isFinite(value))
    return { kind: "number", raw: Object.is(value, -0) ? "-0.0" : String(value) };
  if (Array.isArray(value)) return { kind: "list", items: value.map(fromValue) };
  if (value && typeof value === "object")
    return {
      kind: "dict",
      entries: Object.entries(value).map(([key, item]) => {
        if (forbiddenKeys.has(key)) throw new Error("unsafe key");
        return { key, value: fromValue(item) };
      }),
    };
  throw new Error("Unsupported literal value");
}
