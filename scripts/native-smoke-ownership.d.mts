import type { ChildProcess } from 'node:child_process';
interface NativeProcessRecord { pid: number; parentPid: number; createdAt: string; executable?: string }
export interface NativeEndpointSnapshot {
  root: NativeProcessRecord | null;
  listener: { pid: number; addresses: string[]; ancestors: NativeProcessRecord[] } | null;
}
export interface NativeEndpointIdentity { rootCreatedAt: string; listenerPid: number; listenerCreatedAt: string }
export function assertNativeEndpointSnapshot(snapshot: NativeEndpointSnapshot, expected: {
  pid: number; parentPid: number; executable: string; rootCreatedAt?: string; listenerPid?: number; listenerCreatedAt?: string;
}): NativeEndpointIdentity;
export function assertOwnedNativeEndpoint(child: ChildProcess, options: {
  port: number; executable: string; rootCreatedAt?: string; listenerPid?: number; listenerCreatedAt?: string;
  probe?: (file: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number }) => Promise<unknown>;
}): Promise<NativeEndpointIdentity>;
