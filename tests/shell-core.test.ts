import { test, expect } from "vitest";
import { ShellService } from "../src/core/shell";
import { profileSchema } from "../src/shared/contracts";
test("official mongosh evaluator preserves variables, async and BSON without a database", async () => {
  const shell = new ShellService();
  const profile = profileSchema.parse({
    id: "test",
    name: "test",
    uri: "mongodb://127.0.0.1:27017",
  });
  try {
    await shell.open({ profile, uri: profile.uri, options: {} }, "test", true);
    expect(
      (await shell.execute("let count=4; count+1")).output.join(""),
    ).toContain("5");
    expect((await shell.execute("count+=2")).output.join("")).toContain("6");
    const result = await shell.execute(
      'await Promise.resolve({ n: NumberLong("9007199254740993"), id: ObjectId("507f1f77bcf86cd799439011") })',
    );
    expect(result.rows[0].ejson).toContain("9007199254740993");
    expect(result.rows[0].ejson).toContain("$oid");
  } finally {
    await shell.close();
  }
});

test("Shell results distinguish values, commands and document results", async () => {
  const shell = new ShellService();
  const profile = profileSchema.parse({
    id: "outcomes",
    name: "QA",
    uri: "mongodb://127.0.0.1",
  });
  try {
    await shell.open({ profile, uri: profile.uri, options: {} }, "test", true);
    expect(await shell.execute("1+2")).toMatchObject({
      kind: "value",
      value: '{"$numberInt":"3"}',
      rows: [],
    });
    expect(await shell.execute('"hello"')).toMatchObject({
      kind: "value",
      value: '"hello"',
    });
    expect(await shell.execute("null")).toMatchObject({
      kind: "value",
      value: "null",
    });
    expect(await shell.execute('print("finished")')).toMatchObject({
      kind: "command",
      rows: [],
      output: ["finished"],
    });
    expect(await shell.execute("void 0")).toMatchObject({
      kind: "command",
      rows: [],
      output: [],
    });
    expect(await shell.execute("({ n: 1 })")).toMatchObject({
      kind: "documents",
    });
    expect(await shell.execute("[]")).toMatchObject({
      kind: "documents",
      rows: [],
    });
    const large = await shell.execute('"x".repeat(270000)');
    expect(large.value).toBeUndefined();
    expect(large.output[0]).toHaveLength(262144);
    expect(large.output.join(" ")).toMatch(/truncated/i);
  } finally {
    await shell.close();
  }
});
