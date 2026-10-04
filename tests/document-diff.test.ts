import { describe, expect, it } from "vitest";
import { documentChanges } from "../src/renderer/document-diff";

describe("document changes", () => {
  it("reports added, removed and nested changed values for an edited document", () => {
    expect(
      documentChanges(
        '{"name":"Ada","meta":{"active":true},"old":1}',
        '{"name":"Grace","meta":{"active":false},"new":2}',
      ),
    ).toEqual([
      { path: "meta.active", kind: "changed", before: "true", after: "false" },
      { path: "name", kind: "changed", before: '"Ada"', after: '"Grace"' },
      { path: "new", kind: "added", after: "2" },
      { path: "old", kind: "removed", before: "1" },
    ]);
  });

  it("compares canonical Extended JSON with the friendly editor syntax by BSON type", () => {
    expect(
      documentChanges(
        '{"_id":{"$oid":"507f1f77bcf86cd799439011"},"count":{"$numberInt":"1"}}',
        '{ _id: ObjectId("507f1f77bcf86cd799439011"), count: Int32("1") }',
      ),
    ).toEqual([]);

    expect(
      documentChanges(
        '{"count":{"$numberDouble":"1.0"}}',
        '{ count: Int32("1") }',
      ),
    ).toEqual([
      {
        path: "count",
        kind: "changed",
        before: "1.0",
        after: "1",
      },
    ]);
  });

  it("compares plain editor numbers using the original BSON numeric types", () => {
    expect(
      documentChanges(
        '{"count":{"$numberDouble":"1.0"},"price":{"$numberDecimal":"1.20"}}',
        "{ count: 1.0, price: 1.20 }",
      ),
    ).toEqual([]);
    expect(
      documentChanges('{"price":{"$numberDecimal":"1.20"}}', "{ price: 1.21 }"),
    ).toEqual([
      { path: "price", kind: "changed", before: "1.20", after: "1.21" },
    ]);
  });

  it("detects an explicit BSON numeric type change even when the displayed values match", () => {
    expect(
      documentChanges(
        '{"price":{"$numberDouble":"1.2"}}',
        '{ price: { $numberDecimal: "1.2" } }',
      ),
    ).toEqual([
      { path: "price", kind: "changed", before: "1.2", after: "1.2" },
    ]);
  });

  it("reviews a formatted explicit type change against the original server snapshot", () => {
    expect(
      documentChanges(
        '{"price":{"$numberDouble":"1.2"}}',
        "{ price: 1.2 }",
        '{"price":{"$numberDecimal":"1.2"}}',
      ),
    ).toEqual([
      { path: "price", kind: "changed", before: "1.2", after: "1.2" },
    ]);
  });
});
