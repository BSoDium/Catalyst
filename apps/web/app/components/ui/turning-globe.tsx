/**
 * A globe drawn the system's way (the 24-unit grid, `.ui-icon`: one stroke weight, `currentColor`), whose longitudes scan its surface while the globe is turning: a meridian seen from the side is half an ellipse from
 * the north pole to the south pole that bulges to one side by 9 sin(longitude), closes up to a straight line through the middle and opens toward the other side until it merges into the rim. ONE path per meridian, its
 * bulge `s` going from -9 to 9 and back to -9 (never two pieces that hand over): three of them, 60 degrees apart (each a third of a lap behind the one before), so about two read clear of the rim at any moment.
 * Still (one meridian, the equator) when it is not turning: off, or under reduced motion. Decorative (`aria-hidden`): the button's words carry the name.
 *
 * The path is two cubic quarters of an ellipse (the usual 0.5523 handles) so that every frame of the animation has the same commands and SMIL can interpolate the numbers; the strokes of a meridian end with butt caps at the poles
 * (the system's square ends would poke out past the rim there).
 */
const POLE = 9;
const KAPPA = 0.5523;
const r = (n: number) => Math.round(n * 100) / 100;

/** The meridian whose widest point is `s` units to the right of the middle (to the left when negative), as one path. */
function meridian(s: number): string {
  const x = 12 + s;
  const kx = 12 + KAPPA * s;
  const ky = KAPPA * POLE;
  return `M12 3C${r(kx)} 3 ${r(x)} ${r(12 - ky)} ${r(x)} 12S${r(kx)} 21 12 21`;
}

/** 24 steps over one lap: the longitude goes from the left rim to the right one, `s = -9 cos(pi t)` (a sine of the longitude), sampled evenly. */
const STEPS = 24;
const LAP_VALUES = Array.from({ length: STEPS + 1 }, (_, i) => meridian(-POLE * Math.cos((Math.PI * i) / STEPS))).join(";");
const LAP = 4; // seconds

export function TurningGlobe({ turning }: { turning: boolean }) {
  return (
    <svg className="ui-icon globe-dock-globe" data-size="inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      {turning ? (
        [0, 1, 2].map((i) => (
          <path key={i} d={meridian(-POLE)} strokeLinecap="butt">
            <animate attributeName="d" values={LAP_VALUES} dur={`${LAP}s`} begin={`${-((LAP / 3) * i).toFixed(3)}s`} repeatCount="indefinite" />
          </path>
        ))
      ) : (
        <ellipse cx="12" cy="12" rx="4" ry="9" />
      )}
    </svg>
  );
}
