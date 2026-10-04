import { decode, encode } from "../shared/bson";
import type { Settings } from "../shared/contracts";
import { formatBsonDate } from "./datetime";
import { prettyDocument } from "./json-format";

export function editedValue(original: any, text: string): string {
  if (typeof original === "string") return JSON.stringify(text);
  if (original && typeof original === "object") {
    if (Object.hasOwn(original, "$date")) {
      const date = new Date(text);
      if (Number.isNaN(date.valueOf())) throw new Error("Invalid date");
      return JSON.stringify({ $date: { $numberLong: String(date.valueOf()) } });
    }
    const key = Object.keys(original)[0];
    if (key === "$oid") {
      try {
        const trimmed = text.trim();
        const input = /^[\da-f]{24}$/i.test(trimmed)
          ? `ObjectId(${JSON.stringify(trimmed)})`
          : trimmed;
        const parsed = decode(input);
        if (parsed?._bsontype !== "ObjectId") throw new Error("not ObjectId");
        return encode(parsed);
      } catch {
        throw new Error("ObjectId requires 24 hexadecimal characters");
      }
    }
    if (
      ["$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"].includes(
        key,
      )
    )
      return JSON.stringify({ [key]: text });
  }
  return JSON.stringify(JSON.parse(text));
}

function dateText(value: any, settings?: Partial<Settings>) {
  const date = new Date(Number(value?.$date?.$numberLong ?? value?.$date));
  if (Number.isNaN(date.valueOf())) return String(value);
  return formatBsonDate(date, settings);
}

export function label(value: any, settings?: Partial<Settings>): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value !== "object") return String(value);
  if (value.$oid) return `ObjectId(${JSON.stringify(value.$oid)})`;
  if (value.$numberLong !== undefined) return value.$numberLong;
  if (value.$numberInt !== undefined) return value.$numberInt;
  if (value.$numberDouble !== undefined) return value.$numberDouble;
  if (value.$numberDecimal !== undefined) return value.$numberDecimal;
  if (value.$date) return dateText(value, settings);
  return prettyDocument(value);
}
