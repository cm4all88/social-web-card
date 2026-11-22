/**
 * How links are grouped and ordered, shared by the dashboard and the public
 * page so both always agree: featured links first, then links that aren't in
 * a section, then each section in its own order. Within every group, links
 * keep the creator's saved order (display_order).
 */
export type GroupableLink = {
  id: string;
  display_order: number;
  featured?: boolean | null;
  section_id?: string | null;
};

export type LinkSection = { id: string; title: string; display_order: number };

export type LinkGroup<T> = {
  key: string;
  kind: "featured" | "main" | "section";
  section: LinkSection | null;
  links: T[];
};

export const FEATURED_KEY = "featured";
export const MAIN_KEY = "main";

const byOrder = <T extends { display_order: number }>(items: T[]): T[] =>
  items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.display_order - b.item.display_order || a.i - b.i)
    .map((x) => x.item);

export function groupLinks<T extends GroupableLink>(
  links: T[],
  sections: LinkSection[],
  opts: { keepEmpty?: boolean } = {},
): LinkGroup<T>[] {
  const ordered = byOrder(links);
  const sorted = byOrder(sections);
  const known = new Set(sorted.map((s) => s.id));
  const groups: LinkGroup<T>[] = [
    {
      key: FEATURED_KEY,
      kind: "featured",
      section: null,
      links: ordered.filter((l) => !!l.featured),
    },
    {
      key: MAIN_KEY,
      kind: "main",
      section: null,
      links: ordered.filter((l) => !l.featured && !(l.section_id && known.has(l.section_id))),
    },
    ...sorted.map((s) => ({
      key: s.id,
      kind: "section" as const,
      section: s,
      links: ordered.filter((l) => !l.featured && l.section_id === s.id),
    })),
  ];
  if (opts.keepEmpty) {
    // The dashboard always shows the main list and every section (so there's
    // somewhere to add to), but the featured group only once something is featured.
    return groups.filter((g) => g.kind !== "featured" || g.links.length > 0);
  }
  return groups.filter((g) => g.links.length > 0);
}

/** Every link in the order the groups show them. */
export function flattenGroups<T>(groups: LinkGroup<T>[]): T[] {
  return groups.flatMap((g) => g.links);
}

/** Moves one item from `from` to `to` (both indexes in the same list). */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Numbers a list 1..n in its current order. Returns the renumbered list and
 * only the rows whose number changed, so as little as possible is saved.
 */
export function renumber<T extends { id: string; display_order: number }>(
  items: T[],
): { items: T[]; changed: { id: string; display_order: number }[] } {
  const changed: { id: string; display_order: number }[] = [];
  const next = items.map((item, i) => {
    const display_order = i + 1;
    if (item.display_order !== display_order) changed.push({ id: item.id, display_order });
    return item.display_order === display_order ? item : { ...item, display_order };
  });
  return { items: next, changed };
}

/**
 * Reorders one group (by key) and renumbers every link in display order.
 * Returns the full new list of links and the rows to save.
 */
export function reorderInGroup<T extends GroupableLink>(
  links: T[],
  sections: LinkSection[],
  groupKey: string,
  from: number,
  to: number,
): { links: T[]; changed: { id: string; display_order: number }[] } {
  const groups = groupLinks(links, sections, { keepEmpty: true });
  const moved = groups.map((g) =>
    g.key === groupKey ? { ...g, links: moveItem(g.links, from, to) } : g,
  );
  const { items, changed } = renumber(flattenGroups(moved));
  // Any link not shown in a group (shouldn't happen) keeps its place at the end.
  const shown = new Set(items.map((l) => l.id));
  const rest = links.filter((l) => !shown.has(l.id));
  return { links: [...items, ...rest], changed };
}

/** Puts a link that has just changed group at the end of its new group, and renumbers. */
export function settleAfterRegroup<T extends GroupableLink>(
  links: T[],
  sections: LinkSection[],
  linkId: string,
): { links: T[]; changed: { id: string; display_order: number }[] } {
  const groups = groupLinks(links, sections, { keepEmpty: true });
  const settled = groups.map((g) => {
    const i = g.links.findIndex((l) => l.id === linkId);
    if (i === -1) return g;
    const rest = g.links.filter((l) => l.id !== linkId);
    return { ...g, links: [...rest, g.links[i]] };
  });
  const { items, changed } = renumber(flattenGroups(settled));
  return { links: items, changed };
}

/**
 * Where a dragged item lands: the number of the other items whose middle is
 * above the pointer. `midpoints` are the items' vertical centres in list
 * order, including the dragged item's own (which is skipped).
 */
export function dropIndex(pointerY: number, midpoints: number[], from: number): number {
  let target = 0;
  for (let i = 0; i < midpoints.length; i++) {
    if (i !== from && pointerY > midpoints[i]) target++;
  }
  return target;
}

/** Quick-pick names for a new section. */
export const SECTION_SUGGESTIONS = ["Social Media", "Shop", "Videos", "Contact"] as const;
