import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './address-policy.js';

describe('isPublicAddress', () => {
  it.each([
    '10.0.0.1',
    '172.16.5.4',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '0.1.2.3',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a00:1',
    'fd00::1',
    'fc00::1',
    'fe80::1',
    'not-an-address',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700::1', '::ffff:8.8.8.8'])('allows %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});
