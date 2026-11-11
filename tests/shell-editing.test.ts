import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  test,
  expect,
} from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Int32 } from "mongodb";
import { ShellService } from "../src/core/shell";
import { ShellResultSource } from "../src/core/shell-result-source";
import { DatabaseService } from "../src/core/database";
import { profileSchema } from "../src/shared/contracts";
import { encode, decode } from "../src/shared/bson";

let server: MongoMemoryServer, client: MongoClient, shell: ShellService;
const database = new DatabaseService();
let resolved: any;
beforeAll(async () => {
  server = await MongoMemoryServer.create({
    binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
  });
  client = await new MongoClient(server.getUri()).connect();
  resolved = {
    profile: profileSchema.parse({
      id: "shell-edit",
      name: "Shell editing QA",
      uri: server.getUri(),
    }),
    uri: server.getUri(),
    options: {},
  };
  await database.connect(resolved);
  for (const name of ["shell_edit_origin", "shell_edit_actual"]) {
    await client
      .db(name)
      .collection("docs")
      .insertMany(
        Array.from({ length: 105 }, (_, n) => ({
          _id: String(n) as any,
          value: new Int32(n),
          hidden: "keep",
          nested: { count: new Int32(1) },
        })),
      );
  }
}, 120000);
beforeEach(async () => {
  shell = new ShellService();
  await shell.open(resolved, "shell_edit_origin");
});
afterEach(async () => {
  await shell?.close();
});
afterAll(async () => {
  await database.closeAll();
  await client?.close();
  await server?.stop();
});

test("untransformed find pages retain their actual source and exact BSON", async () => {
  const first = await shell.execute(
    'db.getCollection("docs").find({}).sort({value:1}).skip(0).limit(105).batchSize(2)',
  );
  expect(first.rows).toHaveLength(100);
  expect(first.hasMore).toBe(true);
  for (const row of first.rows)
    expect(row).toMatchObject({
      editable: true,
      source: {
        connectionId: "shell-edit",
        database: "shell_edit_origin",
        collection: "docs",
      },
    });
  expect(first.rows[1].ejson).toContain('"$numberInt":"1"');
  const next = await shell.next();
  expect(next.rows).toHaveLength(5);
  expect(next.rows[0]).toMatchObject({
    editable: true,
    source: {
      database: "shell_edit_origin",
      collection: "docs",
      identity: '{"_id":{"$eq":"100"}}',
    },
  });
  expect(next.hasMore).toBe(false);
});

test("findOne routes conditional writes to a sibling database, never a same-id document in the initial database", async () => {
  const [row] = (
    await shell.execute(
      'await db.getSiblingDB("shell_edit_actual").getCollection("docs").findOne({_id:"1"})',
    )
  ).rows;
  expect(row.editable).toBe(true);
  expect(row.source).toMatchObject({
    connectionId: "shell-edit",
    database: "shell_edit_actual",
    collection: "docs",
  });
  const source = row.source!;
  const update = { ...source, original: row.ejson, field: "value", value: "7" };
  await database.execute("documents.update", update);
  expect(
    (
      await client
        .db("shell_edit_actual")
        .collection("docs")
        .findOne({ _id: "1" as any })
    )?.value,
  ).toBe(7);
  expect(
    (
      await client
        .db("shell_edit_origin")
        .collection("docs")
        .findOne({ _id: "1" as any })
    )?.value,
  ).toBe(1);
  await expect(database.execute("documents.update", update)).rejects.toThrow(
    /Conflict/,
  );
});

