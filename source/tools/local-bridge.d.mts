import type http from "node:http";
export function isPrivateIPv4(ip: unknown): boolean;
export function createLocalBridge(options?: {
  staticDir?: string;
  timeoutMs?: number;
  request?: typeof http.request;
}): { readonly origin: string; listen(port?: number): Promise<string>; close(): Promise<void> };
