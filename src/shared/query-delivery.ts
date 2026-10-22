import { z } from "zod";
import { encode, object, normalizeFilter } from "./bson";
import {
  compileReadOnlyPipeline,
  type AggregationStageDraft,
} from "./aggregation";
import { savedQuerySchema, type SavedQuery } from "./saved-query";
import { savedPipelineSchema } from "./saved-pipeline";
import { parameterizedDocument, type QueryParameter } from "./query-parameters";

export const queryBundleSchema = z.strictObject({
  format: z.literal("irwin-query-bundle"),
  version: z.literal(1),
  name: z.string().trim().min(1).max(160),
  exportedAt: z.string().datetime(),
  queries: z.array(savedQuerySchema).max(500),
  pipelines: z.array(savedPipelineSchema).max(500),
});
export type QueryBundle = z.infer<typeof queryBundleSchema>;
export function validateSavedQuery(value: SavedQuery) {
  if (value.query.mode === "shell") {
    if (value.parameters?.length)
      throw new Error("Shell queries do not support structural parameters");
    return;
  }
  for (const key of ["filter", "sort", "projection"] as const)
    try {
      parameterizedDocument(
        key === "filter" ? normalizeFilter(value.query[key]) : value.query[key],
        value.parameters || [],
      );
    } catch (error) {
      throw new Error(`${key.toUpperCase()}: ${(error as Error).message}`);
    }
}
export function parseQueryBundle(value: unknown): QueryBundle {
  const bundle = queryBundleSchema.parse(value);
  if (
    new TextEncoder().encode(JSON.stringify(bundle)).byteLength >
    8 * 1024 * 1024
  )
    throw new Error("Query bundle exceeds 8 MB");
  bundle.queries.forEach(validateSavedQuery);
  for (const pipeline of bundle.pipelines) {
    compileReadOnlyPipeline(pipeline.stages);
    pipeline.stages
      .filter((stage) => stage.enabled)
      .forEach((stage) =>
        parameterizedDocument(stage.text, pipeline.parameters || []),
      );
  }
  return bundle;
}
export function resolveQueryParameters(
  query: SavedQuery["query"],
  definitions: QueryParameter[],
  values: Record<string, string>,
): SavedQuery["query"] {
  if (query.mode === "shell")
    throw new Error("Shell queries do not support structural parameters");
  return {
    ...query,
    filter: parameterizedDocument(
      normalizeFilter(query.filter),
      definitions,
      values,
    ),
    sort: parameterizedDocument(query.sort, definitions, values),
    projection: parameterizedDocument(query.projection, definitions, values),
  };
}
export function resolvePipelineParameters(
  stages: AggregationStageDraft[],
  definitions: QueryParameter[],
  values: Record<string, string>,
) {
  const resolved = stages.map((stage) =>
    stage.enabled
      ? {
          ...stage,
          text: parameterizedDocument(stage.text, definitions, values),
        }
      : { ...stage },
  );
  compileReadOnlyPipeline(resolved);
  return resolved;
}
export type DeliveryInput = {
  database: string;
  collection: string;
  maxTimeMS: number;
  query?: SavedQuery["query"];
  stages?: AggregationStageDraft[];
  skip?: number;
  hint?: string;
  collation?: string;
};
export function driverCode(
  input: DeliveryInput,
  language: "node" | "python",
): string {
  if (input.query?.mode === "shell")
    throw new Error("Shell scripts cannot be converted safely to driver code");
  if (!input.query && !input.stages)
    throw new Error("A query or pipeline is required");
  const data = input.stages
    ? { pipeline: compileReadOnlyPipeline(input.stages) }
    : {
        filter: object(normalizeFilter(input.query!.filter)),
        sort: object(input.query!.sort),
        projection: object(input.query!.projection),
      };
  for (const key of ["hint", "collation"] as const)
    if (input[key]?.trim()) (data as any)[key] = object(input[key]!);
  const literal = JSON.stringify(encode(data));
  const db = JSON.stringify(input.database),
    coll = JSON.stringify(input.collection);
  const timeout = Math.max(100, Math.min(3600000, Math.trunc(input.maxTimeMS)));
  const skip = Math.max(0, Math.trunc(input.skip || 0));
  const batch = input.query?.batchSize || 100;
  if (language === "node")
    return `// npm install mongodb bson\n// Set MONGODB_URI in your environment. Credentials are not included.\nimport { MongoClient } from "mongodb";\nimport { EJSON } from "bson";\n\nconst uri = process.env.MONGODB_URI;\nif (!uri) throw new Error("Set MONGODB_URI");\nconst client = new MongoClient(uri);\nconst inputs = EJSON.parse(${literal}, { relaxed: false });\ntry {\n  await client.connect();\n  const collection = client.db(${db}).collection(${coll});\n  const options = { maxTimeMS: ${timeout}, batchSize: ${batch}, ...(inputs.hint ? { hint: inputs.hint } : {}), ...(inputs.collation ? { collation: inputs.collation } : {}) };\n  const cursor = ${input.stages ? "collection.aggregate(inputs.pipeline, { ...options, allowDiskUse: false })" : `collection.find(inputs.filter, { ...options, projection: inputs.projection }).sort(inputs.sort).skip(${skip})`};\n  for await (const document of cursor) console.log(EJSON.stringify(document, { relaxed: false }));\n} finally {\n  await client.close();\n}\n`;
  return `# pip install pymongo\n# Set MONGODB_URI in your environment. Credentials are not included.\nimport os\nfrom pymongo import MongoClient\nfrom bson import json_util\n\ninputs = json_util.loads(${literal})\nwith MongoClient(os.environ["MONGODB_URI"]) as client:\n    collection = client[${db}][${coll}]\n    options = {"maxTimeMS": ${timeout}, "batchSize": ${batch}}\n    if "hint" in inputs:\n        options["hint"] = inputs["hint"]\n    if "collation" in inputs:\n        options["collation"] = inputs["collation"]\n    ${input.stages ? 'cursor = collection.aggregate(inputs["pipeline"], allowDiskUse=False, **options)' : `cursor = collection.find(inputs["filter"], inputs["projection"], max_time_ms=${timeout}, ${'**{key: value for key, value in options.items() if key in ("hint", "collation")}'}).skip(${skip}).batch_size(${batch})\n    if inputs["sort"]:\n        cursor = cursor.sort(list(inputs["sort"].items()))`}\n    for document in cursor:\n        print(json_util.dumps(document, json_options=json_util.CANONICAL_JSON_OPTIONS))\n`;
}