test("projected Shell documents refetch the complete source and preserve full replacement conflicts", async () => {
  const [row] = (
    await shell.execute(
      'db.getSiblingDB("shell_edit_actual").docs.findOne({_id:"2"}, {value:1})',
    )
  ).rows;
  expect(row.editable).toBe(true);
  expect(decode(row.ejson).hidden).toBeUndefined();
  const source = row.source!;
  const original = await database.execute("documents.fetch", {
    ...source,
    original: row.ejson,
  });
  const doc = decode(original.ejson);
  expect(doc.hidden).toBe("keep");
  doc.nested.count = new Int32(3);
  const replaced = await database.execute("documents.replace", {
    ...source,
    original: original.ejson,
    document: encode(doc),
  });
  expect(decode(replaced.ejson).nested.count.valueOf()).toBe(3);
  const actual = client.db("shell_edit_actual").collection("docs");
  await actual.updateOne(
    { _id: "2" as any },
    { $set: { hidden: "concurrent" } },
  );
  await expect(
    database.execute("documents.replace", {
      ...source,
      original: replaced.ejson,
      document: encode(doc),
    }),
  ).rejects.toThrow(/Conflict/);
  expect(
    (
      await client
        .db("shell_edit_origin")
        .collection("docs")
        .findOne({ _id: "2" as any })
    )?.nested.count,
  ).toBe(1);
  expect((await actual.findOne({ _id: "2" as any }))?.hidden).toBe(
    "concurrent",
  );
});

test("use context and pure field-selection projections retain their namespace", async () => {
  await shell.execute("use shell_edit_actual");
  const [row] = (
    await shell.execute(
      'db.docs.find({_id:"3"}).projection({hidden:0}).limit(1)',
    )
  ).rows;
  expect(row).toMatchObject({
    editable: true,
    source: { database: "shell_edit_actual", collection: "docs" },
  });
  expect(decode(row.ejson).hidden).toBeUndefined();
});

test.each([
  'db.docs.aggregate([{$match:{_id:"0"}}])',
  'db.docs.find({_id:"0"}).map(d=>({...d,value:99}))',
  'db.docs.find({_id:"0"}).map(d=>d)',
  'db.docs.find({_id:"0"}).toArray()',
  'const d = db.docs.findOne({_id:"0"}); d.value=99; d',
  '({ _id:"0", value:0 })',
  '[db.docs.findOne({_id:"0"})]',
  'db.docs.findOne({_id:"0"},{value:{$literal:99}})',
  'db.docs.find({_id:"0"}).projection({value:{$literal:99}})',
  'db.docs.find({_id:"0"},{_id:0,value:1})',
  'db.docs.find({_id:"0"}).returnKey()',
])(
  "transformed, fabricated or identity-incomplete results stay read-only: %s",
  async (code) => {
    const result = await shell.execute(code);
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.editable).toBe(false);
      expect(row.source).toBeUndefined();
    }
  },
);

test("prior cursor aliases and calls through another Mongo connection cannot inherit editable origins", async () => {
  await shell.execute('var prior = db.docs.find({_id:"0"});');
  expect((await shell.execute("prior")).rows[0].editable).toBe(false);
  await shell.execute(
    `db = new Mongo(${JSON.stringify(server.getUri())}).getDB("shell_edit_origin")`,
  );
  expect(
    (await shell.execute('db.docs.findOne({_id:"0"})')).rows[0].editable,
  ).toBe(false);
});

test("overridden collection methods cannot claim a different namespace or a changed document", async () => {
  await shell.execute(
    'var getOriginal = db.getCollection.bind(db); db.getCollection = name => { const coll=getOriginal(name); coll.findOne=()=>db.getSiblingDB("shell_edit_actual").getCollection(name).findOne({_id:"0"}); return coll; };',
  );
  expect(
    (await shell.execute('db.getCollection("docs").findOne({_id:"0"})')).rows[0]
      .editable,
  ).toBe(false);
  await shell.execute(
    "db.getCollection = name => { const coll=getOriginal(name); const findOriginal=coll.findOne.bind(coll); coll.findOne=async (...args)=>{const doc=await findOriginal(...args);doc.value=999;return doc;};return coll; };",
  );
  expect(
    (await shell.execute('db.getCollection("docs").findOne({_id:"0"})')).rows[0]
      .editable,
  ).toBe(false);
});

