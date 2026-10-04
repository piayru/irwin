import { describe, expect, it } from "vitest";
import { Decimal128, Double, Int32, Long, ObjectId } from "bson";
import {
  formatDocument,
  formatEditableDocument,
  prettyDocument,
  shellJsonLanguage,
} from "../src/renderer/json-format";
import { decode, encode } from "../src/shared/bson";

describe("JSON document formatting", () => {
  it("uses the configured indentation width", () => {
    expect(
      prettyDocument(
        { profile: { name: "Ada", tags: ["math", "code"] } },
        { indent: 4 },
      ),
    ).toContain("    profile: {");
  });

  it("shows exact numeric values without BSON type labels in the JSON view", () => {
    const displayed = prettyDocument({
      _id: { $oid: "507f1f77bcf86cd799439011" },
      count: { $numberInt: "7" },
      score: { $numberDouble: "1.2" },
      largeLong: { $numberLong: "9007199254740993" },
      price: { $numberDecimal: "1234.50" },
      createdAt: { $date: { $numberLong: "1735787045000" } },
      nested: [{ count: { $numberInt: "2" } }],
    });
    expect(displayed).toContain('ObjectId("507f1f77bcf86cd799439011")');
    expect(displayed).toContain('ISODate("2025-01-02T03:04:05.000Z")');
    expect(displayed).toContain("count: 7");
    expect(displayed).toContain("score: 1.2");
    expect(displayed).toContain("largeLong: 9007199254740993");
    expect(displayed).toContain("price: 1234.50");
    expect(displayed).toContain("count: 2");
    expect(displayed).not.toMatch(/(?:Int32|Long|Double|Decimal128)\(/);
  });
  it("formats JSON or shell-friendly documents with the configured indentation", () => {
    const formatted = formatDocument(
      '{"name":"Ada","n":{"$numberInt":"1"}}',
      4,
    );
    expect(formatted).toContain("    n: 1");
    expect(formatted).not.toContain("Int32(");
  });

  it("formats a manually entered single-quoted ISODate without changing its value", () => {
    const editable = formatDocument(
      "{ createdAt: ISODate('2026-07-02T09:26:31.616Z') }",
      2,
    );

    expect(editable).toContain(
      'createdAt: ISODate("2026-07-02T09:26:31.616Z")',
    );
    expect(decode(editable).createdAt.toISOString()).toBe(
      "2026-07-02T09:26:31.616Z",
    );
  });

  it("uses the JSON view's friendly BSON syntax for safe document edits", () => {
    const document = {
      _id: new ObjectId("507f1f77bcf86cd799439011"),
      count: new Int32(7),
      score: new Double(1),
      exactLong: Long.fromString("42"),
      largeLong: Long.fromString("9007199254740993"),
      price: Decimal128.fromString("1234.50"),
      createdAt: new Date("2025-01-02T03:04:05.000Z"),
    };
    const source = encode(document);
    const editable = formatDocument(source, 2);

    expect(editable).toContain('ObjectId("507f1f77bcf86cd799439011")');
    expect(editable).toContain("count: 7");
    expect(editable).not.toContain("Int32(");
    expect(editable).toContain("score: 1.0");
    expect(editable).toContain("exactLong: 42");
    expect(editable).toContain("largeLong: 9007199254740993");
    expect(editable).toContain("price: 1234.50");
    expect(editable).not.toMatch(/(?:Int32|Long|Double|Decimal128)\(/);
    expect(editable).toContain('ISODate("2025-01-02T03:04:05.000Z")');
    expect(encode(decode(editable, decode(source)))).toBe(source);
    const reformatted = formatDocument(editable, 4, source);
    expect(reformatted).toContain(
      '    _id: ObjectId("507f1f77bcf86cd799439011")',
    );
    expect(encode(decode(reformatted, decode(source)))).toBe(source);
    expect(() => decode('{ _id: ObjectId("invalid") }')).toThrow();
    expect(() => decode('{ count: Int32("2147483648") }')).toThrow();
    expect(() => decode('{ count: Long("9223372036854775808") }')).toThrow();
  });

  it("keeps numeric BSON types when editing plain numbers in objects and arrays", () => {
    const original = decode(
      '{"count":{"$numberInt":"7"},"score":{"$numberDouble":"1.0"},"long":{"$numberLong":"42"},"nested":[{"price":{"$numberDecimal":"1.20"}}]}',
    );
    const edited = decode(
      "{ count: 8, score: 2, long: 43, nested: [{ price: 1.234567890123456789012345678901234 }] }",
      original,
    );
    expect(encode(edited)).toBe(
      '{"count":{"$numberInt":"8"},"score":{"$numberDouble":"2.0"},"long":{"$numberLong":"43"},"nested":[{"price":{"$numberDecimal":"1.234567890123456789012345678901234"}}]}',
    );
  });

  it("never rounds a large integer pasted as JSON or shell syntax", () => {
    for (const input of ['{"n":9007199254740993}', "{ n: 9007199254740993 }"])
      expect(encode(decode(input))).toBe(
        '{"n":{"$numberLong":"9007199254740993"}}',
      );
  });

  it.each([
    ["[2.0]", '[{"$numberDouble":"2.0"}]'],
    ["[2.0, 1]", '[{"$numberDouble":"2.0"},{"$numberInt":"1"}]'],
    [
      "[0, 1, 2.0]",
      '[{"$numberInt":"0"},{"$numberInt":"1"},{"$numberDouble":"2.0"}]',
    ],
  ])(
    "preserves the surviving BSON types after structural array edit %s",
    (text, expected) => {
      const original = [new Int32(1), new Double(2)];
      expect(encode(decode(text, original))).toBe(expected);
    },
  );

  it("preserves nested numbers and exact decimals when array objects move", () => {
    const original = [
      { name: "first", price: new Int32(1) },
      {
        name: "second",
        price: Decimal128.fromString("1.234567890123456789012345678901234"),
      },
    ];
    expect(
      encode(
        decode(
          '[{price: 1.234567890123456789012345678901234, name: "second"}]',
          original,
        ),
      ),
    ).toBe(
      '[{"price":{"$numberDecimal":"1.234567890123456789012345678901234"},"name":"second"}]',
    );
  });

  it("refuses ambiguous duplicate numeric types after deleting an array element", () => {
    const original = [new Int32(1), new Double(1)];
    expect(() => decode("[1]", original)).toThrow(/array.*Extended JSON/i);
    expect(encode(decode('[{ $numberDouble: "1.0" }]', original))).toBe(
      '[{"$numberDouble":"1.0"}]',
    );
    expect(encode(decode("[1, 1.0]", original))).toBe(
      '[{"$numberInt":"1"},{"$numberDouble":"1.0"}]',
    );
  });

  it("refuses to guess numeric types when an array is shortened and its survivor is changed", () => {
    expect(() => decode("[2.5]", [new Int32(1), new Double(2)])).toThrow(
      /array.*Extended JSON/i,
    );
  });

  it("matches exact small decimals separately from negative zero in structural arrays", () => {
    const original = [new Double(-0), Decimal128.fromString("-1E-400")];
    expect(encode(decode("[-1e-400]", original))).toBe(
      '[{"$numberDecimal":"-1E-400"}]',
    );
  });

  it("rejects edits that would overflow or lose precision in the original numeric type", () => {
    const original = decode(
      '{"count":{"$numberInt":"1"},"long":{"$numberLong":"42"},"score":{"$numberDouble":"1.0"}}',
    );
    expect(() => decode("{ count: 2147483648 }", original)).toThrow(/int32/i);
    expect(() => decode("{ long: 9223372036854775808 }", original)).toThrow(
      /int64/i,
    );
    expect(() =>
      decode("{ score: 1.000000000000000000001 }", original),
    ).toThrow(/precision/i);
    expect(
      encode(decode('{ count: { $numberLong: "2147483648" } }', original)),
    ).toBe('{"count":{"$numberLong":"2147483648"}}');
  });

  it("round-trips special numeric values without constructor labels", () => {
    const source =
      '{"negativeZero":{"$numberDouble":"-0.0"},"nan":{"$numberDouble":"NaN"},"infinite":{"$numberDouble":"Infinity"},"decimal":{"$numberDecimal":"-Infinity"}}';
    const displayed = formatDocument(source, 2);
    expect(displayed).toContain("negativeZero: -0.0");
    expect(displayed).toContain("nan: NaN");
    expect(displayed).toContain("infinite: Infinity");
    expect(displayed).not.toMatch(/(?:Double|Decimal128)\(/);
    expect(encode(decode(displayed, decode(source)))).toBe(source);
  });

  it("remembers explicit numeric type changes after formatting plain editor text", () => {
    const source = '{"n":{"$numberInt":"1"}}';
    const formatted = formatEditableDocument(
      '{ n: { $numberDecimal: "1.20" } }',
      2,
      source,
    );
    expect(formatted.value).toContain("n: 1.20");
    expect(encode(decode(formatted.value, decode(formatted.ejson)))).toBe(
      '{"n":{"$numberDecimal":"1.20"}}',
    );
    expect(encode(decode("{ n: 1.21 }", decode(formatted.ejson)))).toBe(
      '{"n":{"$numberDecimal":"1.21"}}',
    );
  });

  it("uses a diagnostic-free Mongo JSON mode for display", () => {
    expect(shellJsonLanguage).toBe("mongo-json");
  });
});
