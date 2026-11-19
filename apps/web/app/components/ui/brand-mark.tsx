import type { SVGProps } from "react";

/**
 * The marks of the sites the buttons that leave this one go to (the symbol only, never the wordmark), at the size of the button's text. They are the services' own marks, used to say where the link goes:
 * ArtStation's, GitHub's and WakaTime's (from Simple Icons, CC0), Polarsteps' (the circle with the pointer, from its site's header logo, drawn in the current colour so it follows both schemes) and Pexels' (its favicon, `public/brands/pexels-mark.png`, as the service publishes it, as a square with the "p" cut out: `pexels-mark-square.png`).
 */
export function PolarstepsMark(props: Omit<SVGProps<SVGSVGElement>, "viewBox" | "children">) {
  return (
    <svg viewBox="0 0 120 120" width="1.125em" height="1.125em" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M60 120c33.137 0 60-26.863 60-60S93.137 0 60 0 0 26.863 0 60s26.863 60 60 60m0-12c26.51 0 48-21.49 48-48S86.51 12 60 12 12 33.49 12 60s21.49 48 48 48m-4.688-42.784-6.152 2.58a2 2 0 0 0-.658 3.241l23.967 23.558a1.999 1.999 0 0 0 3.43-1.439l-.001-33.61a2 2 0 0 0-2.772-1.803l-6.15 2.58a7 7 0 0 1-11.664 4.893" />
      <path fillRule="evenodd" clipRule="evenodd" d="m70.806 52.207-6.153 2.58a7 7 0 0 0-11.665 4.893l-6.149 2.58a2 2 0 0 1-2.772-1.802l-.001-33.61a2 2 0 0 1 3.43-1.44l23.967 23.558a2 2 0 0 1-.657 3.24" />
    </svg>
  );
}

export function ArtStationMark(props: Omit<SVGProps<SVGSVGElement>, "viewBox" | "children">) {
  return (
    <svg viewBox="0 0 24 24" width="1.125em" height="1.125em" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M0 17.723l2.027 3.505h.001a2.424 2.424 0 0 0 2.164 1.333h13.457l-2.792-4.838H0zm24 .025c0-.484-.143-.935-.388-1.314L15.728 2.728a2.424 2.424 0 0 0-2.142-1.289H9.419L21.598 22.54l1.92-3.325c.378-.637.482-.919.482-1.467zm-11.129-3.462L7.428 4.858l-5.444 9.428h10.887z" />
    </svg>
  );
}

export function PexelsMark({ className }: { className?: string }) {
  // The mark is the service's favicon (a white "p" on a black square), inverted: the square is drawn in the current colour (the button's label) and the "p" is cut out of it, so the button's own fill shows through as the "p".
  return (
    <span
      aria-hidden="true"
      className={className ?? "inline-block size-[1.125em] shrink-0 bg-current"}
      style={{
        maskImage: "url(/brands/pexels-mark-square.png)",
        WebkitMaskImage: "url(/brands/pexels-mark-square.png)",
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      } as React.CSSProperties}
    />
  );
}

export function GitHubMark(props: Omit<SVGProps<SVGSVGElement>, "viewBox" | "children">) {
  return (
    <svg viewBox="0 0 24 24" width="1.125em" height="1.125em" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export function WakaTimeMark(props: Omit<SVGProps<SVGSVGElement>, "viewBox" | "children">) {
  return (
    <svg viewBox="0 0 24 24" width="1.125em" height="1.125em" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 2.824a9.176 9.176 0 1 1 0 18.352 9.176 9.176 0 0 1 0-18.352zm5.097 5.058c-.327 0-.61.19-.764.45-1.025 1.463-2.21 3.162-3.288 4.706l-.387-.636a.897.897 0 0 0-.759-.439.901.901 0 0 0-.788.492l-.357.581-1.992-2.943a.897.897 0 0 0-.761-.446c-.514 0-.903.452-.903.96a1 1 0 0 0 .207.61l2.719 3.96c.152.272.44.47.776.47a.91.91 0 0 0 .787-.483c.046-.071.23-.368.314-.504l.324.52c-.035-.047.076.113.087.13.024.031.054.059.078.085.019.019.04.036.058.052.036.033.08.056.115.08.025.016.052.028.076.04.029.015.06.024.088.035.058.025.122.027.18.04.031.004.064.003.092.005.29 0 .546-.149.707-.36 1.4-2 2.842-4.055 4.099-5.849A.995.995 0 0 0 18 8.842c0-.508-.389-.96-.903-.96" />
    </svg>
  );
}
