export interface StreamingMessagePersisterOptions {
  intervalMs: number;
  persist: () => Promise<void>;
}

export class StreamingMessagePersister {
  private timer: NodeJS.Timeout | null = null;
  private persistPromise: Promise<void> | null = null;
  private pending = false;

  constructor(private readonly options: StreamingMessagePersisterOptions) {}

  schedule() {
    this.pending = true;
    if (this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.intervalMs);
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.persistPromise) {
      await this.persistPromise;
    }

    if (!this.pending) {
      return;
    }

    this.pending = false;
    this.persistPromise = this.options.persist();
    try {
      await this.persistPromise;
    } finally {
      this.persistPromise = null;
    }

    if (this.pending) {
      await this.flush();
    }
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = false;
  }
}
