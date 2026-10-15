export type AcceptanceCheck = {
  name: string;
  status: "passed" | "failed" | "pending";
  durationMS: number;
};
export function ownedContainerId(container: any, runId: string): string {
  if (
    !/^[a-z0-9-]+$/.test(runId) ||
    !container.Name?.startsWith(`/irwin-accept-${runId}-`) ||
    container.Config?.Labels?.["dev.irwin.acceptance"] !== runId ||
    !/^[a-f0-9]{64}$/.test(container.Id)
  )
    throw new Error(
      "Refusing to clean a container not owned by this acceptance run",
    );
  return container.Id;
}
export function publicAcceptanceReport(value: any) {
  return {
    deployment: String(value.deployment),
    serverVersion: String(value.serverVersion || "unknown"),
    checks: (value.checks as AcceptanceCheck[]).map(
      ({ name, status, durationMS }) => ({ name, status, durationMS }),
    ),
  };
}
