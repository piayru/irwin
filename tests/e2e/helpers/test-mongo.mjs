// An override must point to a fresh, isolated local QA server. The runner owns
// that server's lifecycle; the default starts and stops its own temporary server.
export async function startTestMongo() {
  const uri = process.env.WORKBENCH_TEST_MONGO_URI;
  if (uri) {
    if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(uri))
      throw new Error(
        "WORKBENCH_TEST_MONGO_URI must be a local, isolated MongoDB URI without credentials or query options",
      );
    return { getUri: () => uri, stop: async () => {} };
  }
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  return MongoMemoryServer.create({
    binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
    instance: { launchTimeout: 60000 },
  });
}
