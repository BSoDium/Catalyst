import { cn } from "~/lib/utils";

interface Tag {
  label: string;
  /** Makes the tag a link (internal links should use a path). */
  href?: string;
}

/** A wrapped list of square outlined tags. Link tags keep a 44 px touch target on phones (the chip stays 24 px tall). */
export function TagList({ tags, label, className }: { tags: readonly Tag[]; label: string; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label={label} data-slot="tag-list" className={cn("m-0 flex list-none flex-wrap gap-2 p-0", className)}>
      {tags.map((tag) => (
        <li key={tag.label}>
          {tag.href ? (
            <a href={tag.href} className="ds-tag ds-micro" data-tone="strong">
              {tag.label}
            </a>
          ) : (
            <span className="ds-tag ds-micro" data-tone="strong">
              {tag.label}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
