import { parseExpression } from "@babel/parser";
import {
  decode,
  encode,
  normalizeFilter,
  object,
  parseIsoDate,
  validPath,
} from "./bson";
import type { FieldHint } from "./exploration";

function fieldKey(field: string) {
  if (!field.trim() || !validPath(field) || field.length > 255)
    throw new Error("Enter a valid field path / 請輸入有效的欄位路徑");
  return JSON.stringify(field);
}
export function combineFilterCondition(
  current: string,
  condition: string,
): string {
  const normalized = normalizeFilter(current);
  object(condition);
  return Object.keys(object(normalized)).length
    ? `{$and:[\n${normalized}\n,\n${condition}\n]}`
    : condition;
}
export function buildRegexCondition(
  field: string,
  pattern: string,
  flags: string,
): string {
  if (pattern.length > 1000)
    throw new Error("Pattern exceeds 1,000 characters / 規則最多 1,000 字元");
  // Escape delimiters without changing existing regex escapes.
  let literal = "",
    escaped = false;
  for (const character of pattern) {
    if (character === "/" && !escaped) literal += "\\/";
    else if (character === "\n") literal += "\\n";
    else if (character === "\r") literal += "\\r";
    else if (character === "\u2028") literal += "\\u2028";
    else if (character === "\u2029") literal += "\\u2029";
    else literal += character;
    escaped = character === "\\" && !escaped;
  }
  const condition = `{${fieldKey(field)}:/${literal || "(?:)"}/${flags}}`;
  object(condition);
  return condition;
}
export type ListType = "string" | "number" | "objectId";
export type ListSeparator = "newline" | "comma" | "tab";
export function buildListCondition(
  field: string,
  text: string,
  type: ListType,
  separator: ListSeparator,
) {
  const key = fieldKey(field);
  if (text.length > 64000)
    throw new Error("List exceeds 64,000 characters / 清單過長");
  const lines = text
    .split(
      separator === "comma" ? /,/ : separator === "tab" ? /\t|\r?\n/ : /\r?\n/,
    )
    .map((value) => value.trim());
  if (lines.filter(Boolean).length > 500)
    throw new Error("Use at most 500 values / 最多 500 個值");
  const values: string[] = [],
    seen = new Set<string>();
  let duplicates = 0;
  for (const line of lines.filter(Boolean)) {
    let source: string;
    if (type === "objectId")
      source = buildObjectIdCondition("v", line).slice(5, -1);
    else if (type === "number") {
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(line))
        throw new Error(`Invalid number / 無效數字: ${line.slice(0, 40)}`);
      source = line;
    } else source = JSON.stringify(line);
    const identity = encode(decode(source));
    if (seen.has(identity)) {
      duplicates++;
      continue;
    }
    seen.add(identity);
    values.push(source);
  }
  if (!values.length)
    throw new Error("Enter at least one value / 請輸入至少一個值");
  return {
    condition: `{${key}:{$in:[${values.join(",\n")}]}}`,
    count: values.length,
    duplicates,
  };
}
export function buildObjectIdCondition(field: string, hex: string): string {
  if (!/^[a-f\d]{24}$/i.test(hex.trim()))
    throw new Error(
      "ObjectId requires 24 hexadecimal characters / ObjectId 需為 24 位十六進位字元",
    );
  return `{${fieldKey(field)}:ObjectId(${JSON.stringify(hex.trim())})}`;
}
export type ObjectIdConversion = {
  field: string;
  start: number;
  end: number;
  value: string;
};
export function objectIdConversions(
  text: string,
  fields: FieldHint[],
): ObjectIdConversion[] {
  if (text.length > 64000) return [];
  const source = normalizeFilter(text);
  const known = new Set(
    fields
      .filter(
        (field) => field.types.length === 1 && field.types[0] === "ObjectId",
      )
      .map((field) => field.path),
  );
  if (!fields.some((field) => field.path === "_id")) known.add("_id");
  const candidates: ObjectIdConversion[] = [];
  try {
    object(source); // Only accepted literal query syntax may be transformed.
    const walk = (node: any, field = "") => {
      if (
        node.type === "StringLiteral" &&
        known.has(field) &&
        /^[a-f\d]{24}$/i.test(node.value)
      )
        candidates.push({
          field,
          start: node.start,
          end: node.end,
          value: node.value,
        });
      if (node.type === "ArrayExpression")
        node.elements.forEach((value: any) => walk(value, field));
      if (node.type === "ObjectExpression")
        for (const property of node.properties) {
          const key = property.key.name ?? property.key.value;
          if (
            [
              "$regex",
              "$options",
              "$regularExpression",
              "$literal",
              "$expr",
            ].includes(key)
          )
            continue;
          const next = key.startsWith("$")
            ? field
            : field
              ? `${field}.${key}`
              : key;
          walk(property.value, next);
        }
    };
    walk(parseExpression(source, { sourceType: "module" }));
  } catch {
    return [];
  }
  return candidates;
}
export function convertObjectIdStrings(
  text: string,
  fields: FieldHint[],
): string {
  let source = normalizeFilter(text);
  for (const candidate of objectIdConversions(text, fields).reverse())
    source =
      source.slice(0, candidate.start) +
      `ObjectId(${JSON.stringify(candidate.value)})` +
      source.slice(candidate.end);
  object(source);
  return source;
}
export type DateRange = {
  start?: string;
  end?: string;
  zone: string;
  inclusiveEnd?: boolean;
};
function dateValue(value: string, zone: string) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(value))
    throw new Error("Use a complete date and time / 請輸入完整日期與時間");
  if (zone === "local") {
    const date = new Date(value);
    const local = [
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
    ];
    const expected = value.split(/\D/).slice(0, 6).map(Number);
    if (
      Number.isNaN(date.valueOf()) ||
      expected.some((part, index) => part !== local[index])
    )
      throw new Error(
        "Invalid local date or daylight-saving time / 日期或本機夏令時間無效",
      );
    return date;
  }
  if (
    zone !== "UTC" &&
    (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(zone) || /14:(?!00)/.test(zone))
  )
    throw new Error("Invalid UTC offset / 無效時區偏移");
  return parseIsoDate(
    (value.length === 16 ? value + ":00" : value) +
      (zone === "UTC" ? "Z" : zone),
    "Date / 日期",
  );
}
export function buildDateCondition(field: string, range: DateRange): string {
  const key = fieldKey(field);
  if (!range.start && !range.end)
    throw new Error("Choose a start or end time / 請選擇起始或結束時間");
  const start = range.start ? dateValue(range.start, range.zone) : undefined;
  const end = range.end ? dateValue(range.end, range.zone) : undefined;
  if (start && end && start >= end)
    throw new Error("End must be after start / 結束時間必須晚於起始時間");
  const parts = [
    start && `$gte:ISODate(${JSON.stringify(start.toISOString())})`,
    end &&
      `${range.inclusiveEnd ? "$lte" : "$lt"}:ISODate(${JSON.stringify(end.toISOString())})`,
  ].filter(Boolean);
  return `{${key}:{${parts.join(",")}}}`;
}
export type EmptyKind = "null" | "missing" | "emptyString" | "emptyArray";
function exactFieldExpression(field: string): any {
  // Aggregation dotted paths do not interpret numeric array indexes like find.
  // Bind each step once, so both array positions and numeric object keys work.
  let expression: any = "$$ROOT";
  for (const part of field.split(".")) {
    if (/^\d+$/.test(part))
      expression = {
        $let: {
          vars: { value: expression },
          in: {
            $cond: [
              { $isArray: "$$value" },
              { $arrayElemAt: ["$$value", Number(part)] },
              `$$value.${part}`,
            ],
          },
        },
      };
    else
      expression =
        typeof expression === "string"
          ? expression + "." + part
          : { $let: { vars: { value: expression }, in: `$$value.${part}` } };
  }
  return expression;
}
export function buildEmptyCondition(field: string, kind: EmptyKind): string {
  const key = fieldKey(field);
  if (kind === "missing") return `{${key}:{$exists:false}}`;
  if (kind === "emptyArray") return `{${key}:{$size:0}}`;
  const type = kind === "null" ? "null" : "string";
  const literal = kind === "null" ? "null" : '""';
  return `{$and:[{${key}:{$eq:${literal},$exists:true}},{$expr:{$eq:[{$type:${JSON.stringify(exactFieldExpression(field))}},${JSON.stringify(type)}]}}]}`;
}
export type DiagnosticProbe = {
  id: string;
  kind: "collection" | "only" | "without";
  field: string;
  filter: string;
};
export function diagnosticProbes(filter: string): {
  probes: DiagnosticProbe[];
  truncated: boolean;
} {
  if (filter.length > 64000)
    throw new Error(
      "Filter is too long to diagnose / 請先縮小診斷條件，最多 64,000 字元",
    );
  const query = object(normalizeFilter(filter));
  const clauses: { field: string; value: Record<string, any> }[] = [];
  const guard = (value: any, depth = 0) => {
    if (depth > 15)
      throw new Error(
        "Filter is too deeply nested to diagnose / 診斷條件巢狀層數過深",
      );
    if (
      !value ||
      typeof value !== "object" ||
      (!Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype)
    )
      return;
    for (const [key, child] of Object.entries(value)) {
      if (["$where", "$function", "$accumulator"].includes(key))
        throw new Error(
          "Diagnosis does not run JavaScript conditions / 診斷不執行 JavaScript 條件",
        );
      guard(child, depth + 1);
    }
  };
  guard(query);
  const flatten = (value: Record<string, any>, depth = 0) => {
    if (depth > 10 || clauses.length > 64)
      throw new Error(
        "Filter is too complex to diagnose / 條件過於複雜，請先縮小範圍",
      );
    for (const [field, item] of Object.entries(value)) {
      if (field === "$and" && Array.isArray(item))
        item.forEach((child) => flatten(child, depth + 1));
      else {
        if (clauses.length >= 64)
          throw new Error(
            "Filter is too complex to diagnose / 條件過於複雜，請先縮小範圍",
          );
        clauses.push({ field, value: { [field]: item } });
      }
    }
  };
  flatten(query);
  const probes: DiagnosticProbe[] = [
    { id: "collection", kind: "collection", field: "", filter: "{}" },
  ];
  clauses.slice(0, 4).forEach((clause, index) => {
    probes.push({
      id: `only-${index}`,
      kind: "only",
      field: clause.field,
      filter: encode(clause.value),
    });
    const remaining = clauses
      .filter((_, i) => i !== index)
      .map((item) => item.value);
    probes.push({
      id: `without-${index}`,
      kind: "without",
      field: clause.field,
      filter: remaining.length ? encode({ $and: remaining }) : "{}",
    });
  });
  return { probes, truncated: clauses.length > 4 };
}
