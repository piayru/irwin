import { beforeAll, afterAll, test, expect } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  MongoClient,
  ObjectId,
  Int32,
  Double,
  Long,
  Decimal128,
} from "mongodb";
import { DatabaseService } from "../src/core/database";
import { ShellService } from "../src/core/shell";
import { profileSchema, querySchema } from "../src/shared/contracts";
import { encode, decode } from "../src/shared/bson";
import { EJSON } from "bson";
let server: MongoMemoryServer;
let client: MongoClient;
let shell: ShellService;
let uri: string;
const database = new DatabaseService();
let resolved: any;
beforeAll(async () => {
  if (process.env.WORKBENCH_TEST_URI) uri = process.env.WORKBENCH_TEST_URI;
  else {
    server = await MongoMemoryServer.create({
      binary: {
        version: process.env.MONGOMS_VERSION || "8.0.18",
        downloadDir: ".runtime/mongodb",
      },
      instance: { dbName: "workbench_test" },
    });
    uri = server.getUri();
  }
  client = new MongoClient(uri);
  await client.connect();
  resolved = {
    profile: profileSchema.parse({
      id: "test",
      name: "test",
      uri,
      database: "workbench_test",
    }),
    uri,
    options: { serverSelectionTimeoutMS: 5000 },
  };
  await database.connect(resolved);
  shell = new ShellService();
  await shell.open(resolved, "workbench_test");
}, 120000);
afterAll(async () => {
  await shell?.close();
  await database.closeAll();
  await client?.db("workbench_test").dropDatabase();
  await client?.close();
  await server?.stop();
});
test("find cursor pages preserve exact BSON and atomic old-value update conflicts", async () => {
  await client
    .db("workbench_test")
    .collection("docs")
    .insertMany(
      Array.from({ length: 205 }, (_, n) => ({
        n,
        long: Long.fromString("9007199254740993"),
        price: Decimal128.fromString("1.20"),
        nested: { ok: true },
        missing: null,
      })),
    );
  const q = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "docs",
    sort: '{"n":1}',
  });
  const page = await database.run(q);
  expect(page.rows).toHaveLength(100);
  expect(page.hasMore).toBe(true);
  expect(page.rows[0].ejson).toContain("9007199254740993");
  const target = {
    connectionId: "test",
    database: "workbench_test",
    collection: "docs",
    original: page.rows[0].ejson,
    field: "nested.ok",
    value: "false",
  };
  const result = await database.execute("documents.update", target);
  expect(decode(result.row.ejson).nested.ok).toBe(false);
  await expect(database.execute("documents.update", target)).rejects.toThrow(
    "Conflict",
  );
  expect((await database.next(page.cursorId)).rows).toHaveLength(100);
  const last = await database.next(page.cursorId);
  expect(last.rows).toHaveLength(5);
  expect(last.hasMore).toBe(false);
});
test("full document replace succeeds when the original document is unchanged", async () => {
  const coll = client.db("workbench_test").collection("replace_docs");
  await coll.deleteMany({});
  const replaceId = new ObjectId();
  await coll.insertOne({ _id: replaceId, name: "Ada", active: true });
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "replace_docs",
  });
  const original = (await database.run(input)).rows[0].ejson;
  const reorderedOriginal = JSON.stringify(
    Object.fromEntries(Object.entries(JSON.parse(original)).reverse()),
  );
  const result = await database.execute("documents.replace", {
    connectionId: "test",
    database: "workbench_test",
    collection: "replace_docs",
    original: reorderedOriginal,
    document: encode({ _id: replaceId, name: "Grace", active: true }),
  });
  expect(decode(result.ejson).name).toBe("Grace");
});

