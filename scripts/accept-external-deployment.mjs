// Read-only checks; the URI and namespace are supplied through environment variables.
process.argv.push("--external");
await import("./accept-deployments.mjs");
