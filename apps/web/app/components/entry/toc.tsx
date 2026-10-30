import { useEffect, useState } from "react";
import type { OutlineItem } from "~/lib/entry-blocks";
import { activeSection } from "~/lib/reading";
import { cn } from "~/lib/utils";

/** The nearest ancestor that scrolls (the detail panel's scroller), or null for the document. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * The table of contents of a long article (full screen only): the body's headings as in-page links, the section being read marked
 * with `aria-current="location"` (scroll-spy). Plain anchors, so it works without scripts and from the keyboard; the scroll-spy is
 * an enhancement that reads the headings' positions on scroll. Sticky under the navbar from `md` up. Its position in the DOM is
 * before the body (the details column), so a keyboard user can jump to a section without tabbing through the text.
 */
export function TableOfContents({ items, className }: { items: readonly OutlineItem[]; className?: string }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    const first = document.getElementById(items[0]?.id ?? "");
    if (!first) return;
    const root = scrollParent(first);
    const target: HTMLElement | Window = root ?? window;
    const line = () => (root ? root.getBoundingClientRect().top : 0) + 112;
    let frame = 0;
    const update = () => {
      frame = 0;
      const tops = items.flatMap((item) => {
        const el = document.getElementById(item.id);
        return el ? [{ id: item.id, top: el.getBoundingClientRect().top }] : [];
      });
      // At the very bottom the last section wins even when its heading never reaches the line.
      const atEnd = root ? root.scrollTop + root.clientHeight >= root.scrollHeight - 2 : window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      setActive(atEnd && tops.length > 0 && root && root.scrollTop > 0 ? tops[tops.length - 1]!.id : activeSection(tops, line()));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items]);

  if (items.length === 0) return null;
  return (
    <nav aria-labelledby="entry-toc" data-slot="entry-toc" className={cn("hidden md:flex md:flex-col md:gap-3 print:hidden", className)}>
      {/* (a block title like the others of the margin, "At a glance" and "Tags": the display face, one gap under it) */}
      <h2 id="entry-toc" className="m-0 font-[family-name:var(--font-display)] text-[1.375rem] leading-tight font-bold tracking-tight text-foreground">
        Contents
      </h2>
      {/* (the rows are laid as the facts' are: their padding is the link's, so the hover's tile, the marker at its left edge and the text are one box) */}
      <ol className="m-0 -mx-3 list-none p-0">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={item.id === active ? "location" : undefined}
              data-level={item.level}
              className={cn("ds-toc-link flex min-h-9 items-center px-3 py-1.5 leading-snug no-underline", item.level === 3 && "pl-7")}
            >
              <span className={cn("min-w-0", item.level === 3 && "text-muted-foreground")}>{item.text}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
