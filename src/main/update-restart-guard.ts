// The renderer must acknowledge the exact restart request. A missing, stale,
// destroyed, or busy renderer can never authorize quitting.
export class UpdateRestartGuard {
  private pending?: { id: string; finish(ready: boolean): void };

  request(
    id: string,
    notify: () => void,
    timeoutMs = 5000,
    isBusy: () => boolean = () => false,
  ): Promise<boolean> {
    this.pending?.finish(false);
    return new Promise((resolve) => {
      let poll: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const timer = setTimeout(() => finish(false), timeoutMs);
      const finish = (ready: boolean) => {
        if (finished) return;
        // Closing tabs can enqueue async cursor/session cleanup before their
        // renderer acknowledgement arrives. Drain it within the same deadline.
        if (ready && isBusy()) {
          if (!poll)
            poll = setTimeout(() => {
              poll = undefined;
              finish(true);
            }, 50);
          return;
        }
        finished = true;
        clearTimeout(timer);
        clearTimeout(poll);
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
