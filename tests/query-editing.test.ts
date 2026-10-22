import { expect, test } from "vitest";
import { encode, object } from "../src/shared/bson";
import {
  editQueryIndentation,
  formatQuery,
  querySortDirections,
  hasQuerySort,
  queryKeyIntent,
  querySuggestionKeyIntent,
  querySuggestionsAllowed,
} from "../src/renderer/query-editing";

test("completion does not cover Run when a shorthand filter ends in regex flags", () => {
  for (const source of [
    "name:/^ada$/i",
    "name:/a[\\/]b/im",
    "name:/unfinished",
    'name:"Ada',
    'name:["Ada',
    "// comment",
    "name:1, /* comment",
  ])
    expect(querySuggestionsAllowed(source, source.length)).toBe(false);
  for (const source of ["name:{$g", "{na", '{"na', "name: /a/i, st"])
    expect(querySuggestionsAllowed(source, source.length)).toBe(true);
});

test("formatting Mongo regex queries preserves escaped patterns and flags", () => {
  const source = String.raw`{name:/^Ada/i,path:{$in:[/^a\/b\d+$/im,/測試/u]}}`;
  const formatted = formatQuery(source);
  expect(formatted).toContain("/^Ada/i");
  expect(formatted).toContain(String.raw`/^a\/b\d+$/im`);
  expect(encode(object(formatted))).toBe(encode(object(source)));
  expect(() => formatQuery("{name:/Ada/g}")).toThrow(/flag.*g/i);
});

test("query keys keep Enter as a newline and reserve query execution for F5", () => {
  expect(queryKeyIntent("F5")).toBe("run");
  expect(queryKeyIntent("Enter")).toBe("newline");
  expect(queryKeyIntent("Enter", true)).toBe("newline");
  expect(queryKeyIntent("Enter", false, true)).toBe("newline");
  expect(queryKeyIntent("Tab")).toBe("indent");
  expect(queryKeyIntent("Tab", true)).toBe("unindent");
  expect(queryKeyIntent("Tab", true, true)).toBeUndefined();
  expect(queryKeyIntent("Tab", false, false, true)).toBeUndefined();
});

test("query suggestion keys accept the highlighted item with Enter", () => {
  expect(querySuggestionKeyIntent("Enter", true, 3, 1)).toEqual({
    type: "accept",
    index: 1,
  });
  expect(querySuggestionKeyIntent("Enter", false, 3, 1)).toBeUndefined();
  expect(querySuggestionKeyIntent("Enter", true, 0, 1)).toBeUndefined();
  expect(querySuggestionKeyIntent("ArrowDown", true, 3, 2)).toEqual({
    type: "move",
    index: 0,
  });
  expect(querySuggestionKeyIntent("ArrowUp", true, 3, 0)).toEqual({
    type: "move",
    index: 2,
  });
  expect(querySuggestionKeyIntent("Escape", true, 3, 1)).toEqual({
    type: "dismiss",
  });
});

test("query indentation can be undone across selected lines or at one caret line", () => {
  const selected = "{ a: 1 }\n{ b: 2 }";
  const indented = editQueryIndentation(
    selected,
    0,
    selected.length,
    4,
    "indent",
  );
  expect(indented.value).toBe("    { a: 1 }\n    { b: 2 }");
  const restored = editQueryIndentation(
    indented.value,
    indented.selectionStart,
    indented.selectionEnd,
    4,
    "unindent",
  );
  expect(restored.value).toBe(selected);
  expect(restored.selectionStart).toBe(0);
  expect(restored.selectionEnd).toBe(selected.length);

  const source = '    { "a": 1 }\n  { "b": 2 }\n{ "c": 3 }';
  const wholeSelection = editQueryIndentation(
    source,
    0,
    source.length,
    4,
    "unindent",
  );
  expect(wholeSelection.value).toBe('{ "a": 1 }\n{ "b": 2 }\n{ "c": 3 }');

  const caret = editQueryIndentation("    { value: 1 }", 8, 8, 4, "unindent");
  expect(caret.value).toBe("{ value: 1 }");
  expect(caret.selectionStart).toBe(4);
  expect(caret.selectionEnd).toBe(4);
});
test("query formatter accepts shell keys, nested conditions and canonical BSON", () => {
  const source =
    '{kind:"async", score:{$gte:-1}, id:{$oid:"6a4f6bffbed892721b94b460"}, values:[null,true]}';
  expect(JSON.parse(formatQuery(source, 4))).toEqual({
    kind: "async",
    score: { $gte: -1 },
    id: { $oid: "6a4f6bffbed892721b94b460" },
    values: [null, true],
  });
  expect(formatQuery(source, 4)).toContain('\n    "kind"');
});
test("query formatter preserves literal ISODate and new Date expressions", () => {
  const query =
    '{ createdAt: { $gte: ISODate("2025-01-01T00:00:00.000Z"), $lt: new Date("2025-02-01T00:00:00.000Z") } }';
  const formatted = formatQuery(query);
  expect(formatted).toContain('ISODate("2025-01-01T00:00:00.000Z")');
  expect(formatted).toContain('new Date("2025-02-01T00:00:00.000Z")');
});
test("formatting preserves numeric lexemes and Int64 strings without evaluation", () => {
  expect(
    formatQuery(
      '{n:9007199254740993, m:-0, l:{$numberLong:"9007199254740993"}}',
    ),
  ).toContain("9007199254740993");
  expect(formatQuery("{n:9007199254740993, m:-0}")).toContain(
    '"n": 9007199254740993',
  );
  expect(formatQuery("{n:9007199254740993, m:-0}")).toContain('"m": -0');
  expect(() => formatQuery("{n:process.exit()}")).toThrow();
  expect(() => formatQuery("{n:")).toThrow();
  expect(() => formatQuery("[]")).toThrow();
});
test("header directions follow the actual sort expression, including clearing and manual compound sorts", () => {
  expect(querySortDirections("{score:-1,name:1}")).toEqual({
    score: -1,
    name: 1,
  });
  expect(querySortDirections("{}")).toEqual({});
  expect(querySortDirections("{score:")).toEqual({});
  expect(hasQuerySort("{}")).toBe(false);
  expect(hasQuerySort("{score:-1}")).toBe(true);
});