test("numeric shell constructors insert, replace, edit and query exact BSON values", async () => {
  const target = {
    connectionId: "test",
    database: "workbench_test",
    collection: "literal_constructor_docs",
  };
  const source = `{
    _id:ObjectId("507f1f77bcf86cd799439012"),
    n:NumberInt(-1),nested:{width:Int32(8)},
    total:NumberLong(9007199254740993),ratio:Double(1.25),
    price:NumberDecimal(1.234567890123456789012345678901234),
    createdAt:new Date(),updatedAt:new Date()
  }`;
  await database.execute("documents.insert", { ...target, document: source });
  const coll = client.db(target.database).collection(target.collection);
  const id = new ObjectId("507f1f77bcf86cd799439012");
  const inserted = await coll.findOne({ _id: id }, { promoteValues: false });
  expect(inserted!.n._bsontype).toBe("Int32");
  expect(inserted!.n.valueOf()).toBe(-1);
  expect(inserted!.nested.width._bsontype).toBe("Int32");
  expect(inserted!.total.toString()).toBe("9007199254740993");
  expect(inserted!.ratio._bsontype).toBe("Double");
  expect(inserted!.price.toString()).toBe(
    "1.234567890123456789012345678901234",
  );
  expect(inserted!.createdAt).toBeInstanceOf(Date);
  const replaced = await database.execute("documents.replace", {
    ...target,
    original: encode(inserted),
    document: source.replace("NumberInt(-1)", "new NumberInt(2)"),
  });
  const updated = await database.execute("documents.update", {
    ...target,
    original: replaced.ejson,
    field: "nested.width",
    value: "new Int32(9)",
  });
  const saved = await coll.findOne({ _id: id }, { promoteValues: false });
  expect(saved!.n._bsontype).toBe("Int32");
  expect(saved!.n.valueOf()).toBe(2);
  expect(saved!.nested.width._bsontype).toBe("Int32");
  expect(saved!.nested.width.valueOf()).toBe(9);
  expect(saved!.total._bsontype).toBe("Long");
  expect(saved!.total.toString()).toBe("9007199254740993");
  expect(saved!.price._bsontype).toBe("Decimal128");
  expect(saved!.price.toString()).toBe("1.234567890123456789012345678901234");
  expect(decode(updated.row.ejson).nested.width.valueOf()).toBe(9);
  const result = await database.run(
    querySchema.parse({
      ...target,
      filter:
        "{n:NumberInt(2),total:NumberLong(9007199254740993),ratio:Double(1.25)}",
    }),
  );
  expect(result.rows).toHaveLength(1);
});

test("refreshes the current server document by its original identity after a conflict", async () => {
  const coll = client.db("workbench_test").collection("refresh_docs");
  const id = new ObjectId();
  await coll.insertOne({ _id: id, name: "Ada", revision: 1 });
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "refresh_docs",
  });
  const original = (await database.run(input)).rows[0].ejson;
  await coll.updateOne({ _id: id }, { $set: { revision: 2 } });

  const current = await database.execute("documents.fetch", {
    connectionId: "test",
    database: "workbench_test",
    collection: "refresh_docs",
    original,
  });

  const refreshed = decode(current.ejson);
  expect(refreshed.name).toBe("Ada");
  expect(refreshed.revision.valueOf()).toBe(2);
});

