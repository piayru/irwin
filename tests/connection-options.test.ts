import { describe, expect, it } from "vitest";
import { MongoClient } from "mongodb";
import { ConnectionString } from "mongodb-connection-string-url";
import { resolveConnection } from "../src/main/connection";
import { exportMongoUri } from "../src/main/connection-uri";
import { profileSchema } from "../src/shared/contracts";
import {
  effectiveConnectionOptions,
  updateConnectionOption,
} from "../src/shared/connection-options";

const profile = (overrides: Record<string, unknown> = {}) =>
  profileSchema.parse({
    id: "retry-writes-test",
    name: "Retry writes test",
    uri: "mongodb://127.0.0.1:27017",
    ...overrides,
  });

async function effectiveRetryWrites(overrides: Record<string, unknown>) {
  const route = await resolveConnection(profile(overrides), {});
  const client = new MongoClient(route.resolved.uri, route.resolved.options);
  try {
    return client.options.retryWrites;
  } finally {
    await client.close();
    route.close();
  }
}

describe("retryable write connection settings", () => {
  it.each(["retryWrites", "retrywrites", "ReTrYwRiTeS"])(
    "honors %s=false from the connection URI in the actual driver configuration",
    async (key) => {
      expect(
        await effectiveRetryWrites({
          uri: `mongodb://127.0.0.1:27017/?${key}=false`,
        }),
      ).toBe(false);
    },
  );

  it("preserves URI-enabled retryable writes when using default settings", async () => {
    expect(
      await effectiveRetryWrites({
        uri: "mongodb://127.0.0.1:27017/?retryWrites=true",
      }),
    ).toBe(true);
  });

  it("uses MongoDB and Cosmos defaults when the URI does not specify retryable writes", async () => {
    expect(await effectiveRetryWrites({})).toBe(true);
    expect(await effectiveRetryWrites({ provider: "cosmos" })).toBe(false);
  });

  it("keeps Cosmos retryable writes disabled unless explicitly enabled in connection settings", async () => {
    expect(
      await effectiveRetryWrites({
        provider: "cosmos",
        uri: "mongodb://127.0.0.1:27017/?retryWrites=true",
      }),
    ).toBe(false);
    expect(
      await effectiveRetryWrites({ provider: "cosmos", retryWrites: true }),
    ).toBe(true);
  });

  it("allows the explicit connection setting to override a URI default", async () => {
    expect(await effectiveRetryWrites({ retryWrites: false })).toBe(false);
    expect(
      await effectiveRetryWrites({
        retryWrites: false,
        uri: "mongodb://127.0.0.1:27017/?retryWrites=true",
      }),
    ).toBe(false);
    expect(
      await effectiveRetryWrites({
        retryWrites: true,
        uri: "mongodb://127.0.0.1:27017/?retryWrites=false",
      }),
    ).toBe(true);
  });

  it("keeps old profiles on automatic settings and validates an explicit override", () => {
    expect(profile({}).retryWrites).toBeUndefined();
    expect(profile({ retryWrites: false }).retryWrites).toBe(false);
    expect(profile({ retryWrites: true }).retryWrites).toBe(true);
    expect(() => profile({ retryWrites: "false" })).toThrow();
  });
});

describe("exported retryable write settings", () => {
  it("exports the explicit override without conflicting case-variant URI parameters", () => {
    const p = profile({
      retryWrites: false,
      uri: "mongodb://127.0.0.1:27017/?ReTrYwRiTeS=true&appName=KeepMe",
    });
    const uri = new ConnectionString(exportMongoUri(p, {}, false).uri);
    const retryOptions = [...uri.searchParams].filter(
      ([key]) => key.toLowerCase() === "retrywrites",
    );
    expect(retryOptions).toEqual([["retryWrites", "false"]]);
    expect(uri.searchParams.get("appName")).toBe("KeepMe");
    expect(new MongoClient(uri.toString()).options.retryWrites).toBe(false);
  });

  it("exports the Cosmos default and preserves an explicit URI choice", () => {
    const cosmosUri = exportMongoUri(
      profile({ provider: "cosmos" }),
      {},
      false,
    ).uri;
    expect(new MongoClient(cosmosUri).options.retryWrites).toBe(false);
    const cosmosWithUri = exportMongoUri(
      profile({
        provider: "cosmos",
        uri: "mongodb://127.0.0.1:27017/?retrywrites=true",
      }),
      {},
      false,
    ).uri;
    expect(new MongoClient(cosmosWithUri).options.retryWrites).toBe(false);
    const explicitUri = exportMongoUri(
      profile({ uri: "mongodb://127.0.0.1:27017/?retryWrites=false" }),
      {},
      false,
    ).uri;
    expect(new MongoClient(explicitUri).options.retryWrites).toBe(false);
  });
});

