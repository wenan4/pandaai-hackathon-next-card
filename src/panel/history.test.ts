import { expect, it } from "vitest";
import { createHistory, pushHistory, undoHistory, redoHistory } from "./history";
it("three edits undo to baseline and redo in order",()=>{
  let h=createHistory<number[]|null>(null);
  for(const n of [1,2,3]) h=pushHistory(h,[n]);
  for(const expected of [[2],[1],null]) {h=undoHistory(h); expect(h.present).toEqual(expected);}
  expect(undoHistory(h)).toBe(h);
  for(const expected of [[1],[2],[3]]) {h=redoHistory(h); expect(h.present).toEqual(expected);}
  expect(redoHistory(h)).toBe(h);
});
it("editing after undo discards redo and keeps earlier snapshots immutable",()=>{
  const input=[1]; let h=pushHistory(createHistory<number[]>([]),input);
  input.push(99); expect(h.present).toEqual([1]);
  h=pushHistory(h,[2]);h=undoHistory(h);h=pushHistory(h,[3]);
  expect(h.future).toEqual([]); expect(undoHistory(h).present).toEqual([1]);
});
