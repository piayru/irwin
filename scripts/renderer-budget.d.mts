export function measureRendererBundle(
  directory: string,
  budget?: number,
): Promise<{
  format: string;
  version: number;
  initialJavaScriptBytes: number;
  initialCssBytes: number;
  initialJavaScriptFiles: string[];
  budgetBytes: number;
  withinBudget: boolean;
}>;
