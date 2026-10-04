// The renderer must acknowledge the exact restart request. A missing, stale,
// destroyed, or busy renderer can never authorize quitting.
export class UpdateRestartGuard {
  private pending?: { id: string; finish(ready: boolean): void };

  request(id: string, notify: () => void, timeoutMs = 5000): Promise<boolean> {
    this.pending?.finish(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(false), timeoutMs);
      const finish = (ready: boolean) => {
        clearTimeout(timer);
        if (this.pending?.id === id) this.pending = undefined;
        resolve(ready);
      };
      this.pending = { id, finish };
      try {
        notify();
      } catch {
        finish(false);
      }
    });
  }

  acknowledge(id: string, ready: boolean): void {
    if (this.pending?.id === id) this.pending.finish(ready);
  }
}
