import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileLogSink, MemoryLogSink } from './log-sink';

describe('MemoryLogSink', () => {
  it('captures written lines and parses them back as records', async () => {
    const sink = new MemoryLogSink();
    sink.write(JSON.stringify({ a: 1 }) + '\n');
    sink.write(JSON.stringify({ b: 2 }) + '\n');
    await sink.flush();
    expect(sink.lines).toHaveLength(2);
    expect(sink.records).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('FileLogSink (spec 006 "Escrita nao bloqueante" + "Rotacao e retencao")', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'of-log-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('write() returns synchronously (does not block on disk) and persists after flush', async () => {
    const file = join(dir, 'gateway.log');
    const sink = new FileLogSink({
      filePath: file,
      maxSizeBytes: 1_000_000,
      maxFiles: 3,
    });

    // write returns void immediately; nothing is on disk synchronously yet.
    sink.write('line-one\n');
    sink.write('line-two\n');

    await sink.flush();

    const contents = readFileSync(file, 'utf8');
    expect(contents).toContain('line-one');
    expect(contents).toContain('line-two');
  });

  it('creates the parent directory if missing', async () => {
    const file = join(dir, 'nested', 'deep', 'gateway.log');
    const sink = new FileLogSink({
      filePath: file,
      maxSizeBytes: 1_000_000,
      maxFiles: 3,
    });
    sink.write('hello\n');
    await sink.flush();
    expect(existsSync(file)).toBe(true);
  });

  it('rotates the file once it would exceed maxSizeBytes', async () => {
    const file = join(dir, 'gateway.log');
    const sink = new FileLogSink({
      filePath: file,
      maxSizeBytes: 40,
      maxFiles: 3,
    });

    // Each line is 20 bytes; after two lines (40) a third triggers rotation.
    sink.write('x'.repeat(19) + '\n');
    await sink.flush();
    sink.write('y'.repeat(19) + '\n');
    await sink.flush();
    sink.write('z'.repeat(19) + '\n');
    await sink.flush();

    expect(existsSync(`${file}.1`)).toBe(true);
    // Active file now holds only the most recent line.
    expect(readFileSync(file, 'utf8')).toContain('z');
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('y');
  });

  it('keeps at most maxFiles rotated files, dropping the oldest', async () => {
    const file = join(dir, 'gateway.log');
    const sink = new FileLogSink({
      filePath: file,
      maxSizeBytes: 25,
      maxFiles: 2,
    });

    for (let i = 0; i < 6; i++) {
      sink.write(`entry-${i}`.padEnd(24, '.') + '\n');
      await sink.flush();
    }

    expect(existsSync(`${file}.1`)).toBe(true);
    expect(existsSync(`${file}.2`)).toBe(true);
    // maxFiles=2 → there is never a .3
    expect(existsSync(`${file}.3`)).toBe(false);
  });

  it('never throws from write() even if the path is unwritable', async () => {
    // Point the file at a location whose parent is a file, not a dir — writes
    // fail internally but must be swallowed (best-effort contract).
    const bogusParent = join(dir, 'iamafile');
    writeFileSync(bogusParent, 'x');
    const sink = new FileLogSink({
      filePath: join(bogusParent, 'gateway.log'),
      maxSizeBytes: 100,
      maxFiles: 2,
    });
    expect(() => sink.write('boom\n')).not.toThrow();
    await expect(sink.flush()).resolves.toBeUndefined();
  });
});
