/**
 * A globe drawn the system's way (the 24-unit grid, `.ui-icon`: one stroke weight, square ends, `currentColor`), whose longitudes scan its surface while the globe is turning: a meridian seen from the side is half an
 * ellipse that starts on one edge of the disc, closes up to a straight line through the middle and opens again toward the other edge (its half-width is 9 |sin| of its longitude), and three are on the front at any time, 60 degrees
 * apart (each runs a third of a lap behind the one before; the one nearest the rim merges into it, so about two read at once). Still (one meridian, the equator) when it is not: off, or under reduced motion. Decorative (`aria-hidden`): the button's words carry the name.
 *
 * Each meridian is two ellipses, one clipped to the left half of the disc and one to the right, the half-width animated by SMIL (no stretching: a scaled stroke would change its weight, and the system has one).
 */
const LAP = "4s";
const LEFT = { values: "9;8.83;8.31;7.48;6.36;5;3.44;1.76;0.05;0.05", keyTimes: "0;0.0625;0.125;0.1875;0.25;0.3125;0.375;0.4375;0.5;1" };
const RIGHT = { values: "0.05;0.05;1.76;3.44;5;6.36;7.48;8.31;8.83;9", keyTimes: "0;0.5;0.5625;0.625;0.6875;0.75;0.8125;0.875;0.9375;1" };

function Meridian({ begin }: { begin: string }) {
  return (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="9" clipPath="url(#turning-globe-left)">
        <animate attributeName="rx" values={LEFT.values} keyTimes={LEFT.keyTimes} dur={LAP} begin={begin} repeatCount="indefinite" />
      </ellipse>
      <ellipse cx="12" cy="12" rx="0" ry="9" clipPath="url(#turning-globe-right)">
        <animate attributeName="rx" values={RIGHT.values} keyTimes={RIGHT.keyTimes} dur={LAP} begin={begin} repeatCount="indefinite" />
      </ellipse>
    </>
  );
}

export function TurningGlobe({ turning }: { turning: boolean }) {
  return (
    <svg className="ui-icon globe-dock-globe" data-size="inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="turning-globe-left">
          <rect x="0" y="0" width="12.9" height="24" />
        </clipPath>
        <clipPath id="turning-globe-right">
          <rect x="11.1" y="0" width="12.9" height="24" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      {turning ? (
        <>
          <Meridian begin="0s" />
          <Meridian begin="-1.333s" />
          <Meridian begin="-2.667s" />
        </>
      ) : (
        <ellipse cx="12" cy="12" rx="4" ry="9" />
      )}
    </svg>
  );
}
