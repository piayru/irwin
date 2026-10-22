import { expect, test } from "vitest";
import { object, normalizeFilter, encode } from "../src/shared/bson";
import {
  buildRegexCondition,
  buildListCondition,
  buildObjectIdCondition,
  objectIdConversions,
  convertObjectIdStrings,
  buildDateCondition,
  buildEmptyCondition,
  combineFilterCondition,
  diagnosticProbes,
} from "../src/shared/filter-tools";

test("filter shorthand wraps literal properties only, leaving writes strict", () => {
  expect(
    object(normalizeFilter("name: /Ada/i, score: {$gte: 1}")).name.pattern,
  ).toBe("Ada");
  expect(object(normalizeFilter('// note\nname: "Ada" // ending')).name).toBe(
    "Ada",
  );
  expect(() => object('name: "Ada"')).toThrow();
  for (const text of [
    "db.dropDatabase()",
    "name: process.exit()",
    "...source",
    "[1,2]",
    "/abc/i",
  ])
    expect(() => object(normalizeFilter(text))).toThrow();
});
test("regex builder preserves slash/backslash escapes without executing a pattern", () => {
  const value = object(
    buildRegexCondition("profile.name", String.raw`a/b\d+`, "im"),
  );
  expect(value["profile.name"].pattern).toBe(String.raw`a\/b\d+`);
  expect(value["profile.name"].options).toBe("im");
  expect(() => buildRegexCondition("$where", "a", "i")).toThrow();
  expect(() => buildRegexCondition("name", "a", "g")).toThrow();
});
test("list builder removes blank lines and duplicates without rounding numeric IDs", () => {
  const strings = buildListCondition(
    "code",
    "001\n002\n001\n\n",
    "string",
    "newline",
  );
  expect(object(strings.condition).code.$in).toEqual(["001", "002"]);
  expect(strings).toMatchObject({ count: 2, duplicates: 1 });
  const numbers = object(
    buildListCondition("n", "9007199254740993,2", "number", "comma").condition,
  );
  expect(numbers.n.$in[0].toString()).toBe("9007199254740993");
  expect(() =>
    buildListCondition("n", "1;db.dropDatabase()", "number", "newline"),
  ).toThrow();
  expect(() => buildListCondition("n", "", "string", "newline")).toThrow();
  expect(() =>
    buildListCondition(
      "n",
      Array(502).fill("x").join("\n"),
      "string",
      "newline",
    ),
  ).toThrow(/500/);
});
test("ObjectId suggestions only target known identity fields and require explicit conversion", () => {
  const hex = "507f1f77bcf86cd799439011";
  const filter = `_id: "${hex}", owner: { $in: ["${hex}"] }, note: "${hex}", title: {$regex:"${hex}"}`;
  const hints = [
    { path: "owner", types: ["ObjectId"] },
    { path: "note", types: ["String"] },
  ];
  const suggestions = objectIdConversions(filter, hints);
  expect(suggestions.map((item) => item.field)).toEqual(["_id", "owner"]);
  expect(
    objectIdConversions(`_id:"${hex}"`, [{ path: "_id", types: ["String"] }]),
  ).toEqual([]);
  expect(object(normalizeFilter(filter))._id).toBe(hex);
  const converted = object(convertObjectIdStrings(filter, hints));
  expect(converted._id.toHexString()).toBe(hex);
  expect(converted.owner.$in[0].toHexString()).toBe(hex);
  expect(converted.note).toBe(hex);
  expect(object(buildObjectIdCondition("owner", hex)).owner.toHexString()).toBe(
    hex,
  );
  expect(() => buildObjectIdCondition("owner", "invalid")).toThrow();
});
test("date range builder converts explicit timezones and rejects invalid or reversed dates", () => {
  const condition = object(
    buildDateCondition("createdAt", {
      start: "2026-10-22T08:00",
      end: "2026-10-23T08:00",
      zone: "+08:00",
    }),
  );
  expect(condition.createdAt.$gte.toISOString()).toBe(
    "2026-10-22T00:00:00.000Z",
  );
  expect(condition.createdAt.$lt.toISOString()).toBe(
    "2026-10-23T00:00:00.000Z",
  );
  expect(() =>
    buildDateCondition("createdAt", { start: "2026-02-30T00:00", zone: "UTC" }),
  ).toThrow();
  expect(() =>
    buildDateCondition("createdAt", {
      start: "2026-10-23T00:00",
      end: "2026-10-22T00:00",
      zone: "UTC",
    }),
  ).toThrow();
  expect(() => buildDateCondition("createdAt", { zone: "UTC" })).toThrow();
  expect(() =>
    buildDateCondition("createdAt", {
      start: "2026-10-22T00:00",
      zone: "+99:00",
    }),
  ).toThrow();
});
test("empty values are distinct and new conditions retain existing BSON values", () => {
  const empty = object(buildEmptyCondition("a", "missing"));
  expect(empty).toEqual({ a: { $exists: false } });
  expect(encode(object(buildEmptyCondition("a", "null")))).toContain('"null"');
  expect(encode(object(buildEmptyCondition("a", "emptyString")))).toContain(
    '"string"',
  );
  expect(Number(object(buildEmptyCondition("a", "emptyArray")).a.$size)).toBe(
    0,
  );
  const combined = object(
    combineFilterCondition(
      'n:NumberLong("9007199254740993")',
      buildEmptyCondition("a", "missing"),
    ),
  );
  expect(combined.$and[0].n.toString()).toBe("9007199254740993");
  expect(combined.$and[1]).toEqual(empty);
});
test("diagnostic probes are bounded and keep OR groups intact", () => {
  const plan = diagnosticProbes("a:1,$and:[{b:2},{$or:[{c:3},{d:4}]}]");
  expect(plan.probes).toHaveLength(7);
  expect(plan.probes[0].filter).toBe("{}");
  expect(
    plan.probes.some((probe) => object(probe.filter).$or?.length === 2),
  ).toBe(true);
  expect(
    diagnosticProbes("a:1,b:2,c:3,d:4,e:5").probes.length,
  ).toBeLessThanOrEqual(9);
  expect(diagnosticProbes("a:1,b:2,c:3,d:4,e:5").truncated).toBe(true);
  expect(() => diagnosticProbes('{$where:"return true"}')).toThrow();
});
test("diagnosis refuses excessive complexity and cannot trust a user-supplied BSON type label", () => {
  expect(() =>
    diagnosticProbes(
      Array.from({ length: 65 }, (_, index) => `f${index}:1`).join(","),
    ),
  ).toThrow();
  expect(() =>
    diagnosticProbes('{$and:[{_bsontype:"BSONRegExp",$where:"return true"}]}'),
  ).toThrow();
});