test("plain JSON document edits preserve numeric BSON types and exact values on the server", async () => {
  const coll = client.db("workbench_test").collection("plain_numeric_edits");
  const id = new ObjectId("507f1f77bcf86cd799439011");
  await coll.insertOne({
    _id: id,
    count: new Int32(7),
    score: new Double(1),
    smallLong: Long.fromString("42"),
    largeLong: Long.fromString("9007199254740993"),
    nested: [{ price: Decimal128.fromString("1.20") }],
  });
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "plain_numeric_edits",
  });
  const original = (await database.run(input)).rows[0].ejson;
  const result = await database.execute("documents.replace", {
    ...input,
    original,
    document:
      '{ _id: ObjectId("507f1f77bcf86cd799439011"), count: 8, score: 2, smallLong: 43, largeLong: 9007199254740993, nested: [{ price: 1.234567890123456789012345678901234 }] }',
  });
  const stored = await coll.findOne(
    { _id: id },
    { promoteValues: false, promoteLongs: false },
  );
  expect(stored!.count._bsontype).toBe("Int32");
  expect(stored!.score._bsontype).toBe("Double");
  expect(stored!.smallLong._bsontype).toBe("Long");
  expect(stored!.smallLong.toString()).toBe("43");
  expect(stored!.largeLong.toString()).toBe("9007199254740993");
  expect(stored!.nested[0].price._bsontype).toBe("Decimal128");
  expect(stored!.nested[0].price.toString()).toBe(
    "1.234567890123456789012345678901234",
  );

  await expect(
    database.execute("documents.replace", {
      ...input,
      original: result.ejson,
      document:
        '{ _id: ObjectId("507f1f77bcf86cd799439011"), count: 2147483648 }',
    }),
  ).rejects.toThrow(/int32/i);
  const unchanged = await database.execute("documents.fetch", {
    ...input,
    original: result.ejson,
  });
  expect(unchanged.ejson).toBe(result.ejson);
});

test("plain JSON field edits preserve nested numeric BSON types and reject overflow", async () => {
  const coll = client.db("workbench_test").collection("plain_field_edits");
  const id = new ObjectId();
  await coll.insertOne({
    _id: id,
    details: {
      count: new Int32(7),
      score: new Double(1),
      smallLong: Long.fromString("42"),
      nested: [{ price: Decimal128.fromString("1.20") }],
    },
  });
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "plain_field_edits",
  });
  const original = (await database.run(input)).rows[0].ejson;
  const result = await database.execute("documents.update", {
    ...input,
    original,
    field: "details",
    value:
      "{ count: 8, score: 2, smallLong: 43, nested: [{ price: 1.234567890123456789012345678901234 }] }",
  });
  const stored = await coll.findOne(
    { _id: id },
    { promoteValues: false, promoteLongs: false },
  );
  expect(stored!.details.count._bsontype).toBe("Int32");
  expect(stored!.details.score._bsontype).toBe("Double");
  expect(stored!.details.smallLong._bsontype).toBe("Long");
  expect(stored!.details.smallLong.toString()).toBe("43");
  expect(stored!.details.nested[0].price.toString()).toBe(
    "1.234567890123456789012345678901234",
  );
  await expect(
    database.execute("documents.update", {
      ...input,
      original: result.row.ejson,
      field: "details.count",
      value: "2147483648",
    }),
  ).rejects.toThrow(/int32/i);
  expect(
    (
      await database.execute("documents.fetch", {
        ...input,
        original: result.row.ejson,
      })
    ).ejson,
  ).toBe(result.row.ejson);
});

test("structural array edits preserve BSON types through replacement and field updates", async () => {
  const coll = client.db("workbench_test").collection("numeric_array_edits");
  const id = new ObjectId();
  await coll.insertOne({ _id: id, items: [new Int32(1), new Double(2)] });
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "numeric_array_edits",
  });
  const original = (await database.run(input)).rows[0].ejson;
  const replaced = await database.execute("documents.replace", {
    ...input,
    original,
    document: `{ _id: ObjectId("${id.toHexString()}"), items: [2.0, 1] }`,
  });
  const reordered = await coll.findOne({ _id: id }, { promoteValues: false });
  expect(reordered!.items.map((item: any) => item._bsontype)).toEqual([
    "Double",
    "Int32",
  ]);
  const updated = await database.execute("documents.update", {
    ...input,
    original: replaced.ejson,
    field: "items",
    value: "[2.0]",
  });
  const shortened = await coll.findOne({ _id: id }, { promoteValues: false });
  expect(shortened!.items[0]._bsontype).toBe("Double");
  expect(shortened!.items[0].valueOf()).toBe(2);
  await expect(
    database.execute("documents.update", {
      ...input,
      original: updated.row.ejson,
      field: "items",
      value: "[3.5, 4]",
    }),
  ).rejects.toThrow(/array.*Extended JSON/i);
  expect(
    (
      await database.execute("documents.fetch", {
        ...input,
        original: updated.row.ejson,
      })
    ).ejson,
  ).toBe(updated.row.ejson);
});

