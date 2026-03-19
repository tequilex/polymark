import { describe, expect, it } from 'vitest';

import { canCreateAlert } from '../../src/worker/alerter';

describe('alerter cooldown', () => {
  it('allows alert when there was no previous alert', () => {
    expect(canCreateAlert(null, 1_710_000_000, 6)).toBe(true);
  });

  it('blocks repeat alert inside cooldown window', () => {
    const now = 1_710_000_000;
    const lastAlertAt = now - 5 * 3600;

    expect(canCreateAlert(lastAlertAt, now, 6)).toBe(false);
  });

  it('allows repeat alert after cooldown window', () => {
    const now = 1_710_000_000;
    const lastAlertAt = now - 6 * 3600;

    expect(canCreateAlert(lastAlertAt, now, 6)).toBe(true);
  });
});
