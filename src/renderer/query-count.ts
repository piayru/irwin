type CountResult =
  | { stale: true }
  | { stale: false; count: number; error?: never }
  | { stale: false; error: string; count?: never };

/** A count belongs to the inputs at the time it was requested. */
export class QueryCountRequest {
  private revision = 0;
  invalidate() {
    this.revision++;
  }
  async run(operation: () => Promise<number>): Promise<CountResult> {
    const revision = ++this.revision;
    try {
      const count = Number(await operation());
      if (!Number.isSafeInteger(count) || count < 0)
        throw new Error("The server returned an invalid document count");
      return revision === this.revision
        ? { stale: false, count }
        : { stale: true };
    } catch (error) {
      return revision === this.revision
        ? {
            stale: false,
            error: error instanceof Error ? error.message : String(error),
          }
        : { stale: true };
    }
  }
}