test("ambiguous array edits never write inferred BSON types", async () => {
  const coll = client.db("workbench_test").collection("ambiguous_array_edits");
  const id = new ObjectId();
  await coll.insertOne({ _id: id, items: [new Int32(1), new Double(1)] });
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "ambiguous_array_edits",
  });
  const original = (await database.run(input)).rows[0].ejson;
  await expect(
    database.execute("documents.replace", {
      ...input,
      original,
      document: `{ _id: ObjectId("${id.toHexString()}"), items: [1] }`,
    }),
  ).rejects.toThrow(/array.*Extended JSON/i);
  expect(
    (await database.execute("documents.fetch", { ...input, original })).ejson,
  ).toBe(original);
  await database.execute("documents.update", {
    ...input,
    original,
    field: "items",
    value: '[{ $numberDouble: "1.0" }]',
  });
  const stored = await coll.findOne({ _id: id }, { promoteValues: false });
  expect(stored!.items.map((item: any) => item._bsontype)).toEqual(["Double"]);
});

test("count returns documents matching the current filter", async () => {
  const coll = client.db("workbench_test").collection("count_docs");
  await coll.deleteMany({});
  await coll.insertMany([
    { group: "keep", n: 1 },
    { group: "keep", n: 2 },
    { group: "skip", n: 3 },
  ]);
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "count_docs",
    filter: '{"group":"keep"}',
    sort: '{"n":1}',
    projection: '{"_id":0}',
  });
  await expect(database.execute("queries.count", input)).resolves.toBe(2);
});
test("find filters accept literal ISODate and new Date range boundaries", async () => {
  const coll = client.db("workbench_test").collection("date_range_docs");
  await coll.deleteMany({});
  await coll.insertMany([
    { label: "before", createdAt: new Date("2024-12-31T23:59:59.999Z") },
    { label: "inside", createdAt: new Date("2025-01-15T12:00:00.000Z") },
    { label: "after", createdAt: new Date("2025-02-01T00:00:00.000Z") },
  ]);
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "date_range_docs",
    filter:
      '{createdAt: {$gte: ISODate("2025-01-01T00:00:00.000Z"), $lt: new Date("2025-02-01T00:00:00.000Z")}}',
  });
  const result = await database.run(input);
  expect(result.rows.map((row) => decode(row.ejson).label)).toEqual(["inside"]);
});
test("native shell queries, cursor continuation and writes execute once", async () => {
  const coll = client.db("workbench_test").collection("shell_docs");
  await coll.insertMany(Array.from({ length: 105 }, (_, x) => ({ x })));
  const page = await shell.execute("db.shell_docs.find().sort({x:1})");
  expect(page.rows).toHaveLength(100);
  expect(page.hasMore).toBe(true);
  expect((await shell.next()).rows).toHaveLength(5);
  await shell.execute("db.shell_docs.updateOne({x:0}, {$inc:{counter:1}})");
  expect((await coll.findOne({ x: 0 }))?.counter).toBe(1);
  expect(
    (await shell.execute("db.shell_docs.find().limit(10)")).rows,
  ).toHaveLength(10);
  const bson = await shell.execute(
    '({v: NumberLong("9007199254740993"), id:ObjectId()})',
  );
  expect(bson.rows[0].ejson).toContain("$numberLong");
});

