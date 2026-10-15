import { z } from "zod";
import { compileReadOnlyPipeline } from "./aggregation";
import { object } from "./bson";

const documentText = z.string().max(1024 * 1024);
const options = {
  maxTimeMS: z.number().int().min(100).max(3600000),
  hint: documentText.default(""),
  collation: documentText.default(""),
};
export const explainInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("find"),
    filter: documentText,
    sort: documentText,
    projection: documentText,
    skip: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    ...options,
  }),
  z.strictObject({
    kind: z.literal("aggregation"),
    stages: z
      .array(
        z.object({
          id: z.string().min(1).max(128),
          enabled: z.boolean(),
          text: documentText,
        }),
      )
      .max(50),
    ...options,
  }),
]);
export const explainRecordSchema = z.strictObject({
  format: z.literal("irwin-explain-record"),
  version: z.literal(1),
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(160),
  capturedAt: z.string().datetime(),
  appVersion: z.string().max(64),
  source: z.strictObject({
    connectionName: z.string().max(255),
    database: z.string().min(1).max(255),
    collection: z.string().min(1).max(255),
    environment: z.enum(["local", "development", "staging", "production"]),
    provider: z.enum(["mongodb", "cosmos"]),
  }),
  serverVersion: z.string().max(64),
  durationMS: z.number().nonnegative(),
  warnings: z.array(z.string().max(1000)).max(20),
  indexes: documentText,
  plan: z.string().max(8 * 1024 * 1024),
  input: explainInputSchema,
});
export type ExplainRecord = z.infer<typeof explainRecordSchema>;
export function parseExplainRecord(value: unknown): ExplainRecord {
  const record = explainRecordSchema.parse(value);
  if (
    new TextEncoder().encode(JSON.stringify(record)).byteLength >
    8 * 1024 * 1024
  )
    throw new Error("Explain record exceeds 8 MB");
  const plan = JSON.parse(record.plan);
  if (!plan || typeof plan !== "object" || Array.isArray(plan))
    throw new Error("Explain plan must be a document");
  if (!Array.isArray(JSON.parse(record.indexes)))
    throw new Error("Indexes must be an array");
  if (record.input.kind === "find")
    for (const key of ["filter", "sort", "projection"] as const)
      object(record.input[key]);
  else compileReadOnlyPipeline(record.input.stages);
  for (const key of ["hint", "collation"] as const)
    if (record.input[key].trim()) object(record.input[key]);
  return record;
}
export function explainComparisonWarnings(
  a: ExplainRecord,
  b: ExplainRecord,
): string[] {
  const warnings: string[] = [];
  if (
    a.source.database !== b.source.database ||
    a.source.collection !== b.source.collection ||
    a.source.connectionName !== b.source.connectionName ||
    a.source.environment !== b.source.environment
  )
    warnings.push("Different connection, environment or namespace");
  if (
    a.source.provider !== b.source.provider ||
    a.serverVersion !== b.serverVersion
  )
    warnings.push("Different provider or server version");
  if (a.input.kind !== b.input.kind) warnings.push("Different query types");
  if (a.indexes !== b.indexes) warnings.push("Index definitions changed");
  return warnings;
}
