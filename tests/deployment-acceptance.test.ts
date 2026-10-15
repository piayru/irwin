import { expect, test } from "vitest";
import {
  ownedContainerId,
  publicAcceptanceReport,
} from "../scripts/acceptance-policy";
test("cleanup requires the exact task label, name prefix and full Docker identity", () => {
  const id = "a".repeat(64),
    run = "qa123";
  const container = {
    Id: id,
    Name: "/irwin-accept-qa123-standalone",
    Config: { Labels: { "dev.irwin.acceptance": run } },
  };
  expect(ownedContainerId(container, run)).toBe(id);
  expect(() =>
    ownedContainerId({ ...container, Name: "/existing-user-mongo" }, run),
  ).toThrow();
  expect(() =>
    ownedContainerId(
      { ...container, Config: { Labels: { "dev.irwin.acceptance": "other" } } },
      run,
    ),
  ).toThrow();
  expect(() => ownedContainerId({ ...container, Id: "mongo" }, run)).toThrow();
});
test("acceptance reports whitelist evidence and never include URIs, options or credentials", () => {
  const report = publicAcceptanceReport({
    deployment: "auth",
    serverVersion: "8.0.18",
    checks: [{ name: "ping", status: "passed", durationMS: 10 }],
    uri: "mongodb://alice:secret@host",
    secrets: { password: "secret" },
    options: { auth: { password: "secret" } },
    error: "mongodb://alice:secret@host",
  });
  expect(JSON.stringify(report)).not.toMatch(/secret|mongodb:\/\//);
  expect(report.checks).toEqual([
    { name: "ping", status: "passed", durationMS: 10 },
  ]);
});