test("shell updateOne shows its write result for nested set/addToSet, no-op and unmatched updates", async () => {
  const coll = client.db("workbench_test").collection("shell_write_result_qa");
  await coll.insertOne({
    cardId: "ips-convert",
    providerConfig: { ipsConfig: { recipes: [] } },
  });
  const recipe = {
    section: "results",
    type: "flatten",
    mappings: [],
    sources: [{ source: "r8", fields: [{ to: "label", from: "r8.9" }] }],
  };
  const update = {
    $set: { "providerConfig.ipsConfig.ruleSetVersion": "healthbank-ips-v7" },
    $addToSet: { "providerConfig.ipsConfig.recipes": recipe },
  };
  const command = `db.getCollection("shell_write_result_qa").updateOne({cardId:"ips-convert"}, ${JSON.stringify(update)})`;
  const changed = await shell.execute(command);
  const stored = await coll.findOne({ cardId: "ips-convert" });
  expect(stored!.providerConfig).toEqual({
    ipsConfig: { ruleSetVersion: "healthbank-ips-v7", recipes: [recipe] },
  });
  expect(changed.rows).toHaveLength(1);
  expect(changed.rows[0].editable).toBe(false);
  expect(EJSON.parse(changed.rows[0].ejson, { relaxed: true })).toMatchObject({
    acknowledged: true,
    matchedCount: 1,
    modifiedCount: 1,
  });
  const unchanged = await shell.execute(command);
  expect(unchanged.rows).toHaveLength(1);
  expect(EJSON.parse(unchanged.rows[0].ejson, { relaxed: true })).toMatchObject(
    {
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 0,
    },
  );
  const missing = await shell.execute(
    'db.shell_write_result_qa.updateOne({cardId:"missing"}, {$set:{active:true}})',
  );
  expect(missing.rows).toHaveLength(1);
  expect(EJSON.parse(missing.rows[0].ejson, { relaxed: true })).toMatchObject({
    acknowledged: true,
    matchedCount: 0,
    modifiedCount: 0,
  });
});

test("shell insert, replace, updateMany, delete and bulk write results are visible read-only rows", async () => {
  const commands: [string, Record<string, unknown>][] = [
    ['insertOne({_id:"one",n:1})', { acknowledged: true, insertedId: "one" }],
    [
      'insertMany([{_id:"two",n:2},{_id:"three",n:3}])',
      { acknowledged: true, insertedIds: { 0: "two", 1: "three" } },
    ],
    [
      'replaceOne({_id:"one"},{n:4})',
      { acknowledged: true, matchedCount: 1, modifiedCount: 1 },
    ],
    [
      "updateMany({},{$set:{active:true}})",
      { acknowledged: true, matchedCount: 3, modifiedCount: 3 },
    ],
    ['deleteOne({_id:"one"})', { acknowledged: true, deletedCount: 1 }],
    ["deleteMany({active:true})", { acknowledged: true, deletedCount: 2 }],
    [
      'bulkWrite([{insertOne:{document:{_id:"bulk",n:1}}},{updateOne:{filter:{_id:"bulk"},update:{$inc:{n:1}}}}])',
      { insertedCount: 1, matchedCount: 1, modifiedCount: 1 },
    ],
  ];
  for (const [command, expected] of commands) {
    const response = await shell.execute(
      `db.getCollection("shell_other_write_qa").${command}`,
    );
    expect(response.rows, command).toHaveLength(1);
    expect(response.rows[0].editable).toBe(false);
    expect(
      EJSON.parse(response.rows[0].ejson, { relaxed: true }),
      command,
    ).toMatchObject(expected);
    expect(response.hasMore).toBe(false);
  }
  expect(
    await client
      .db("workbench_test")
      .collection("shell_other_write_qa")
      .findOne({ _id: "bulk" as any }),
  ).toMatchObject({ n: 2 });
});

test("Shell database context tracks use, assignment and failures without changing the original database", async () => {
  try {
    expect(await shell.execute("use shell_context_qa")).toMatchObject({
      database: "shell_context_qa",
    });
    expect(
      await shell.execute('db.probe.insertOne({_id:"other-db"})'),
    ).toMatchObject({ database: "shell_context_qa", kind: "write" });
    expect(
      await client
        .db("shell_context_qa")
        .collection("probe")
        .findOne({ _id: "other-db" as any }),
    ).not.toBeNull();
    expect(
      await client
        .db("workbench_test")
        .collection("probe")
        .findOne({ _id: "other-db" as any }),
    ).toBeNull();
    await expect(
      shell.execute(
        'db = db.getSiblingDB("shell_error_context_qa"); throw new Error("after switching")',
      ),
    ).rejects.toThrow("after switching");
    expect(shell).toHaveProperty("database", "shell_error_context_qa");
    expect(await shell.execute("db.probe.find({})")).toMatchObject({
      database: "shell_error_context_qa",
      kind: "documents",
      rows: [],
    });
  } finally {
    await shell.execute("use workbench_test");
  }
});

