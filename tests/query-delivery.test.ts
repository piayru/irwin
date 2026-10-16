import { expect, test } from "vitest";
import { Long, ObjectId } from "bson";
import { object } from "../src/shared/bson";
import {
  resolveQueryParameters,
  resolvePipelineParameters,
  driverCode,
  parseQueryBundle,
} from "../src/shared/query-delivery";

const query = {
  mode: "find" as const,
  filter:
    '{owner:{"$irwinParam":"owner"},n:{"$irwinParam":"n"},note:"$irwinParam"}',
  sort: "{n:-1}",
  projection: "{}",
  batchSize: 50,
  code: "",
};
const parameters = [
  { name: "owner", type: "objectId" as const, description: "" },
  { name: "n", type: "int64" as const, description: "" },
];
test("parameter substitution replaces structural placeholders and preserves BSON precision", () => {
  const resolved = resolveQueryParameters(query, parameters, {
    owner: "6a4f6bffbed892721b94b460",
    n: "9007199254740993",
  });
  const value = object(resolved.filter);
  expect(value.owner).toBeInstanceOf(ObjectId);
  expect(value.n).toBeInstanceOf(Long);
  expect(value.n.toString()).toBe("9007199254740993");
  expect(value.note).toBe("$irwinParam");
  expect(() =>
    resolveQueryParameters(query, parameters, { owner: "invalid", n: "1" }),
  ).toThrow();
  expect(() =>
    resolveQueryParameters(query, parameters, {
      owner: "6a4f6bffbed892721b94b460",
    }),
  ).toThrow(/n/);
  expect(query.filter).toContain("$irwinParam");
});
test("pipeline parameters remain stage documents and cannot inject operators as text", () => {
  const stages = [
    {
      id: "one",
      enabled: true,
      text: '{$match:{name:{"$irwinParam":"name"}}}',
    },
  ];
  const result = resolvePipelineParameters(
    stages,
    [{ name: "name", type: "string", description: "" }],
    { name: '"}; db.dropDatabase(); //' },
  );
  expect(object(result[0].text).$match.name).toBe('"}; db.dropDatabase(); //');
});
test("date parameters require an explicit timezone so another teammate gets the same instant", () => {
  const query = {
    mode: "find" as const,
    filter: '{since:{$irwinParam:"since"}}',
    sort: "{}",
    projection: "{}",
    batchSize: 50,
    code: "",
  };
  const defs = [{ name: "since", type: "date" as const, description: "" }];
  const resolved = resolveQueryParameters(query, defs, {
    since: "2026-10-06T10:00:00+08:00",
  });
  expect(object(resolved.filter).since.toISOString()).toBe(
    "2026-10-06T02:00:00.000Z",
  );
  expect(() =>
    resolveQueryParameters(query, defs, { since: "2026-10-06T10:00:00" }),
  ).toThrow(/timezone|offset|ISO/);
});
test.each([
  "2026-02-29T00:00:00Z",
  "2026-02-30T00:00:00Z",
  "2026-04-31T00:00:00+08:00",
  "2024-02-30T00:00:00Z",
  "2026-10-15T24:00:00Z",
])(
  "date parameter rejects invalid calendar/clock input instead of normalizing %s",
  (since) => {
    expect(() =>
      resolveQueryParameters(
        { ...query, filter: '{since:{$irwinParam:"since"}}' },
        [{ name: "since", type: "date", description: "" }],
        { since },
      ),
    ).toThrow(/since/);
  },
);

test("date parameter retains a valid leap day and offset crossing midnight", () => {
  const resolved = resolveQueryParameters(
    { ...query, filter: '{since:{$irwinParam:"since"}}' },
    [{ name: "since", type: "date", description: "" }],
    { since: "2024-02-29T00:30:00+01:00" },
  );
  expect(object(resolved.filter).since.toISOString()).toBe(
    "2024-02-28T23:30:00.000Z",
  );
});

test("driver delivery uses environment credentials, canonical BSON and the explicit namespace", () => {
  const input = {
    database: "app",
    collection: "orders",
    query: resolveQueryParameters(query, parameters, {
      owner: "6a4f6bffbed892721b94b460",
      n: "9007199254740993",
    }),
    maxTimeMS: 30000,
  };
  const node = driverCode(input, "node");
  expect(node).toContain("process.env.MONGODB_URI");
  expect(node).toContain("EJSON.parse");
  expect(node).toContain("9007199254740993");
  expect(node).toContain("maxTimeMS");
  const python = driverCode(input, "python");
  expect(python).toContain('os.environ["MONGODB_URI"]');
  expect(python).toContain("json_util.loads");
  expect(python).toContain("9007199254740993");
  expect(() =>
    driverCode({ ...input, query: { ...query, mode: "shell" } }, "node"),
  ).toThrow(/Shell/);
});
test("query bundles reject unknown versions, executable query text and unsafe nested pipelines", () => {
  const bundle = {
    format: "irwin-query-bundle",
    version: 1,
    name: "Team",
    exportedAt: new Date().toISOString(),
    queries: [{ id: "q", name: "Daily", query, parameters }],
    pipelines: [],
  };
  expect(parseQueryBundle(bundle).queries).toHaveLength(1);
  expect(() => parseQueryBundle({ ...bundle, version: 2 })).toThrow();
  expect(() =>
    parseQueryBundle({
      ...bundle,
      queries: [
        {
          id: "q",
          name: "Bad",
          query: { ...query, filter: "db.dropDatabase()" },
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    parseQueryBundle({
      ...bundle,
      pipelines: [
        {
          id: "p",
          name: "Bad",
          updatedAt: new Date().toISOString(),
          stages: [
            {
              id: "s",
              enabled: true,
              text: '{$unionWith:{coll:"x",pipeline:[{$out:"x"}]}}',
            },
          ],
        },
      ],
    }),
  ).toThrow();
});
