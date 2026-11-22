export type Ordered = { id: string; display_order: number };

/**
 * Moves the item at `index` one place up (-1) or down (+1) and numbers the
 * list 1..n in its new order. Returns the reordered list and only the rows
 * whose number changed, so the dashboard saves as little as possible.
 * Renumbering (rather than swapping two numbers) also repairs duplicate or
 * missing numbers left by older versions of the app.
 */
export function moveLink<T extends Ordered>(
  links: T[],
  index: number,
  direction: -1 | 1,
): { links: T[]; changed: { id: string; display_order: number }[] } {
  const target = index + direction;
  if (index < 0 || index >= links.length || target < 0 || target >= links.length) {
    return { links, changed: [] };
  }
  const moved = [...links];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  const changed: { id: string; display_order: number }[] = [];
  const renumbered = moved.map((l, i) => {
    const display_order = i + 1;
    if (l.display_order !== display_order) changed.push({ id: l.id, display_order });
    return { ...l, display_order };
  });
  return { links: renumbered, changed };
}
