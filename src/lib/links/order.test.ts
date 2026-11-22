import { describe, expect, it } from "vitest";
import { moveLink } from "./order";

const list = (orders: number[]) => orders.map((o, i) => ({ id: `l${i}`, display_order: o }));

describe("moveLink", () => {
  it("moves a link down and renumbers", () => {
    const r = moveLink(list([1, 2, 3]), 0, 1);
    expect(r.links.map((l) => l.id)).toEqual(["l1", "l0", "l2"]);
    expect(r.links.map((l) => l.display_order)).toEqual([1, 2, 3]);
    expect(r.changed).toEqual([
      { id: "l1", display_order: 1 },
      { id: "l0", display_order: 2 },
    ]);
  });

  it("moves a link up", () => {
    const r = moveLink(list([1, 2, 3]), 2, -1);
    expect(r.links.map((l) => l.id)).toEqual(["l0", "l2", "l1"]);
  });

  it("does nothing past either end", () => {
    expect(moveLink(list([1, 2]), 0, -1).changed).toEqual([]);
    expect(moveLink(list([1, 2]), 1, 1).changed).toEqual([]);
  });

  it("repairs duplicate numbers", () => {
    const r = moveLink(list([1, 1, 1]), 1, 1);
    expect(r.links.map((l) => l.id)).toEqual(["l0", "l2", "l1"]);
    expect(r.links.map((l) => l.display_order)).toEqual([1, 2, 3]);
    expect(r.changed.map((c) => c.id)).toEqual(["l2", "l1"]);
  });
});
