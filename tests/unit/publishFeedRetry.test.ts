import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { publishFeedWithRetry } from '../../src/backend/firebaseBackend';

// FirebaseBackend.submitWeek() calls publishFeedPost (a Cloud Function) to
// publish the anonymous feed copy AFTER the private submission has already
// committed. This must never throw back into submitWeek() and must never be
// mistaken for a submission failure — the private submission is already a
// real, recorded piece of coursework by the time this runs. These tests
// exercise publishFeedWithRetry() directly with a fake delegate instead of
// the real Firebase Functions SDK, so they run instantly with no emulator.

describe('publishFeedWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls the delegate once and returns normally on the first try', async () => {
    const callable = vi.fn().mockResolvedValue({ feedId: 'f1', photoURL: 'https://x' });
    await publishFeedWithRetry(callable, 3);
    expect(callable).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledWith(3);
  });

  it('retries after a transient failure and succeeds without throwing', async () => {
    const callable = vi.fn().mockRejectedValueOnce(new Error('network blip')).mockResolvedValueOnce({ feedId: 'f1', photoURL: 'https://x' });
    const promise = publishFeedWithRetry(callable, 2);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(callable).toHaveBeenCalledTimes(2);
  });

  it('never throws even if every attempt fails, and stops after exactly 3 attempts by default', async () => {
    const callable = vi.fn().mockRejectedValue(new Error('permanently down'));
    const promise = publishFeedWithRetry(callable, 5);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined(); // never rejects
    expect(callable).toHaveBeenCalledTimes(3);
  });

  it('logs a console warning identifying the failed week when every attempt is exhausted', async () => {
    const warnSpy = vi.spyOn(console, 'warn');
    const callable = vi.fn().mockRejectedValue(new Error('permanently down'));
    const promise = publishFeedWithRetry(callable, 7);
    await vi.runAllTimersAsync();
    await promise;
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('week 7');
  });

  it('honors a custom attempts count', async () => {
    const callable = vi.fn().mockRejectedValue(new Error('down'));
    const promise = publishFeedWithRetry(callable, 1, 1);
    await vi.runAllTimersAsync();
    await promise;
    expect(callable).toHaveBeenCalledTimes(1);
  });
});
