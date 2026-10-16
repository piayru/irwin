import { z } from "zod";
import { csvValue, encode, object, parseIsoDate } from "./bson";

export const parameterTypes = [
  "string",
  "int32",
  "int64",
  "double",
  "decimal",
  "boolean",
  "date",
  "objectId",
  "json",
] as const;
export const parametersSchema = z
  .array(
    z.object({
      name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
      type: z.enum(parameterTypes),
      description: z.string().max(500).default(""),
    }),
  )
  .max(30)
  .refine(
    (items) => new Set(items.map((p) => p.name)).size === items.length,
    "Parameter names must be unique",
  );
export type QueryParameter = z.infer<typeof parametersSchema>[number];

export function parameterizedDocument(
  text: string,
  definitions: QueryParameter[],
  values?: Record<string, string>,
): string {
  const params = parametersSchema.parse(definitions);
  const visit = (value: any): any => {
    if (Array.isArray(value)) return value.map(visit);
    if (
      !value ||
      typeof value !== "object" ||
      value._bsontype ||
      value instanceof Date ||
      value instanceof RegExp
    )
      return value;
    if (
      Object.keys(value).length === 1 &&
      Object.hasOwn(value, "$irwinParam")
    ) {
      const param = params.find((p) => p.name === value.$irwinParam);
      if (!param)
        throw new Error(`Undeclared parameter: ${String(value.$irwinParam)}`);
      if (!values) return value;
      if (!Object.hasOwn(values, param.name))
        throw new Error(`Missing parameter: ${param.name}`);
      try {
        if (
          param.type === "date" &&
          !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(
            values[param.name],
          )
        )
          throw new Error("Use an ISO date with Z or an explicit UTC offset");
        if (param.type === "date")
          return parseIsoDate(
            values[param.name].toUpperCase(),
            "Date parameter",
          );
        return csvValue(values[param.name], param.type);
      } catch (error) {
        throw new Error(`${param.name}: ${(error as Error).message}`);
      }
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, visit(item)]),
    );
  };
  return encode(visit(object(text)));
}
