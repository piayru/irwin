import { expect, test } from "vitest";
import { documentErrorLocation } from "../src/renderer/document-error";
import { decode } from "../src/shared/bson";

test("locates the line and column reported by the real document parser", () => {
  let error = "";
  try {
    decode("{\n broken: ,\n}");
  } catch (cause) {
    error = (cause as Error).message;
  }
  expect(documentErrorLocation(error)).toEqual({ line: 2, column: 10 });
});
test.each([
  "Authentication failed",
  "line 0, column 2",
  "line 1, column 0",
  "line 9999999999999999999999, column 1",
])("does not invent a location for %s", (message) => {
  expect(documentErrorLocation(message)).toBeUndefined();
});
