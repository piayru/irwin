import { basename } from "node:path";
export function installationVersions(currentPath, previousPath) {
  const version = (path) => {
    const match = /^Irwin-(\d+\.\d+\.\d+)-win-x64\.exe$/.exec(basename(path));
    if (!match)
      throw new Error("Expected an Irwin Windows x64 installer filename");
    return match[1];
  };
  const current = version(currentPath),
    previous = previousPath ? version(previousPath) : undefined;
  if (previous) {
    const a = current.split(".").map(BigInt),
      b = previous.split(".").map(BigInt);
    const different = a.findIndex((part, i) => part !== b[i]);
    if (different < 0 || a[different] < b[different])
      throw new Error(
        "Previous installer must be strictly older than the candidate",
      );
  }
  return { current, previous };
}
