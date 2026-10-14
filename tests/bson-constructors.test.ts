import { describe, expect, it } from "vitest";
import { decode, encode } from "../src/shared/bson";
import { formatEditableDocument } from "../src/renderer/json-format";

describe("literal BSON constructors", () => {
  it.each([
    ["NumberInt(-1)", "Int32", "-1"],
    ["Int32(+8)", "Int32", "8"],
    ["NumberInt(8.0)", "Int32", "8"],
    ["NumberInt(1e3)", "Int32", "1000"],
    ["Int32(0xff)", "Int32", "255"],
    ["NumberInt(-2147483648)", "Int32", "-2147483648"],
    ["NumberInt(2147483647)", "Int32", "2147483647"],
    ["NumberLong(9007199254740993)", "Long", "9007199254740993"],
    ["Long(-9223372036854775808)", "Long", "-9223372036854775808"],
    ["NumberLong(9223372036854775807)", "Long", "9223372036854775807"],
    ["Long(1_000)", "Long", "1000"],
    ["Double(1.25)", "Double", "1.25"],
    ["Double(1e3)", "Double", "1000"],
    [
      "NumberDecimal(1.234567890123456789012345678901234)",
      "Decimal128",
      "1.234567890123456789012345678901234",
    ],
    ["Decimal128(-0.00)", "Decimal128", "-0.00"],
    ["Decimal128(1.20)", "Decimal128", "1.20"],
    ['NumberInt("-1")', "Int32", "-1"],
    ['NumberLong("9007199254740993")', "Long", "9007199254740993"],
    ['Double("1.25")', "Double", "1.25"],
    ['NumberDecimal("1.20")', "Decimal128", "1.20"],
  ])(
    "parses %s without changing type or precision",
    (expression, type, value) => {
      for (const prefix of ["", "new "]) {
        const result = decode(`{value:${prefix}${expression}}`).value;
        expect(result._bsontype).toBe(type);
        expect(result.toString()).toBe(value);
        const restored = decode(encode({ value: result })).value;
        expect(restored._bsontype).toBe(type);
        expect(restored.toString()).toBe(value);
      }
    },
  );
  it.each(["Double", "Decimal128", "NumberDecimal"])(
    "preserves explicit special values for %s",
    (constructor) => {
      for (const value of ["NaN", "Infinity", "-Infinity"]) {
        expect(
          decode(`{value:${constructor}(${value})}`).value.toString(),
        ).toBe(value);
        expect(
          decode(`{value:new ${constructor}("${value}")}`).value.toString(),
        ).toBe(value);
      }
    },
  );
  it("preserves negative zero as Double", () => {
    expect(Object.is(decode("{value:Double(-0)}").value.valueOf(), -0)).toBe(
      true,
    );
  });
  it("formats a nested editable document without losing explicitly selected BSON types", () => {
    const input = `{
      title: "測試文件", displayOrder: NumberInt(-1),
      gridLayout: {w:NumberInt(8),h:NumberInt(20)},
      groups:[{ranges:[["001","009"]]}],
      providerConfig:{createdAt:new Date(),updatedAt:new Date()},
      createdAt:new Date(),updatedAt:new Date()
    }`;
    const before = Date.now();
    const document = decode(input);
    const after = Date.now();
    expect(document.displayOrder._bsontype).toBe("Int32");
    expect(document.gridLayout.w.valueOf()).toBe(8);
    expect(document.gridLayout.h.valueOf()).toBe(20);
    expect(document.groups[0].ranges).toEqual([["001", "009"]]);
    for (const date of [
      document.createdAt,
      document.updatedAt,
      document.providerConfig.createdAt,
      document.providerConfig.updatedAt,
    ]) {
      expect(date).toBeInstanceOf(Date);
      expect(date.valueOf()).toBeGreaterThanOrEqual(before);
      expect(date.valueOf()).toBeLessThanOrEqual(after);
    }
    const formatted = formatEditableDocument(encode(document), 2);
    expect(formatted.value).not.toMatch(/(?:NumberInt|Int32)\(/);
    expect(encode(decode(formatted.value, document))).toBe(encode(document));
  });
  it("keeps ObjectId and ISO dates strict while allowing new constructor syntax", () => {
    const doc = decode(
      '{_id:new ObjectId("507f1f77bcf86cd799439011"),createdAt:new ISODate("2025-01-02T03:04:05.000Z")}',
    );
    expect(doc._id.toHexString()).toBe("507f1f77bcf86cd799439011");
    expect(doc.createdAt.toISOString()).toBe("2025-01-02T03:04:05.000Z");
    expect(() => decode("{_id:ObjectId(123)}")).toThrow();
    expect(() => decode("{date:Date()}")).toThrow();
  });
  it.each([
    "NumberInt(2147483648)",
    "NumberInt(-2147483649)",
    "Int32(1.5)",
    "NumberLong(9223372036854775808)",
    "Long(-9223372036854775809)",
    "NumberLong(1.5)",
    "NumberInt(NaN)",
    "Long(Infinity)",
    "Double(1e309)",
    "Double(1e-400)",
    "Double(9007199254740993)",
    'Double("9007199254740993")',
    "NumberDecimal(1.2345678901234567890123456789012345)",
    "Decimal128(1e6145)",
    "NumberInt()",
    "Double(1,2)",
    "NumberInt(1+2)",
    "Long(variable)",
    "NumberDecimal(Math.random())",
    "Double(...[1])",
    "new Int32(process.exit())",
    "NumberInt({valueOf(){return 1}})",
    "new Date(Date.now())",
  ])("rejects lossy or executable input: %s", (expression) => {
    expect(() => decode(`{value:${expression}}`)).toThrow();
  });
  it("reports the failing constructor's line and column", () => {
    expect(() =>
      decode(
        "{\n  valid:NumberInt(-1),\n  invalid:NumberLong(9223372036854775808)\n}",
      ),
    ).toThrow(/line 3, column 11:/);
  });
});
