import { expect, test } from "vitest";
import { date, list, compactDate } from "../src/model";
const epoch = (iso: string) => new Date(iso).getTime() / 1000;
test('compact dates distinguish today, yesterday, older, future, previous year and undated', () => {
  const now = new Date('2026-09-23T20:00:00Z');
  const format = (value: number | null) => compactDate(value, now, 'en-US', 'America/Los_Angeles');
  expect(format(epoch('2026-09-23T16:20:00Z'))).toBe('09:20 AM');
  expect(format(epoch('2026-09-22T16:20:00Z'))).toBe('yesterday');
  expect(format(epoch('2026-09-16T16:20:00Z'))).toBe('Sep 16');
  expect(format(epoch('2025-09-16T16:20:00Z'))).toBe('Sep 16, 2025');
  expect(format(epoch('2026-09-24T16:20:00Z'))).toBe('Sep 24');
  expect(format(null)).toBe('Undated');
  expect(format(NaN)).toBe('Undated');
  expect(format(1e20)).toBe('Undated');
  expect(compactDate(epoch('2026-09-22T16:20:00Z'), now, 'de-DE', 'America/Los_Angeles')).toBe('gestern');
});
test('yesterday follows local calendar days across DST, not elapsed 24-hour windows', () => {
  expect(compactDate(epoch('2026-03-08T08:30:00Z'), new Date('2026-03-09T07:15:00Z'), 'en-US', 'America/Los_Angeles')).toBe('yesterday');
  expect(compactDate(epoch('2026-11-01T07:30:00Z'), new Date('2026-11-02T08:15:00Z'), 'en-US', 'America/Los_Angeles')).toBe('yesterday');
});
test("Unix epoch is a valid publication timestamp, not an unknown date", () =>
  expect(date(0)).toBe(new Date(0).toLocaleString()));
test("missing and nonfinite publication times are explicitly unavailable", () => {
  expect(date(null)).toBe("Publication time unavailable");
  expect(date(NaN)).toBe("Publication time unavailable");
});
test("comma-separated settings omit blanks and trim values", () =>
  expect(list("science, , health ,")).toEqual(["science", "health"]));
