/**
 * A list you can reorder by dragging a handle (mouse, pen or touch), or from
 * the keyboard: focus the handle and press the up or down arrow. No library:
 * pointer events with pointer capture, so it works the same on phones.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { dropIndex } from "@/lib/links/groups";

export type HandleProps = {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  style: CSSProperties;
  "aria-label": string;
  "aria-describedby": string;
  "data-drag-handle": true;
};

type Drag = {
  from: number;
  to: number;
  pointerId: number;
  startPageY: number;
  dy: number;
  height: number;
  mids: number[];
};

const EDGE = 64; // px from the top/bottom of the screen where dragging scrolls the page

export function SortableList<T>({
  items,
  getId,
  getLabel,
  onMove,
  disabled,
  renderItem,
  className,
  listLabel,
}: {
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
  renderItem: (item: T, index: number, handle: HandleProps, dragging: boolean) => ReactNode;
  className?: string;
  listLabel: string;
}) {
  const els = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pointerY = useRef(0);
  const scrollTimer = useRef<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const helpId = useRef(`sort-help-${Math.random().toString(36).slice(2, 8)}`).current;

  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const recompute = useCallback((clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const pageY = clientY + window.scrollY;
    const dy = pageY - d.startPageY;
    const to = dropIndex(d.mids[d.from] + dy, d.mids, d.from);
    if (dy !== d.dy || to !== d.to) update({ ...d, dy, to });
  }, []);

  const stopScroll = () => {
    if (scrollTimer.current !== null) {
      window.clearInterval(scrollTimer.current);
      scrollTimer.current = null;
    }
  };

  const finish = useCallback(
    (commit: boolean) => {
      const d = dragRef.current;
      stopScroll();
      update(null);
      if (!d) return;
      if (commit && d.to !== d.from) {
        onMove(d.from, d.to);
        setAnnounce(`Moved to position ${d.to + 1} of ${items.length}.`);
      }
    },
    [onMove, items.length],
  );

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag, finish]);

  useEffect(() => stopScroll, []);

  const startDrag = (index: number) => (e: PointerEvent<HTMLElement>) => {
    if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const mids = items.map((it) => {
      const r = els.current.get(getId(it))?.getBoundingClientRect();
      return r ? r.top + window.scrollY + r.height / 2 : 0;
    });
    const own = els.current.get(getId(items[index]))?.getBoundingClientRect();
    pointerY.current = e.clientY;
    update({
      from: index,
      to: index,
      pointerId: e.pointerId,
      startPageY: e.clientY + window.scrollY,
      dy: 0,
      height: (own?.height ?? 0) + 12,
      mids,
    });

    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      pointerY.current = ev.clientY;
      recompute(ev.clientY);
      const nearTop = ev.clientY < EDGE;
      const nearBottom = ev.clientY > window.innerHeight - EDGE;
      if ((nearTop || nearBottom) && scrollTimer.current === null) {
        scrollTimer.current = window.setInterval(() => {
          const y = pointerY.current;
          const step = y < EDGE ? -12 : y > window.innerHeight - EDGE ? 12 : 0;
          if (step === 0) return stopScroll();
          window.scrollBy(0, step);
          recompute(y);
        }, 16);
      }
    };
    const up = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", cancel);
      finish(true);
    };
    const cancel = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", cancel);
      finish(false);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", cancel);
  };

  const keyMove = (index: number) => (e: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    const to = index + dir;
    if (to < 0 || to >= items.length) return;
    onMove(index, to);
    setAnnounce(`${getLabel(items[index])} moved to position ${to + 1} of ${items.length}.`);
    // Keep focus on the same item's handle after it moves.
    const id = getId(items[index]);
    requestAnimationFrame(() => {
      els.current.get(id)?.querySelector<HTMLElement>("[data-drag-handle]")?.focus();
    });
  };

  const shiftFor = (i: number): number => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.height;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return drag.height;
    return 0;
  };

  return (
    <>
      <p id={helpId} className="sr-only">
        Drag the handle to reorder, or focus it and use the up and down arrow keys.
      </p>
      <ul className={className} aria-label={listLabel}>
        {items.map((item, i) => {
          const id = getId(item);
          const dragging = drag?.from === i;
          const style: CSSProperties = dragging
            ? { transform: `translateY(${drag.dy}px)`, zIndex: 10, position: "relative" }
            : drag
              ? { transform: `translateY(${shiftFor(i)}px)`, transition: "transform 150ms ease" }
              : {};
          const handle: HandleProps = {
            onPointerDown: startDrag(i),
            onKeyDown: keyMove(i),
            style: {
              touchAction: "none",
              cursor: disabled ? "default" : dragging ? "grabbing" : "grab",
            },
            "aria-label": `Reorder ${getLabel(item)}`,
            "aria-describedby": helpId,
            "data-drag-handle": true,
          };
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) els.current.set(id, el);
                else els.current.delete(id);
              }}
              style={style}
              className={dragging ? "select-none" : undefined}
            >
              {renderItem(item, i, handle, dragging)}
            </li>
          );
        })}
      </ul>
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
    </>
  );
}
