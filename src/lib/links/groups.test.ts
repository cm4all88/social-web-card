import { describe, expect, it } from "vitest";
import {
  dropIndex,
  flattenGroups,
  groupLinks,
  moveItem,
  renumber,
  reorderInGroup,
  settleAfterRegroup,
} from "./groups";

type L = { id: string; display_order: number; featured?: boolean; section_id?: string | null };
const link = (id: string, display_order: number, extra: Partial<L> = {}): L => ({
  id,
  display_order,
  ...extra,
});
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

const sections = [
  { id: "shop", title: "Shop", display_order: 2 },
  { id: "social", title: "Social Media", display_order: 1 },
];

describe("groupLinks", () => {
  it("puts featured first, then unsectioned, then sections in their order", () => {
    const links = [
      link("a", 1, { section_id: "shop" }),
      link("b", 2),
      link("c", 3, { featured: true, section_id: "social" }),
      link("d", 4, { section_id: "social" }),
      link("e", 5, { featured: true }),
    ];
    const groups = groupLinks(links, sections);
    expect(groups.map((g) => g.key)).toEqual(["featured", "main", "social", "shop"]);
    expect(ids(flattenGroups(groups))).toEqual(["c", "e", "b", "d", "a"]);
  });

  it("keeps saved order inside a group, whatever order the rows arrive in", () => {
    const links = [link("x", 3), link("y", 1), link("z", 2)];
    expect(ids(flattenGroups(groupLinks(links, [])))).toEqual(["y", "z", "x"]);
  });

  it("treats a link whose section was deleted as unsectioned", () => {
    const links = [link("a", 1, { section_id: "gone" })];
    const groups = groupLinks(links, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("main");
  });

  it("drops empty groups on the public page but keeps them on the dashboard", () => {
    const links = [link("a", 1)];
    expect(groupLinks(links, sections).map((g) => g.key)).toEqual(["main"]);
    expect(groupLinks(links, sections, { keepEmpty: true }).map((g) => g.key)).toEqual([
      "main",
      "social",
      "shop",
    ]);
  });

  it("works for old links with no featured or section fields", () => {
    const links = [
      { id: "a", display_order: 2 },
      { id: "b", display_order: 1 },
    ];
    expect(ids(flattenGroups(groupLinks(links, [])))).toEqual(["b", "a"]);
  });
});

describe("moveItem and renumber", () => {
  it("moves an item down and up", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("ignores moves out of range", () => {
    const xs = ["a", "b"];
    expect(moveItem(xs, 0, 5)).toBe(xs);
    expect(moveItem(xs, -1, 0)).toBe(xs);
  });
  it("only reports rows whose number changed, and repairs duplicates", () => {
    const { items, changed } = renumber([link("a", 1), link("b", 1), link("c", 3)]);
    expect(items.map((i) => i.display_order)).toEqual([1, 2, 3]);
    expect(changed).toEqual([{ id: "b", display_order: 2 }]);
  });
});

describe("reorderInGroup", () => {
  it("reorders inside one section and renumbers in display order", () => {
    const links = [
      link("m1", 1),
      link("s1", 2, { section_id: "social" }),
      link("s2", 3, { section_id: "social" }),
      link("s3", 4, { section_id: "social" }),
    ];
    const { links: next, changed } = reorderInGroup(links, sections, "social", 2, 0);
    expect(ids(next)).toEqual(["m1", "s3", "s1", "s2"]);
    expect(next.map((l) => l.display_order)).toEqual([1, 2, 3, 4]);
    expect(changed.map((c) => c.id).sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("reorders featured links without touching the others' relative order", () => {
    const links = [
      link("a", 1),
      link("f1", 2, { featured: true }),
      link("b", 3),
      link("f2", 4, { featured: true }),
    ];
    const { links: next } = reorderInGroup(links, [], "featured", 1, 0);
    const groups = groupLinks(next, []);
    expect(ids(groups[0].links)).toEqual(["f2", "f1"]);
    expect(ids(groups[1].links)).toEqual(["a", "b"]);
  });
});

describe("settleAfterRegroup", () => {
  it("puts a link moved into a section at the end of it", () => {
    const links = [
      link("a", 1, { section_id: "social" }),
      link("b", 2),
      link("c", 3, { section_id: "social" }),
    ];
    // b has just been moved into Social Media.
    const moved = links.map((l) => (l.id === "b" ? { ...l, section_id: "social" } : l));
    const { links: next } = settleAfterRegroup(moved, sections, "b");
    expect(ids(next)).toEqual(["a", "c", "b"]);
    expect(next.map((l) => l.display_order)).toEqual([1, 2, 3]);
  });
});

describe("dropIndex", () => {
  const mids = [10, 30, 50, 70];
  it("keeps the item in place near its own position", () => {
    expect(dropIndex(32, mids, 1)).toBe(1);
  });
  it("moves down past the middles above the pointer", () => {
    expect(dropIndex(55, mids, 0)).toBe(2);
    expect(dropIndex(999, mids, 0)).toBe(3);
  });
  it("moves up", () => {
    expect(dropIndex(5, mids, 3)).toBe(0);
    expect(dropIndex(40, mids, 3)).toBe(2);
  });
});
