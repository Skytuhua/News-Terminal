import { expect, test } from "vitest";
import { filterArticles, relatedCounts, reconcileArticles } from "../src/model";
import { coalescedRead } from '../src/coalescedRead';

test('equivalent readbacks retain article identity; changed state is authoritative', () => {
  const previous = [{id:'a', read:false, topics:['science']}, {id:'b', read:false}];
  const same = structuredClone(previous);
  expect(reconcileArticles(previous as any, same as any)).toBe(previous);
  same[1].read = true;
  const updated = reconcileArticles(previous as any, same as any);
  expect(updated[0]).toBe(previous[0]);
  expect(updated[1].read).toBe(true);
});
test('coalesced reads share a batch and newer requests get one authoritative follow-up', async () => {
  const releases: (() => void)[] = [];
  let reads = 0;
  const read = coalescedRead(async () => { reads++; await new Promise<void>(resolve => releases.push(resolve)); });
  const a = read(false), b = read(false);
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(reads).toBe(1);
  const c = read(false), d = read(true);
  releases.shift()!();
  await Promise.all([a,b]);
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(reads).toBe(2);
  releases.shift()!();
  await Promise.all([c,d]);
});
test("related coverage counts the entire accepted cache, including hidden and filtered members", () => {
  const rows = [{ groupId: "moon", hidden: false }, { groupId: "moon", hidden: true }, { groupId: "chips", hidden: false }];
  expect([...relatedCounts(rows as any)]).toEqual([["moon", 2], ["chips", 1]]);
});
test("brief uses stable previous visit and excludes hidden articles", () => {
  const rows = [
    { id: "old", firstSeen: 10, hidden: false },
    { id: "new", firstSeen: 30, hidden: false },
    { id: "hidden", firstSeen: 40, hidden: true },
  ];
  expect(
    filterArticles(
      rows as any,
      { mode: "brief", topic: "", query: "" } as any,
      20,
      undefined,
    ).map((a) => a.id),
  ).toEqual(["new"]);
});

test("new tabs default to the AI focus section while old tabs remain valid", () => {
  const rows = [
    { id: "model", hidden: false, topics: ["technology"], sections: ["ai"] },
    { id: "policy", hidden: false, topics: ["politics"], sections: ["others"] },
  ];
  expect(filterArticles(rows as any, { mode: "all", topic: "politics", query: "" } as any, 0).map((a) => a.id)).toEqual(["policy"]);
  expect(filterArticles(rows as any, { mode: "all", section: "ai", topic: "", query: "" } as any, 0).map((a) => a.id)).toEqual(["model"]);
});
