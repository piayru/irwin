import { decode, encode } from "../shared/bson";
import { prettyDocument } from "./json-format";

export type DocumentChange = {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: string;
  after?: string;
};

function valueText(value: unknown) {
  if (value === undefined) return "undefined";
  const displayValue =
    value !== null && typeof value === "object"
      ? JSON.parse(encode(value))
      : value;
  return prettyDocument(displayValue);
}

function isDocument(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function bsonValueType(value: unknown): string {
  if (value === null) return "Null";
  if (Array.isArray(value)) return "Array";
  if (value instanceof Date) return "Date";
  if (isDocument(value)) return "Object";
  if (value && typeof value === "object" && "_bsontype" in value) {
    const type = String(value._bsontype);
    return type === "Long" ? "Int64" : type;
  }
  const type = typeof value;
  return type[0].toUpperCase() + type.slice(1);
}

export function documentTypeChanges(
  before: unknown,
  after: unknown,
  root = "",
  limit = 5,
): { path: string; before: string; after: string }[] {
  const changes: { path: string; before: string; after: string }[] = [];
  const visit = (oldValue: unknown, newValue: unknown, path: string) => {
    const oldType = bsonValueType(oldValue);
    const newType = bsonValueType(newValue);
    if (oldType !== newType) {
      changes.push({ path: path || "$", before: oldType, after: newType });
    } else if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      const length = Math.min(oldValue.length, newValue.length);
      for (let index = 0; index < length && changes.length < limit; index++) {
        visit(oldValue[index], newValue[index], `${path || "$"}[${index}]`);
      }
    } else if (isDocument(oldValue) && isDocument(newValue)) {
      for (const key of Object.keys(oldValue)) {
        if (changes.length >= limit) break;
        if (!Object.hasOwn(newValue, key)) continue;
        const child = /^[A-Za-z_$][\w$]*$/.test(key)
          ? path
            ? `${path}.${key}`
            : key
          : `${path || "$"}[${JSON.stringify(key)}]`;
        visit(oldValue[key], newValue[key], child);
      }
    }
  };
  visit(before, after, root);
  return changes;
}

function diff(before: any, after: any, path: string, output: DocumentChange[]) {
  if (isDocument(before) && isDocument(after)) {
    for (const key of [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort()) {
      const child = path ? `${path}.${key}` : key;
      if (!Object.hasOwn(before, key))
        output.push({
          path: child,
          kind: "added",
          after: valueText(after[key]),
        });
      else if (!Object.hasOwn(after, key))
        output.push({
          path: child,
          kind: "removed",
          before: valueText(before[key]),
        });
      else diff(before[key], after[key], child, output);
    }
    return;
  }
  if (encode(before) !== encode(after))
    output.push({
      path: path || "$",
      kind: "changed",
      before: valueText(before),
      after: valueText(after),
    });
}

export function documentChanges(
  original: string,
  current: string,
  numericReference?: string,
): DocumentChange[] {
  const output: DocumentChange[] = [];
  const baseline = decode(original);
  const reference =
    numericReference === undefined ? baseline : decode(numericReference);
  diff(baseline, decode(current, reference), "", output);
  return output;
}
