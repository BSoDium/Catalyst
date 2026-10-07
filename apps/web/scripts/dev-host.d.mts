export const LOCAL_HOSTS: string[];
export const LAN_SUFFIXES: string[];
export function resolveDevHost(env: Record<string, string | undefined>): { host: string | true; exposed: boolean };
export function devAllowedHosts(env: Record<string, string | undefined>, machineNames?: string[]): string[];
export function portFromArgs(args: string[], fallback?: number): number;
export function lanAddresses(interfaces: Record<string, { address: string; family: string | number; internal: boolean }[] | undefined>): string[];
export function isTailscaleIp(ip: string): boolean;
export function parseTailscaleStatus(json: string): { ip: string | null; dnsName: string | null } | null;
export function reachableHint(input: { port: number; exposed: boolean; content: string; lan: string[]; tailscale: { ip: string | null; dnsName: string | null } | null }): string;
