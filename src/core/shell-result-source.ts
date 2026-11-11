import { parse } from "@babel/parser";
import type { Profile, Row } from "../shared/contracts";
import { decode, encode } from "../shared/bson";
import { capabilities } from "../shared/capabilities";
import { identity } from "./policy";

type ReadSource = {
  database: string;
  collection: string;
  kind: "find" | "findOne";
  observed?: boolean;
  collectionVerified?: boolean;
};
const modifiers = new Set([
  "sort",
  "skip",
  "limit",
  "hint",
  "collation",
  "batchSize",
  "maxTimeMS",
  "comment",
  "pretty",
  "projection",
  "allowDiskUse",
]);
const optionKeys = new Set([
  "projection",
  "sort",
  "skip",
  "limit",
  "hint",
  "collation",
  "batchSize",
  "maxTimeMS",
  "comment",
  "allowDiskUse",
]);
const field = (node: any): string | undefined =>
  node?.type === "MemberExpression" &&
  !node.computed &&
  node.property.type === "Identifier"
    ? node.property.name
    : undefined;
function simpleProjection(value: any): boolean {
  return (
    value == null ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).every(
        (v) =>
          typeof v === "boolean" ||
          ((typeof v === "number" ||
            ["Int32", "Double"].includes((v as any)?._bsontype)) &&
            [0, 1].includes(Number(v))),
      ))
  );
}

/** Eligibility is deliberately narrower than valid mongosh: classification
 * never runs code, and a namespace in this AST is not itself proof of origin. */
export function classifyShellRead(
  code: string,
  database?: string,
): ReadSource | undefined {
  try {
    const ast = parse(code, {
      sourceType: "script",
      allowAwaitOutsideFunction: true,
    });
    if (ast.program.body.length !== 1 || ast.program.directives.length) return;
    const statement = ast.program.body[0];
    if (statement.type !== "ExpressionStatement") return;
    const literal = (node: any) => {
      if (!node || node.type === "SpreadElement")
        throw new Error("Not a literal");
      return decode(code.slice(node.start, node.end));
    };
    let expression: any = statement.expression;
    if (expression.type === "AwaitExpression") expression = expression.argument;
    let chained = false;
    while (expression?.type === "CallExpression") {
      const method = field(expression.callee);
      if (!method) return;
      const args = expression.arguments.map(literal);
      if (method === "find" || method === "findOne") {
        if (method === "findOne" && chained) return;
        if (args.length > 3 || !simpleProjection(args[1])) return;
        const options = args[2];
        if (
          options != null &&
          (typeof options !== "object" ||
            Array.isArray(options) ||
            Object.keys(options).some((key) => !optionKeys.has(key)) ||
            !simpleProjection(options.projection))
        )
          return;
        let collectionNode = expression.callee.object;
        let collection: string | undefined;
        if (
          collectionNode.type === "CallExpression" &&
          field(collectionNode.callee) === "getCollection" &&
          collectionNode.arguments.length === 1 &&
          collectionNode.arguments[0].type === "StringLiteral"
        ) {
          collection = collectionNode.arguments[0].value;
          collectionNode = collectionNode.callee.object;
        } else if (field(collectionNode)) {
          collection = field(collectionNode);
          collectionNode = collectionNode.object;
        } else return;
        let sourceDatabase = database;
        if (
          collectionNode.type === "CallExpression" &&
          field(collectionNode.callee) === "getSiblingDB" &&
          collectionNode.arguments.length === 1 &&
          collectionNode.arguments[0].type === "StringLiteral"
        ) {
          sourceDatabase = collectionNode.arguments[0].value;
          collectionNode = collectionNode.callee.object;
        }
        if (
          collectionNode.type !== "Identifier" ||
          collectionNode.name !== "db" ||
          !sourceDatabase ||
          !collection
        )
          return;
        return { database: sourceDatabase, collection, kind: method };
      }
      if (
        !modifiers.has(method) ||
        (method === "projection" && !simpleProjection(args[0]))
      )
        return;
      chained = true;
      expression = expression.callee.object;
    }
  } catch {
    // Legal arbitrary Shell scripts still execute, but do not earn editability.
  }
}

/** Observe only the original connection's driver, not user-supplied metadata
 * or mutable mongosh cursor namespace properties. No query is replayed. */
export class ShellResultSource {
  private read?: ReadSource;
  private documents = new WeakMap<
    object,
    { read: ReadSource; ejson: string }
  >();
  constructor(
    private profile: Profile,
    private version: string,
    private client: any,
  ) {}

  begin(code: string, database?: string) {
    this.read = classifyShellRead(code, database);
    this.documents = new WeakMap();
  }

  private matches(cursor: any, read: ReadSource) {
    return (
      cursor.client === this.client &&
      cursor.namespace?.db === read.database &&
      cursor.namespace?.collection === read.collection
    );
  }

  observe(cursor: any, database: string, collection: string) {
    const read = this.read;
    if (
      !read ||
      read.database !== database ||
      read.collection !== collection ||
      !this.matches(cursor, read)
    )
      return;
    read.observed = true;
    for (const method of ["next", "tryNext"] as const) {
      const next = cursor[method].bind(cursor);
      cursor[method] = async (...args: any[]) => {
        const doc = await next(...args);
        if (
          this.read === read &&
          this.matches(cursor, read) &&
          doc &&
          typeof doc === "object" &&
          !cursor.transform &&
          simpleProjection(cursor.findOptions?.projection)
        ) {
          this.documents.set(doc, { read, ejson: encode(doc) });
        }
        return doc;
      };
    }
  }

  async verifyCollection() {
    const read = this.read;
    if (!read?.observed) return;
    try {
      const collections = await this.client
        .db(read.database)
        .listCollections(
          { name: read.collection },
          { nameOnly: true, maxTimeMS: 5000, timeoutMS: 5000 },
        )
        .toArray();
      read.collectionVerified =
        collections.length === 1 && collections[0].type === "collection";
    } catch {
      // Views, time-series collections and unavailable metadata never earn
      // editing rights. Reading the Shell result itself remains available.
    }
  }

  row(doc: any, ejson: string): Row {
    const result: Row = {
      ejson,
      editable: false,
      reason:
        "Shell result is read-only; only original find/findOne documents with a verified source can be edited",
    };
    const observed =
      doc && typeof doc === "object" ? this.documents.get(doc) : undefined;
    if (!observed || observed.read !== this.read || observed.ejson !== ejson)
      return result;
    if (!observed.read.collectionVerified)
      return {
        ...result,
        reason:
          "Source could not be verified as a regular collection; views and time-series results are read-only",
      };
    try {
      if (this.profile.readOnly)
        throw new Error("This connection is read-only");
      const capability = capabilities(this.profile.provider, this.version);
      if (!capability.conditionalEditing)
        throw new Error(capability.conditionalEditingReason);
      const { database, collection } = observed.read;
      const documentIdentity = identity(
        doc,
        this.profile,
        database,
        collection,
      );
      return {
        ejson,
        editable: true,
        source: {
          connectionId: this.profile.id,
          database,
          collection,
          identity: encode(documentIdentity),
        },
      };
    } catch (error) {
      return { ...result, reason: (error as Error).message };
    }
  }
}
