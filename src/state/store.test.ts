import { expect, it } from "vitest";
import { freshState, restoreState } from "./store";
import { methodCards } from "../ui/methodCards";
it("old and incompatible saves require an explicit restart notice",()=>{
  expect(restoreState(null,true).migrationPending).toBe(true);
  expect(restoreState(JSON.stringify({v:1,events:[]})).migrationPending).toBe(true);
  expect(restoreState("{broken").migrationPending).toBe(true);
  const s=freshState(); expect(restoreState(JSON.stringify(s))).toEqual(s);
});
it("method cards are acquired once from locked rounds and survive reload",()=>{
  const s=freshState(); expect(methodCards(s).filter(c=>c.acquired)).toHaveLength(0);
  s.rounds[0]!.locked=true; expect(methodCards(s).filter(c=>c.acquired).map(c=>c.name)).toEqual(["对照尺"]);
  s.rounds.forEach(r=>r.locked=true);
  expect(methodCards(restoreState(JSON.stringify(s))).filter(c=>c.acquired)).toHaveLength(3);
});
