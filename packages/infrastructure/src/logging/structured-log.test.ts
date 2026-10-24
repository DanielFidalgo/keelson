import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPool } from '../postgres/pool.js';
import { writeErrorLog } from './structured-log.js';

function captureStdout() {
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const lines = () => write.mock.calls.map(([line]) => String(line));
  return { lines };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('writeErrorLog', () => {
  it('writes one JSON line to stdout that Cloud Logging reads as an error', () => {
    const { lines } = captureStdout();

    writeErrorLog('example.failed', { monitorId: 'mon_1' });

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(/\n$/);
    expect(JSON.parse(lines()[0] ?? '')).toEqual({ severity: 'ERROR', event: 'example.failed', monitorId: 'mon_1' });
  });
});

describe('createPool', () => {
  it('reports an idle client failure as a structured error instead of crashing the process', async () => {
    const { lines } = captureStdout();
    const pool = createPool('postgres://keelson@localhost/keelson');

    pool.emit('error', new Error('connection terminated'));
    await pool.end();

    expect(JSON.parse(lines()[0] ?? '')).toEqual({ severity: 'ERROR', event: 'postgres.idle_client_failed', error: 'connection terminated' });
  });
});
