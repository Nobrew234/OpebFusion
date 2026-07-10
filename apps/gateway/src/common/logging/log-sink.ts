import { appendFile, mkdir, rename, stat, unlink } from 'fs/promises';
import { dirname } from 'path';

/**
 * A log sink persists serialized log lines. Every method is best-effort and
 * MUST NOT throw into the request path (spec 006, "Escrita nao bloqueante"):
 *
 *  - `write` accepts a line and returns immediately; persistence is async.
 *  - `flush` resolves once everything accepted so far is durably written —
 *    used on shutdown so no already-accepted entry is lost.
 *
 * Making the sink an interface (not a hardcoded `appendFileSync`) is what lets
 * the real write path be exercised in tests via dependency injection instead
 * of a `JEST_WORKER_ID` no-op (spec 006, "Testabilidade").
 */
export interface LogSink {
  write(line: string): void;
  flush(): Promise<void>;
}

/** Discards everything. Default under Jest so tests don't touch the FS. */
export class NullLogSink implements LogSink {
  write(): void {
    /* no-op */
  }
  async flush(): Promise<void> {
    /* nothing pending */
  }
}

/** Keeps written lines in memory. For asserting on the real write path in tests. */
export class MemoryLogSink implements LogSink {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
  async flush(): Promise<void> {
    /* already in memory */
  }
  get records(): Array<Record<string, unknown>> {
    return this.lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }
}

export interface FileLogSinkOptions {
  filePath: string;
  /** Rotate once the active file would exceed this many bytes. */
  maxSizeBytes: number;
  /** How many rotated files (`.1`..`.N`) to keep; older ones are deleted. */
  maxFiles: number;
}

export const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const DEFAULT_MAX_FILES = 5;

/**
 * Append-only file sink with size-based rotation. Writes are non-blocking:
 * `write` enqueues a line and returns; a single async drain loop batches the
 * queue into `appendFile` calls, so the event loop is never parked on fsync in
 * a request path (spec 006, "Escrita nao bloqueante"). All I/O errors are
 * swallowed — a failed log write must never break the request.
 *
 * Rotation renames `gateway.log` -> `gateway.log.1` (shifting older files up
 * and dropping anything past `maxFiles`) when the active file would exceed
 * `maxSizeBytes`, bounding total disk use (spec 006, "Rotacao e retencao").
 */
export class FileLogSink implements LogSink {
  private readonly filePath: string;
  private readonly maxSizeBytes: number;
  private readonly maxFiles: number;

  private queue: string[] = [];
  private draining: Promise<void> | null = null;
  private currentSize: number | null = null; // lazily read from disk

  constructor(options: FileLogSinkOptions) {
    this.filePath = options.filePath;
    this.maxSizeBytes =
      options.maxSizeBytes > 0 ? options.maxSizeBytes : DEFAULT_MAX_SIZE_BYTES;
    this.maxFiles = options.maxFiles > 0 ? options.maxFiles : DEFAULT_MAX_FILES;
  }

  write(line: string): void {
    this.queue.push(line);
    this.ensureDraining();
  }

  async flush(): Promise<void> {
    // Await the in-flight drain and any lines enqueued while it ran, returning
    // only once nothing is queued and no drain is active. Never kicks a drain
    // when there is nothing to write, so it always terminates.
    while (this.draining || this.queue.length > 0) {
      await this.ensureDraining();
    }
  }

  /**
   * Returns the active drain promise, starting one if none is running. The
   * promise always resolves (drain swallows its own I/O errors), so awaiting it
   * is safe and never rejects into a caller.
   */
  private ensureDraining(): Promise<void> {
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null;
      });
      this.draining.catch(() => undefined);
    }
    return this.draining;
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue;
      this.queue = [];
      const data = batch.join('');
      const bytes = Buffer.byteLength(data, 'utf8');
      try {
        await this.ensureDir();
        await this.rotateIfNeeded(bytes);
        await appendFile(this.filePath, data);
        this.currentSize = (this.currentSize ?? 0) + bytes;
      } catch {
        // Best-effort: drop this batch rather than crash the process. Reset the
        // cached size so the next write re-stats instead of trusting a stale value.
        this.currentSize = null;
      }
    }
  }

  private async ensureDir(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
    } catch {
      // If the dir already exists this throws EEXIST on some platforms; ignore.
    }
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    if (this.currentSize === null) {
      this.currentSize = await this.readSize();
    }
    if (
      this.currentSize > 0 &&
      this.currentSize + incomingBytes > this.maxSizeBytes
    ) {
      await this.rotate();
      this.currentSize = 0;
    }
  }

  private async readSize(): Promise<number> {
    try {
      const info = await stat(this.filePath);
      return info.size;
    } catch {
      return 0; // file does not exist yet
    }
  }

  private async rotate(): Promise<void> {
    // Drop the oldest, then shift `.n-1 -> .n`, finally `active -> .1`.
    try {
      await unlink(`${this.filePath}.${this.maxFiles}`);
    } catch {
      /* nothing to drop */
    }
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      try {
        await rename(`${this.filePath}.${i}`, `${this.filePath}.${i + 1}`);
      } catch {
        /* that rung did not exist */
      }
    }
    try {
      await rename(this.filePath, `${this.filePath}.1`);
    } catch {
      /* active file may not exist yet */
    }
  }
}