test("a driver cursor from another namespace cannot be attributed to the requested collection", async () => {
  const tracker = new ShellResultSource(resolved.profile, "unknown", client);
  tracker.begin('db.docs.findOne({_id:"0"})', "shell_edit_origin");
  const cursor = client
    .db("shell_edit_actual")
    .collection("docs")
    .find({ _id: "0" as any });
  try {
    tracker.observe(cursor, "shell_edit_origin", "docs");
    const doc = await cursor.next();
    const row = tracker.row(doc, encode(doc));
    expect(row.editable).toBe(false);
    expect(row.source).toBeUndefined();
  } finally {
    await cursor.close();
  }
});

test("find on a MongoDB view remains read-only even with an original-looking _id", async () => {
  await client.db("shell_edit_origin").createCollection("computed_view", {
    viewOn: "docs",
    pipeline: [{ $set: { value: 99 } }],
  });
  const [row] = (await shell.execute('db.computed_view.findOne({_id:"0"})'))
    .rows;
  expect(row.editable).toBe(false);
  expect(row.source).toBeUndefined();
});

test("a cursor retargeted after creation cannot retain editing rights", async () => {
  const tracker = new ShellResultSource(resolved.profile, "unknown", client);
  tracker.begin('db.docs.findOne({_id:"0"})', "shell_edit_origin");
  const cursor = client
    .db("shell_edit_origin")
    .collection("docs")
    .find({ _id: "0" as any });
  try {
    tracker.observe(cursor, "shell_edit_origin", "docs");
    await tracker.verifyCollection();
    (cursor as any).cursorNamespace = new (cursor.namespace.constructor as any)(
      "shell_edit_actual",
      "docs",
    );
    const doc = await cursor.next();
    expect(tracker.row(doc, encode(doc)).editable).toBe(false);
  } finally {
    await cursor.close();
  }
});

test("source verification retains read-only and Cosmos version/partition-key requirements", async () => {
  for (const policy of [
    {
      provider: "mongodb",
      readOnly: true,
      version: "8.0.18",
      key: "",
      editable: false,
    },
    {
      provider: "cosmos",
      readOnly: false,
      version: "unknown",
      key: "hidden",
      editable: false,
    },
    {
      provider: "cosmos",
      readOnly: false,
      version: "6.0",
      key: "hidden",
      editable: false,
    },
    {
      provider: "cosmos",
      readOnly: false,
      version: "7.0",
      key: "",
      editable: false,
    },
    {
      provider: "cosmos",
      readOnly: false,
      version: "7.0",
      key: "absent",
      editable: false,
    },
    {
      provider: "cosmos",
      readOnly: false,
      version: "7.0",
      key: "hidden",
      editable: true,
    },
  ]) {
    const profile = profileSchema.parse({
      ...resolved.profile,
      provider: policy.provider,
      readOnly: policy.readOnly,
      partitionKeys: policy.key ? { "shell_edit_origin.docs": policy.key } : {},
    });
    const tracker = new ShellResultSource(profile, policy.version, client);
    tracker.begin('db.docs.findOne({_id:"0"})', "shell_edit_origin");
    const cursor = client
      .db("shell_edit_origin")
      .collection("docs")
      .find({ _id: "0" as any });
    try {
      tracker.observe(cursor, "shell_edit_origin", "docs");
      await tracker.verifyCollection();
      const doc = await cursor.next();
      const row = tracker.row(doc, encode(doc));
      expect(row.editable, JSON.stringify(policy)).toBe(policy.editable);
      if (!policy.editable) expect(row.source).toBeUndefined();
      else
        expect(row.source?.identity).toBe(
          '{"_id":{"$eq":"0"},"hidden":{"$eq":"keep"}}',
        );
    } finally {
      await cursor.close();
    }
  }
});
