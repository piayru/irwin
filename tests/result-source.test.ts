import { expect, test } from "vitest";
import type { Row } from "../src/shared/contracts";
import { editableResultSource } from "../src/renderer/result-source";
const tab = { connectionId: "local", database: "initial", collection: "docs" };
const row: Row = {
  ejson: '{"_id":"same"}',
  editable: true,
  source: {
    connectionId: "local",
    database: "actual",
    collection: "other",
    identity: '{"_id":{"$eq":"same"}}',
  },
};
test("Shell edits route to the proven namespace, not the tab namespace", () => {
  expect(editableResultSource(row, tab, true)).toEqual({
    connectionId: "local",
    database: "actual",
    collection: "other",
    identity: '{"_id":{"$eq":"same"}}',
  });
});
test("collection queries cannot bypass the tab namespace check", () => {
  expect(editableResultSource(row, tab, false)).toBeUndefined();
  expect(
    editableResultSource(
      row,
      { ...tab, database: "actual", collection: "other" },
      false,
    ),
  ).toEqual(row.source);
});
test("a same-id row without editability, complete source, or matching connection stays non-editable", () => {
  for (const candidate of [
    { ...row, editable: false },
    { ...row, source: undefined },
    { ...row, source: { ...row.source!, identity: "" } },
    { ...row, source: { ...row.source!, connectionId: "different-server" } },
  ]) {
    expect(editableResultSource(candidate, tab, true)).toBeUndefined();
  }
});
