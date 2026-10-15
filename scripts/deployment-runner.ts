import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MongoClient, Long, Decimal128, ObjectId } from "mongodb";
import { ConnectionString } from "mongodb-connection-string-url";
import { DatabaseService } from "../src/core/database";
import {
  aggregationSchema,
  profileSchema,
  querySchema,
  type Profile,
} from "../src/shared/contracts";
import { decode, encode } from "../src/shared/bson";
import { resolveConnection, type Route } from "../src/main/connection";
import {
  ownedContainerId,
  publicAcceptanceReport,
  type AcceptanceCheck,
} from "./acceptance-policy";

const exec = promisify(execFile),
  runId = randomUUID(),
  directory = resolve(".runtime/deployment-acceptance");
const distro = process.env.IRWIN_WSL_DISTRO || "Ubuntu",
  image = process.env.IRWIN_TEST_MONGO_IMAGE || "mongo:8.0";
const reports: any[] = [],
  containerNames: string[] = [],
  cleanupChecks: AcceptanceCheck[] = [];
const command = async (args: string[], timeout = 120000) => {
  const executable = process.platform === "win32" ? "wsl.exe" : "docker";
  const argv =
    process.platform === "win32"
      ? ["-d", distro, "--", "docker", ...args]
      : args;
  try {
    return (
      await exec(executable, argv, {
        encoding: "utf8",
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      })
    ).stdout.trim();
  } catch {
    throw new Error(
      `Docker ${args[0]} failed; inspect the task-owned deployment before retrying`,
    );
  }
};
async function freePort() {
  const server = createServer();
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const address = server.address() as { port: number };
  await new Promise<void>((ok) => server.close(() => ok()));
  return address.port;
}
async function waitFor<T>(
  operation: () => Promise<T>,
  durationMS = 60000,
): Promise<T> {
  const started = Date.now();
  while (true) {
    try {
      return await operation();
    } catch {
      if (Date.now() - started >= durationMS)
        throw new Error("Deployment readiness timed out");
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }
}

async function verify(
  deployment: string,
  profile: Profile,
  secrets: { password?: string },
  seed: boolean,
) {
  const service = new DatabaseService(),
    checks: AcceptanceCheck[] = [],
    routes: Route[] = [];
  const db = profile.database,
    collection = "acceptance_docs";
  const target = {
    connectionId: profile.id,
    database: db,
    collection: seed ? collection : process.env.IRWIN_ACCEPTANCE_COLLECTION!,
  };
  const check = async (name: string, operation: () => Promise<unknown>) => {
    const start = performance.now();
    try {
      await operation();
      checks.push({
        name,
        status: "passed",
        durationMS: Math.round(performance.now() - start),
      });
      process.stdout.write(`PASS ${deployment}: ${name}\n`);
    } catch {
      checks.push({
        name,
        status: "failed",
        durationMS: Math.round(performance.now() - start),
      });
      process.stdout.write(`FAIL ${deployment}: ${name}\n`);
    }
  };
  let client: MongoClient | undefined;
  try {
    const route = await resolveConnection(profile, secrets);
    routes.push(route);
    await check("connect and ping", () => service.connect(route.resolved));
    if (!service.connections.has(profile.id))
      return publicAcceptanceReport({ deployment, checks });
    if (seed) {
      client = await new MongoClient(
        route.resolved.uri,
        route.resolved.options,
      ).connect();
      await check("create disposable BSON fixture and index", async () => {
        await client!
          .db(db)
          .collection(collection)
          .insertMany(
            Array.from({ length: 205 }, (_, n) => ({
              _id: new ObjectId(),
              n,
              owner: "QA",
              large: Long.fromString("9007199254740993"),
              amount: Decimal128.fromString("1.25"),
              date: new Date("2026-10-06T00:00:00Z"),
            })),
          );
        await client!.db(db).collection(collection).createIndex({ n: 1 });
      });
    }
    const query = querySchema.parse({
      ...target,
      filter: seed ? "{n:{$gte:0}}" : "{}",
      sort: seed ? "{n:1}" : "{}",
      batchSize: 100,
      maxTimeMS: 10000,
    });
    await check(
      seed
        ? "find, paging, cancellation and BSON precision"
        : "bounded read-only find",
      async () => {
        const first = await service.run(query);
        if (seed) {
          assert.equal(first.rows.length, 100);
          assert.equal(
            decode(first.rows[0].ejson).large.toString(),
            "9007199254740993",
          );
          assert.equal(decode(first.rows[0].ejson).amount.toString(), "1.25");
          const second = await service.next(first.cursorId);
          assert.equal(second.rows.length, 100);
        }
        await service.cancel(first.cursorId);
        await assert.rejects(() => service.next(first.cursorId));
      },
    );
    const pipeline = aggregationSchema.parse({
      ...target,
      stages: [
        { id: "match", enabled: true, text: "{$match:{}}" },
        { id: "limit", enabled: true, text: "{$limit:5}" },
      ],
      maxTimeMS: 10000,
    });
    await check("read-only aggregation and preview", async () => {
      const page = await service.aggregate(pipeline, "preview");
      if (seed) assert.equal(page.rows.length, 5);
      await service.cancel(page.cursorId);
    });
    await check("reproducible Explain and index metadata", async () => {
      const captured = await service.captureDiagnostic("find", query);
      assert.ok(JSON.parse(captured.plan));
      assert.ok(Array.isArray(JSON.parse(captured.indexes)));
      if (seed)
        assert.ok(
          decode(captured.indexes).some((index: any) => index.name === "n_1"),
        );
    });
    await check("nested output stage blocked", async () => {
      await assert.rejects(
        () =>
          service.aggregate({
            ...pipeline,
            stages: [
              {
                id: "unsafe",
                enabled: true,
                text: '{$unionWith:{coll:"x",pipeline:[{$out:"must_not_exist"}]}}',
              },
            ],
          }),
        /not approved/,
      );
    });
    if (seed) {
      // A separate application read-only profile uses the same disposable server.
      const readOnly = {
        ...profile,
        id: `${profile.id}-readonly`,
        readOnly: true,
        environment: "production" as const,
      };
      const roRoute = await resolveConnection(readOnly, secrets);
      routes.push(roRoute);
      await service.connect(roRoute.resolved);
      await check("production profile blocks document writes", async () => {
        await assert.rejects(
          () =>
            service.execute("documents.insert", {
              ...target,
              connectionId: readOnly.id,
              document: '{name:"blocked"}',
            }),
          /read.only/i,
        );
      });
      await check("conditional document update", async () => {
        await waitFor(async () => {
          assert.notEqual(service.get(profile.id).version, "unknown");
        });
        const page = await service.run({ ...query, filter: "{n:0}" });
        const original = page.rows[0].ejson;
        const result = await service.execute("documents.update", {
          ...target,
          original,
          field: "owner",
          value: '"Updated"',
        });
        assert.equal(decode(result.row.ejson).owner, "Updated");
        await service.cancel(page.cursorId);
      });
      await check("reconnect after disconnect", async () => {
        await service.close(profile.id);
        await service.connect(route.resolved);
        const page = await service.run({ ...query, batchSize: 1 });
        assert.equal(page.rows.length, 1);
        await service.cancel(page.cursorId);
      });
    }
    return publicAcceptanceReport({
      deployment,
      serverVersion: service.get(profile.id).version,
      checks,
    });
  } finally {
    await service.closeAll();
    await client?.close();
    routes.forEach((r) => r.close());
  }
}

try {
  await mkdir(directory, { recursive: true });
  if (process.argv.includes("--external")) {
    const uri = process.env.IRWIN_ACCEPTANCE_URI,
      database = process.env.IRWIN_ACCEPTANCE_DATABASE,
      collection = process.env.IRWIN_ACCEPTANCE_COLLECTION;
    if (!uri || !database || !collection)
      throw new Error(
        "Set IRWIN_ACCEPTANCE_URI, IRWIN_ACCEPTANCE_DATABASE and IRWIN_ACCEPTANCE_COLLECTION for read-only acceptance",
      );
    const parsed = new ConnectionString(uri),
      password = decodeURIComponent(parsed.password || "");
    parsed.password = "";
    const profile = profileSchema.parse({
      id: "external-acceptance",
      name: "External acceptance",
      uri: parsed.toString(),
      username: decodeURIComponent(parsed.username || ""),
      database,
      provider: process.env.IRWIN_ACCEPTANCE_PROVIDER || "mongodb",
      environment: "production",
      readOnly: true,
      queryTimeoutMS: 10000,
    });
    reports.push(
      await verify("external-read-only", profile, { password }, false),
    );
  } else {
    await command(["info", "--format", "{{.ServerVersion}}"]);
    await command(["image", "inspect", image]);
    for (const deployment of ["standalone", "authentication", "replica-set"]) {
      const port = await freePort(),
        name = `irwin-accept-${runId}-${deployment}`,
        password = randomBytes(20).toString("hex"),
        username = "irwin_acceptance";
      containerNames.push(name);
      const args = [
        "create",
        "--name",
        name,
        "--label",
        `dev.irwin.acceptance=${runId}`,
        "--publish",
        `127.0.0.1:${port}:${port}`,
      ];
      if (deployment === "authentication")
        args.push(
          "--env",
          `MONGO_INITDB_ROOT_USERNAME=${username}`,
          "--env",
          `MONGO_INITDB_ROOT_PASSWORD=${password}`,
        );
      args.push(image, "mongod", "--bind_ip_all", "--port", String(port));
      if (deployment === "replica-set") args.push("--replSet", "irwinqa");
      await command(args);
      await command(["start", name]);
      if (deployment === "replica-set")
        await waitFor(() =>
          command([
            "exec",
            name,
            "mongosh",
            "--port",
            String(port),
            "--quiet",
            "--eval",
            `rs.initiate({_id:"irwinqa",members:[{_id:0,host:"127.0.0.1:${port}"}]})`,
          ]),
        );
      const uri = `mongodb://127.0.0.1:${port}/?${deployment === "replica-set" ? "replicaSet=irwinqa" : "directConnection=true"}`;
      const profile = profileSchema.parse({
        id: deployment,
        name: `Acceptance ${deployment}`,
        uri,
        database: "irwin_acceptance",
        username: deployment === "authentication" ? username : "",
        authSource: "admin",
        environment: "development",
        timeoutMS: 3000,
      });
      await waitFor(async () => {
        const route = await resolveConnection(
          profile,
          deployment === "authentication" ? { password } : {},
        );
        const probe = new MongoClient(
          route.resolved.uri,
          route.resolved.options,
        );
        try {
          await probe.connect();
          await probe.db().command({ ping: 1 });
        } finally {
          await probe.close();
          route.close();
        }
      });
      reports.push(
        await verify(
          deployment,
          profile,
          deployment === "authentication" ? { password } : {},
          true,
        ),
      );
    }
  }
} catch (error) {
  process.stdout.write(
    `Acceptance stopped: ${(error as Error).message.startsWith("Set ") ? (error as Error).message : "deployment preparation failed"}\n`,
  );
  process.exitCode = 1;
} finally {
  for (const name of containerNames) {
    try {
      const raw = JSON.parse(await command(["inspect", name]))[0];
      const id = ownedContainerId(raw, runId);
      await command(["rm", "--force", "--volumes", id]);
      cleanupChecks.push({
        name: `cleanup ${name}`,
        status: "passed",
        durationMS: 0,
      });
    } catch {
      cleanupChecks.push({
        name: `cleanup ${name}`,
        status: "failed",
        durationMS: 0,
      });
      process.exitCode = 1;
    }
  }
  const report = {
    format: "irwin-deployment-acceptance",
    version: 1,
    capturedAt: new Date().toISOString(),
    os: process.platform,
    runId,
    image: process.argv.includes("--external") ? undefined : image,
    reports,
    cleanupChecks,
    pending: process.argv.includes("--external")
      ? []
      : [
          "Atlas / external TLS",
          "Azure Cosmos DB",
          "native macOS",
          "native Ubuntu",
        ],
  };
  const path = resolve(directory, `acceptance-${runId}.json`);
  await writeFile(path, JSON.stringify(report, null, 2));
  process.stdout.write(`Evidence: ${path}\n`);
  if (
    reports.length === 0 ||
    reports.some((r) =>
      r.checks.some((c: AcceptanceCheck) => c.status !== "passed"),
    )
  )
    process.exitCode = 1;
}
