import type { ChildProcess } from 'node:child_process';

export interface NativeCommandResult {
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: string;
  stdout?: string;
  stderr?: string;
}

export interface NativeTermination {
  pid: number;
  requestedGraceful: boolean;
  forced: boolean;
  forceKilled: boolean;
  appAliveAtStart: boolean;
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  exitObservedAt?: string;
  closeRequestStartedAt?: string;
  closeRequestFinishedAt?: string;
  gracefulTimedOut?: boolean;
  forceAttemptedAt?: string;
  windows?: unknown;
  taskkill?: NativeCommandResult;
  status?: number | null;
  error?: string;
}

export interface NativeEvidence {
  checks: Array<{ passed: boolean; [key: string]: unknown }>;
  pageErrors: string[];
  consoleErrors: string[];
  fatalError?: string;
  cleanupError?: string;
  passed?: boolean;
  [key: string]: unknown;
}

export function runNativeCommand(file: string, args: string[], options?: {
  timeout?: number; env?: NodeJS.ProcessEnv;
}): Promise<NativeCommandResult>;
export function nativeCommandJson(file: string, args: string[], options?: {
  timeout?: number; env?: NodeJS.ProcessEnv;
}): Promise<unknown>;
export function ownedNativeWindows(pid: number, options?: {
  close?: boolean; python?: string;
}): Promise<Array<{ hwnd: number; pid: number; title: string; visible: boolean; closeRequested?: boolean }>>;
export function stopOwnedProcess(child: ChildProcess, options: {
  requestClose: () => Promise<unknown>;
  gracefulTimeout: number;
  forceTimeout?: number;
  force?: (child: ChildProcess, timeout: number) => Promise<NativeCommandResult>;
}): Promise<NativeTermination>;
export function disconnectNativeBrowser(browser?: { close(): Promise<unknown> }): Promise<void>;
export function releaseFailedChildHandles(child?: ChildProcess): void;
export function finalizeNativeEvidence(evidence: NativeEvidence, expectedChecks: number,
  terminations: Array<Partial<NativeTermination> | undefined>, expectedLaunches?: number): number;
