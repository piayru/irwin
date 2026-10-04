import { describe, expect, it } from "vitest";
import { decode } from "../src/shared/bson";
import { editedValue, label } from "../src/renderer/result-values";

const objectId = "507f1f77bcf86cd799439011";

describe("ObjectId table values", () => {
  it("shows nested JSON values without Extended JSON numeric or ObjectId wrappers", () => {
    const displayed = label({
      owner: { $oid: objectId },
      count: { $numberInt: "7" },
      values: [{ amount: { $numberDecimal: "1.20" } }],
    });
    expect(displayed).toContain(`ObjectId("${objectId}")`);
    expect(displayed).toContain("count: 7");
    expect(displayed).toContain("amount: 1.20");
    expect(displayed).not.toMatch(/\$(?:oid|numberInt|numberDecimal)/);
  });
  it("shows ObjectId values in Mongo shell syntax", () => {
    expect(label({ $oid: objectId })).toBe(`ObjectId("${objectId}")`);
  });

  it("saves a friendly ObjectId edit as a valid BSON ObjectId", () => {
    const value = editedValue({ $oid: objectId }, `ObjectId("${objectId}")`);
    expect(decode(value).toHexString()).toBe(objectId);
  });

  it("keeps accepting a bare hex value when editing an ObjectId", () => {
    const value = editedValue({ $oid: objectId }, objectId);
    expect(decode(value).toHexString()).toBe(objectId);
  });

  it("continues to accept canonical Extended JSON when editing an ObjectId", () => {
    const value = editedValue(
      { $oid: objectId },
      JSON.stringify({ $oid: objectId }),
    );
    expect(decode(value).toHexString()).toBe(objectId);
  });

  it("rejects invalid ObjectId edits instead of saving malformed BSON", () => {
    expect(() =>
      editedValue({ $oid: objectId }, 'ObjectId("invalid")'),
    ).toThrow("ObjectId requires 24 hexadecimal characters");
  });
});
