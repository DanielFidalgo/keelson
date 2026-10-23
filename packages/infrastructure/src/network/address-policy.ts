import { BlockList, isIPv4, isIPv6 } from 'node:net';

export interface TargetPolicy {
  allowPrivateAddresses: boolean;
  allowHttp: boolean;
}

export class DestinationRefusedError extends Error {
  constructor(destination: string, reason: string) {
    super(`${destination} is not a permitted destination: ${reason}`);
    this.name = 'DestinationRefusedError';
  }
}

type Range = readonly [network: string, prefixLength: number];

const IPV4_NON_PUBLIC: readonly Range[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const IPV6_NON_PUBLIC: readonly Range[] = [
  ['::', 128],
  ['::1', 128],
  // NAT64 and 6to4 carry an IPv4 address that would sidestep the IPv4 ranges above.
  ['64:ff9b::', 96],
  ['2002::', 16],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

// Cloud metadata services live here, so they stay unreachable even where private addresses are allowed.
const LINK_LOCAL: readonly Range[] = [
  ['169.254.0.0', 16],
  ['fe80::', 10],
];

function blockListOf(ranges: readonly Range[]): BlockList {
  const list = new BlockList();
  for (const [network, prefixLength] of ranges) list.addSubnet(network, prefixLength, isIPv4(network) ? 'ipv4' : 'ipv6');
  return list;
}

const nonPublic = blockListOf([...IPV4_NON_PUBLIC, ...IPV6_NON_PUBLIC]);
const linkLocal = blockListOf(LINK_LOCAL);

const IPV4_MAPPED_DOTTED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
const IPV4_MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const BYTE_MASK = 0xff;
const BITS_PER_BYTE = 8;

// IPv4-mapped IPv6 reaches the IPv4 stack, so it is judged by the embedded IPv4 address.
function unmapIpv4(address: string): string {
  const dotted = IPV4_MAPPED_DOTTED.exec(address);
  if (dotted?.[1] !== undefined) return dotted[1];
  const hex = IPV4_MAPPED_HEX.exec(address);
  if (hex?.[1] === undefined || hex[2] === undefined) return address;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return [high >> BITS_PER_BYTE, high & BYTE_MASK, low >> BITS_PER_BYTE, low & BYTE_MASK].join('.');
}

function familyOf(address: string): 'ipv4' | 'ipv6' | null {
  if (isIPv4(address)) return 'ipv4';
  return isIPv6(address) ? 'ipv6' : null;
}

export function isPublicAddress(address: string): boolean {
  return isPermittedAddress(address, { allowPrivateAddresses: false });
}

export function isPermittedAddress(address: string, policy: Pick<TargetPolicy, 'allowPrivateAddresses'>): boolean {
  const unmapped = unmapIpv4(address);
  const family = familyOf(unmapped);
  if (family === null || linkLocal.check(unmapped, family)) return false;
  return policy.allowPrivateAddresses || !nonPublic.check(unmapped, family);
}
