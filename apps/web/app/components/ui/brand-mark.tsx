import type { SVGProps } from "react";

/**
 * The marks of the sites the buttons that leave this one go to (the symbol only, never the wordmark), at the size of the button's text. They are the services' own marks, used to say where the link goes:
 * Polarsteps' (the circle with the pointer, from its site's header logo, drawn in the current colour so it follows both schemes) and Pexels' (its favicon, `public/brands/pexels-mark.png`, as the service publishes it).
 */
export function PolarstepsMark(props: Omit<SVGProps<SVGSVGElement>, "viewBox" | "children">) {
  return (
    <svg viewBox="0 0 120 120" width="1.125em" height="1.125em" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M60 120c33.137 0 60-26.863 60-60S93.137 0 60 0 0 26.863 0 60s26.863 60 60 60m0-12c26.51 0 48-21.49 48-48S86.51 12 60 12 12 33.49 12 60s21.49 48 48 48m-4.688-42.784-6.152 2.58a2 2 0 0 0-.658 3.241l23.967 23.558a1.999 1.999 0 0 0 3.43-1.439l-.001-33.61a2 2 0 0 0-2.772-1.803l-6.15 2.58a7 7 0 0 1-11.664 4.893" />
      <path fillRule="evenodd" clipRule="evenodd" d="m70.806 52.207-6.153 2.58a7 7 0 0 0-11.665 4.893l-6.149 2.58a2 2 0 0 1-2.772-1.802l-.001-33.61a2 2 0 0 1 3.43-1.44l23.967 23.558a2 2 0 0 1-.657 3.24" />
    </svg>
  );
}

export function PexelsMark({ className }: { className?: string }) {
  return <img src="/brands/pexels-mark.png" alt="" width={64} height={64} aria-hidden="true" decoding="async" className={className ?? "size-[1.125em]"} />;
}
