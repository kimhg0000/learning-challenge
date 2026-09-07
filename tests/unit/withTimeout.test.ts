import { describe, expect, it } from 'vitest';
import { withTimeout } from '../../src/utils/withTimeout';

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('withTimeout', () => {
  it('resolves with the wrapped promise\'s value when it settles before the deadline', async () => {
    await expect(withTimeout(delay(5, 'ok'), 200)).resolves.toBe('ok');
  });

  it('rejects with code "timeout" when the wrapped promise takes longer than the deadline', async () => {
    await expect(withTimeout(delay(200, 'too-late'), 15)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('propagates the wrapped promise\'s own rejection unchanged when it rejects before the deadline', async () => {
    const failure = new Error('boom');
    const rejecting = new Promise((_, reject) => setTimeout(() => reject(failure), 5));
    await expect(withTimeout(rejecting, 200)).rejects.toBe(failure);
  });

  it('a late settlement after the timeout has already fired does not throw an unhandled rejection or otherwise blow up', async () => {
    const late = delay(60, 'late-value');
    await expect(withTimeout(late, 15)).rejects.toMatchObject({ code: 'timeout' });
    // Let the underlying promise actually settle; nothing should observe it
    // (no unhandled rejection, no thrown error) since withTimeout() already
    // returned.
    await delay(80, undefined);
  });
});
