import { z } from "zod";

export const paletteFields = [
  ["background", "--bg", "工作區背景", "Workspace background", "workspace"],
  ["panel", "--panel", "面板背景", "Panel background", "workspace"],
  ["sidebar", "--sidebar-background", "側邊欄", "Sidebar", "workspace"],
  ["header", "--header-background", "頂部工具列", "Top toolbar", "workspace"],
  [
    "raised",
    "--raised",
    "按鈕與浮層",
    "Buttons and raised surfaces",
    "workspace",
  ],
  ["input", "--input", "輸入框背景", "Input background", "workspace"],
  ["border", "--border", "邊框", "Borders", "workspace"],
  [
    "tableBackground",
    "--table-background",
    "資料表背景",
    "Table background",
    "data",
  ],
  [
    "tableHeader",
    "--table-header",
    "欄位標頭背景",
    "Column header background",
    "data",
  ],
  ["tableText", "--table-text", "資料表一般文字", "Table default text", "data"],
  [
    "tableHeaderText",
    "--table-header-text",
    "欄位標頭文字",
    "Column header text",
    "data",
  ],
  ["selection", "--accent-soft", "選取背景", "Selection background", "data"],
  ["string", "--bson-string", "字串", "String", "data"],
  ["number", "--bson-number", "數字", "Number", "data"],
  ["objectId", "--bson-object-id", "ObjectId", "ObjectId", "data"],
  ["boolean", "--bson-boolean", "布林值", "Boolean", "data"],
  ["null", "--bson-null", "空值與缺少欄位", "Null and missing fields", "data"],
  ["text", "--text", "主要文字", "Primary text", "interface"],
  ["muted", "--muted", "次要文字", "Secondary text", "interface"],
  ["accent", "--accent", "強調色", "Accent", "interface"],
  ["positive", "--positive", "成功狀態", "Success", "interface"],
  ["danger", "--danger", "錯誤狀態", "Error", "interface"],
] as const;
export type PaletteKey = (typeof paletteFields)[number][0];
export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);
export const paletteOverrideSchema = z.strictObject(
  Object.fromEntries(
    paletteFields.map(([key]) => [key, hexColorSchema.optional()]),
  ) as Record<PaletteKey, z.ZodOptional<typeof hexColorSchema>>,
);
export const themeOverridesSchema = z
  .partialRecord(
    z.enum([
      "dark",
      "light",
      "azure",
      "forest",
      "midnight",
      "graphite",
      "lavender",
      "paper",
    ]),
    paletteOverrideSchema,
  )
  .default({});

const common = {
  fontFamily: z.string().trim().min(1).max(160).optional(),
  fontSize: z.number().int().min(10).max(24).optional(),
  lineHeight: z.number().int().min(14).max(48).optional(),
};
const padding = {
  paddingX: z.number().int().min(0).max(32).optional(),
  paddingY: z.number().int().min(0).max(16).optional(),
};
export const viewSettingsSchema = z
  .strictObject({
    table: z.strictObject({ ...common, ...padding }).default({}),
    tree: z
      .strictObject({
        ...common,
        ...padding,
        indent: z.number().int().min(8).max(40).optional(),
      })
      .default({}),
    json: z
      .strictObject({
        ...common,
        padding: z.number().int().min(0).max(40).optional(),
        tabWidth: z
          .union([z.literal(2), z.literal(4), z.literal(8)])
          .optional(),
      })
      .default({}),
  })
  .default({ table: {}, tree: {}, json: {} });
