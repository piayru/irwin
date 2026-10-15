import { decode, encode, object } from "./bson";

export interface AggregationStageDraft {
  id: string;
  enabled: boolean;
  text: string;
}

export class AggregationStageError extends Error {
  constructor(
    public readonly stageIndex: number,
    message: string,
  ) {
    super(`Stage ${stageIndex + 1}: ${message}`);
    this.name = "AggregationStageError";
  }
}

const READ_ONLY_STAGES = new Set([
  "$match",
  "$project",
  "$group",
  "$sort",
  "$limit",
  "$skip",
  "$unwind",
  "$lookup",
  "$addFields",
  "$set",
  "$unset",
  "$count",
  "$facet",
  "$replaceRoot",
  "$replaceWith",
  "$sample",
  "$sortByCount",
  "$unionWith",
  "$graphLookup",
  "$bucket",
  "$bucketAuto",
  "$geoNear",
  "$setWindowFields",
  "$densify",
  "$fill",
  "$search",
  "$searchMeta",
  "$vectorSearch",
]);
const MINIMUM_VERSION: Record<string, [number, number]> = {
  $unionWith: [4, 4],
  $setWindowFields: [5, 0],
  $densify: [5, 1],
  $fill: [5, 3],
};
const MAX_STAGES = 50;
const MAX_BYTES = 1024 * 1024;
const MAX_NESTING = 8;

function isPlainDocument(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value as { _bsontype?: string })._bsontype
  );
}

function validatePipeline(
  pipeline: unknown,
  stageIndex: number,
  path: string,
  depth: number,
  serverVersion?: string,
): void {
  if (!Array.isArray(pipeline))
    throw new AggregationStageError(
      stageIndex,
      `${path} must be a pipeline array`,
    );
  if (depth > MAX_NESTING)
    throw new AggregationStageError(stageIndex, "Nested pipeline is too deep");
  if (pipeline.length > MAX_STAGES)
    throw new AggregationStageError(
      stageIndex,
      `Pipeline exceeds ${MAX_STAGES} stages`,
    );
  for (const [position, stage] of pipeline.entries()) {
    const location = `${path}[${position}]`;
    if (!isPlainDocument(stage))
      throw new AggregationStageError(
        stageIndex,
        `${location} must be a stage document`,
      );
    const operators = Object.keys(stage);
    if (operators.length !== 1)
      throw new AggregationStageError(
        stageIndex,
        `${location} must contain exactly one stage operator`,
      );
    const operator = operators[0];
    if (!READ_ONLY_STAGES.has(operator))
      throw new AggregationStageError(
        stageIndex,
        `${location} uses ${operator}, which is not approved for read-only aggregation`,
      );
    const minimum = MINIMUM_VERSION[operator];
    const version = serverVersion?.match(/^(\d+)\.(\d+)/);
    if (
      minimum &&
      version &&
      (+version[1] < minimum[0] ||
        (+version[1] === minimum[0] && +version[2] < minimum[1]))
    )
      throw new AggregationStageError(
        stageIndex,
        `${operator} requires MongoDB ${minimum.join(".")} or later (server ${serverVersion})`,
      );
    const value = stage[operator];
    if (
      (operator === "$lookup" || operator === "$unionWith") &&
      isPlainDocument(value) &&
      "pipeline" in value
    )
      validatePipeline(
        value.pipeline,
        stageIndex,
        `${location}.${operator}.pipeline`,
        depth + 1,
        serverVersion,
      );
    if (operator === "$facet") {
      if (!isPlainDocument(value))
        throw new AggregationStageError(
          stageIndex,
          `${location}.$facet must be a document`,
        );
      for (const [name, nested] of Object.entries(value))
        validatePipeline(
          nested,
          stageIndex,
          `${location}.$facet.${name}`,
          depth + 1,
          serverVersion,
        );
    }
  }
}

/** Compile only enabled stages. This check must also run in the database worker. */
export function compileReadOnlyPipeline(
  stages: AggregationStageDraft[],
  serverVersion?: string,
): Record<string, any>[] {
  if (stages.length > MAX_STAGES)
    throw new AggregationStageError(
      MAX_STAGES,
      `Pipeline exceeds ${MAX_STAGES} stages`,
    );
  const bytes = stages.reduce(
    (total, stage) => total + new TextEncoder().encode(stage.text).byteLength,
    0,
  );
  if (bytes > MAX_BYTES)
    throw new AggregationStageError(0, "Pipeline exceeds 1 MB of stage text");
  const compiled: Record<string, any>[] = [];
  for (const [index, stage] of stages.entries()) {
    if (!stage.enabled) continue;
    let parsed: Record<string, any>;
    try {
      parsed = object(stage.text);
    } catch (error) {
      throw new AggregationStageError(index, (error as Error).message);
    }
    validatePipeline([parsed], index, "pipeline", 0, serverVersion);
    compiled.push(parsed);
  }
  return compiled;
}

export function importPipeline(text: string): AggregationStageDraft[] {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES)
    throw new AggregationStageError(0, "Pipeline exceeds 1 MB of stage text");
  const pipeline = decode(text);
  if (!Array.isArray(pipeline))
    throw new AggregationStageError(0, "pipeline must be a pipeline array");
  const stages = pipeline.map((stage) => ({
    id: crypto.randomUUID(),
    enabled: true,
    text: encode(stage),
  }));
  compileReadOnlyPipeline(stages);
  return stages;
}

export function stageDebugPipelines(
  stages: AggregationStageDraft[],
  index: number,
) {
  if (!Number.isInteger(index) || index < 0 || index >= stages.length)
    throw new Error("Invalid stage index");
  compileReadOnlyPipeline(stages.slice(0, index + 1));
  return { before: stages.slice(0, index), after: stages.slice(0, index + 1) };
}
