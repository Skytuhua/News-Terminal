import type { Page } from '@playwright/test';
export function invokeNative(page: Page, request: Record<string, unknown>): Promise<unknown>;