describe("effective connection URI round trip", () => {
  it("preserves literal question marks inside URI values when reading and editing options", () => {
    const original = profile({uri:"mongodb://127.0.0.1:27017/?appName=what?ever&readPreference=secondaryPreferred"});
    expect(effectiveConnectionOptions(original).readPreference.value).toBe("secondaryPreferred");
    const edited=updateConnectionOption(original,"directConnection",true);
    expect(new ConnectionString(edited.uri).searchParams.get("appName")).toBe("what?ever");
    expect(new MongoClient(edited.uri).options.readPreference.mode).toBe("secondaryPreferred");
  });
  it("rejects replica-set discovery through SSH even when it is specified only in the URI", async () => {
    await expect(
      resolveConnection(
        profile({
          uri: "mongodb://127.0.0.1:27017/?replicaSet=rs0",
          ssh: { enabled: true },
        }),
        {},
      ),
    ).rejects.toThrow("without replica-set discovery");
  });
  it("shows SSH's required direct topology instead of a conflicting URI value", () => {
    expect(
      effectiveConnectionOptions(
        profile({
          uri: "mongodb://127.0.0.1:27017/?directConnection=false",
          ssh: { enabled: true },
        }),
      ).directConnection,
    ).toEqual({ value: "true", source: "tunnel" });
  });
  it("shows URI options and makes explicit false and primary edits effective", async () => {
    const original = profile({
      uri: "mongodb://127.0.0.1:27017/?DiReCtCoNnEcTiOn=true&readPreference=secondaryPreferred&replicaSet=old&appName=KeepMe",
    });
    expect(effectiveConnectionOptions(original).directConnection).toEqual({
      value: "true",
      source: "uri",
    });
    let edited = updateConnectionOption(original, "directConnection", false);
    edited = updateConnectionOption(edited, "readPreference", "primary");
    edited = updateConnectionOption(edited, "replicaSet", "");
    const route = await resolveConnection(edited, {});
    const client = new MongoClient(route.resolved.uri, route.resolved.options);
    try {
      expect(client.options.directConnection).toBe(false);
      expect(client.options.readPreference.mode).toBe("primary");
      expect(client.options.replicaSet).toBeUndefined();
      expect(new ConnectionString(edited.uri).searchParams.get("appName")).toBe(
        "KeepMe",
      );
      expect(
        [...new ConnectionString(edited.uri).searchParams.keys()].filter(
          (key) => key.toLowerCase() === "directconnection",
        ),
      ).toEqual(["directConnection"]);
    } finally {
      await client.close();
      route.close();
    }
  });
  it("preserves distinct timeout settings and non-default write concerns", () => {
    const uri = exportMongoUri(
      profile({
        uri: "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=12000&connectTimeoutMS=8000&w=2&SSL=true",
      }),
      {},
      false,
    ).uri;
    const client = new MongoClient(uri);
    expect(client.options.serverSelectionTimeoutMS).toBe(12000);
    expect(client.options.connectTimeoutMS).toBe(8000);
    expect(client.options.writeConcern?.w).toBe(2);
    expect(client.options.tls).toBe(true);
    expect(
      [...new ConnectionString(uri).searchParams.keys()].some(
        (key) => key.toLowerCase() === "ssl",
      ),
    ).toBe(false);
  });
  it.each(["directConnection", "DiReCtCoNnEcTiOn"])(
    "preserves URI topology and read settings when exporting %s",
    async (key) => {
      const p = profile({
        uri: `mongodb://127.0.0.1:27017/?${key}=true&readPreference=secondaryPreferred&replicaSet=example&appName=KeepMe`,
      });
      const route = await resolveConnection(p, {});
      const original = new MongoClient(
        route.resolved.uri,
        route.resolved.options,
      );
      const exported = new MongoClient(exportMongoUri(p, {}, false).uri);
      try {
        expect(original.options.directConnection).toBe(true);
        expect(exported.options.directConnection).toBe(true);
        expect(exported.options.readPreference.mode).toBe("secondaryPreferred");
        expect(exported.options.replicaSet).toBe("example");
        expect(exported.options.appName).toBe("KeepMe");
      } finally {
        await original.close();
        await exported.close();
        route.close();
      }
    },
  );
});
