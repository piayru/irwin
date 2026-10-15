import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

// Gate the complete static import graph, not just the named entry chunk.
// Workers and dynamic imports are deliberately measured separately by the UI benchmark.
export async function measureRendererBundle(directory, budget = 1_500_000) {
  const manifest = JSON.parse(
    await readFile(join(directory, ".vite/manifest.json"), "utf8"),
  );
  if (!manifest["index.html"]?.isEntry)
    throw new Error("Renderer entry missing from build manifest");
  const visited = new Set(),
    scripts = new Set(),
    styles = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk?.file) throw new Error(`Missing static renderer chunk: ${key}`);
    scripts.add(chunk.file);
    for (const css of chunk.css || []) styles.add(css);
    for (const dependency of chunk.imports || []) visit(dependency);
  };
  visit("index.html");
  const bytes = async (files) => {
    let total = 0;
    for (const file of files) {
      if (
        typeof file !== "string" ||
        isAbsolute(file) ||
        /(^|[/\\])\.\.([/\\]|$)/.test(file)
      )
        throw new Error("Unsafe renderer asset path");
      const info = await stat(join(directory, file));
      if (!info.isFile()) throw new Error("Renderer asset is not a file");
      total += info.size;
    }
    return total;
  };
  const initialJavaScriptBytes = await bytes(scripts);
  return {
    format: "irwin-renderer-budget",
    version: 1,
    initialJavaScriptBytes,
    initialCssBytes: await bytes(styles),
    initialJavaScriptFiles: [...scripts].sort(),
    budgetBytes: budget,
    withinBudget: initialJavaScriptBytes <= budget,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const arg = (key, fallback) => {
    const i = process.argv.indexOf(key);
    return i < 0 ? fallback : process.argv[i + 1];
  };
  const report = await measureRendererBundle(
    resolve(arg("--directory", "dist/renderer")),
    Number(arg("--budget", 1_500_000)),
  );
  if (arg("--output"))
    await writeFile(
      resolve(arg("--output")),
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(JSON.stringify(report, null, 2));
  if (!report.withinBudget) process.exitCode = 1;
}
