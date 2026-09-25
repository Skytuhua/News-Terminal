import {expect, test} from 'vitest';
import {sourceEligibleAt, sourceFailed} from '../src/model';
import type {Source} from '../src/types';
const source = (fields:Partial<Source>) => ({enabled:true, status:'Healthy', lastSuccess:null, ...fields} as Source);
test('source eligibility respects the later of backoff and host-clamped minimum interval', () => {
  expect(sourceEligibleAt(source({lastAttempt:1000, retryAt:1100, refreshMinutes:30}))).toBe(2800);
  expect(sourceEligibleAt(source({lastAttempt:1000, retryAt:5000, refreshMinutes:30}))).toBe(5000);
  expect(sourceEligibleAt(source({lastAttempt:1000, retryAt:0, refreshMinutes:1}))).toBe(1300);
  expect(sourceEligibleAt(source({lastAttempt:1000, refreshMinutes:9999}))).toBe(87400);
  expect(sourceEligibleAt(source({lastAttempt:0}))).toBe(1800);
  expect(sourceEligibleAt(source({}))).toBeUndefined();
  expect(sourceEligibleAt(source({lastAttempt:null, retryAt:0}))).toBe(0);
});
test('failure counts use host facts and never count disabled or legacy unknown sources', () => {
  expect(sourceFailed(source({failures:2}))).toBe(true);
  expect(sourceFailed(source({enabled:false, failures:2}))).toBe(false);
  expect(sourceFailed(source({failures:0, status:'Old error text'}))).toBe(false);
  expect(sourceFailed(source({status:'Unknown legacy status'}))).toBe(false);
});