test("legacy bulk writes report modified counts while ordinary reads retain exact BSON types", async () => {
  const coll = client.db("workbench_test").collection("legacy_bulk_stats_qa");
  await coll.insertOne({
    _id: "one" as any,
    n: 0,
    int: new Int32(4),
    double: new Double(1),
    long: Long.fromString("9007199254740993"),
  });
  for (const ordered of [true, false]) {
    const result = await shell.execute(
      `var bulk = db.legacy_bulk_stats_qa.initialize${ordered ? "Ordered" : "Unordered"}BulkOp(); bulk.find({_id:"one"}).updateOne({$inc:{n:1}}); bulk.execute()`,
    );
    expect(EJSON.parse(result.rows[0].ejson, { relaxed: true })).toMatchObject({
      matchedCount: 1,
      modifiedCount: 1,
    });
  }
  const doc = JSON.parse(
    (await shell.execute('db.legacy_bulk_stats_qa.findOne({_id:"one"})'))
      .rows[0].ejson,
  );
  expect(doc).toMatchObject({
    n: { $numberInt: "2" },
    int: { $numberInt: "4" },
    double: { $numberDouble: "1.0" },
    long: { $numberLong: "9007199254740993" },
  });
});

test("MongoDB client bulk replies retain accurate write counters", async () => {
  const result = await shell.execute(
    'db.getMongo().bulkWrite([{namespace:"workbench_test.client_bulk_stats_qa",name:"insertOne",document:{_id:"one",n:0}},{namespace:"workbench_test.client_bulk_stats_qa",name:"updateOne",filter:{_id:"one"},update:{$inc:{n:1}}}])',
  );
  expect(result).toMatchObject({ kind: "write", hasMore: false });
  expect(EJSON.parse(result.rows[0].ejson, { relaxed: true })).toMatchObject({
    acknowledged: true,
    insertedCount: 1,
    matchedCount: 1,
    modifiedCount: 1,
  });
  expect(
    await client
      .db("workbench_test")
      .collection("client_bulk_stats_qa")
      .findOne({ _id: "one" as any }),
  ).toMatchObject({ n: 1 });
});
test("projection without identity cannot be edited", async () => {
  const page = await database.run(
    querySchema.parse({
      connectionId: "test",
      database: "workbench_test",
      collection: "docs",
      projection: '{"_id":0,"n":1}',
      limit: 1,
    }),
  );
  expect(page.rows[0].editable).toBe(false);
});

test("CAS rejects numeric type changes and scalar-to-array changes", async () => {
  const coll = client.db("workbench_test").collection("cas");
  await coll.insertOne({ _id: 1 as any, value: 42 });
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "cas",
  });
  const original = (await database.run(input)).rows[0].ejson;
  const edit = {
    connectionId: "test",
    database: "workbench_test",
    collection: "cas",
    original,
    field: "value",
    value: "7",
  };
  await coll.updateOne({}, { $set: { value: Long.fromNumber(42) } });
  await expect(database.execute("documents.update", edit)).rejects.toThrow(
    "Conflict",
  );
  await coll.updateOne({}, { $set: { value: [42] } });
  await expect(database.execute("documents.update", edit)).rejects.toThrow(
    "Conflict",
  );
  const projected = await database.run({
    ...input,
    projection: '{"value":{"$literal":7}}',
  });
  expect(projected.rows[0].editable).toBe(false);
});
