/** One meridian turning: its half-width follows |cos| of the turn (9 samples over half a turn, the shape repeating), and the second meridian is a quarter turn behind it. */
const MERIDIAN_A = "9;8.3;6.4;3.4;0;3.4;6.4;8.3;9";
const MERIDIAN_B = "0;3.4;6.4;8.3;9;8.3;6.4;3.4;0";

/**
 * A globe drawn the system's way (the 24-unit grid, `.ui-icon`: one stroke weight, square ends, `currentColor`), whose meridians turn in 2D while the globe is turning: the ellipses narrow to a line and widen again, which
 * reads as a planet rotating. Still (one meridian, the equator) when it is not: off, or under reduced motion. Decorative (`aria-hidden`): the button's words carry the name.
 */
export function TurningGlobe({ turning }: { turning: boolean }) {
  return (
    <svg className="ui-icon globe-dock-globe" data-size="inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      {turning ? (
        <>
          <ellipse cx="12" cy="12" ry="9" rx="9">
            <animate attributeName="rx" values={MERIDIAN_A} dur="4s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="12" cy="12" ry="9" rx="0">
            <animate attributeName="rx" values={MERIDIAN_B} dur="4s" repeatCount="indefinite" />
          </ellipse>
        </>
      ) : (
        <ellipse cx="12" cy="12" rx="4" ry="9" />
      )}
    </svg>
  );
}
