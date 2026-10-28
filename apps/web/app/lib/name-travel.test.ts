import { describe, expect, it } from "vitest";
import { IDENTITY_TRANSFORM, NameTravel, type TravelAnimation, type TravelHalf } from "./name-travel";

/**
 * A half of the name with a clock: its animation moves it from `from` to `to` over `ms` (linear is enough: the choreography decides WHERE it goes,
 * not how fast), `computed()` is what the browser would report mid-way, and the inline transform is the element's own style. There is no DOM
 * environment in this repo's tests (and no dependency for one), so the element is this model of the three things the choreography touches.
 */
class FakeHalf implements TravelHalf {
  inline: string | null = null;
  anim: { from: number; to: number; start: number; animation: Fake } | null = null;
  constructor(
    public final: string,
    private clock: { now: number },
    private value: (t: string) => number,
    private ms = 320,
  ) {}
  /** The position now: the animation's, else the inline transform's, else rest. */
  position(): number {
    if (this.anim) {
      const p = Math.min(1, (this.clock.now - this.anim.start) / this.ms);
      return this.anim.from + (this.anim.to - this.anim.from) * p;
    }
    return this.inline === null ? 0 : this.value(this.inline);
  }
  setInline(v: string | null): void {
    this.inline = v;
  }
  computed(): string {
    return `pos(${this.position()})`;
  }
  animate(from: string, to: string): TravelAnimation {
    const animation = new Fake(this);
    this.anim = { from: this.value(from), to: this.value(to), start: this.clock.now, animation };
    return animation;
  }
  /** Run the clock to `t`: animations that have reached their end fire `onfinish`. */
  tick(): void {
    if (this.anim && this.clock.now - this.anim.start >= this.ms) {
      const a = this.anim.animation;
      a.onfinish?.();
    }
  }
}
class Fake implements TravelAnimation {
  onfinish: (() => void) | null = null;
  constructor(private half: FakeHalf) {}
  cancel(): void {
    if (this.half.anim?.animation === this) this.half.anim = null;
  }
}

const parse = (t: string): number => (t === IDENTITY_TRANSFORM ? 0 : t.startsWith("pos(") ? Number(t.slice(4, -1)) : Number(/^corner:(-?[\d.]+)$/.exec(t)?.[1] ?? NaN));

function setup() {
  const clock = { now: 0 };
  const halves = [new FakeHalf("corner:100", clock, parse), new FakeHalf("corner:240", clock, parse)];
  let settled: boolean[] = [];
  const travel = new NameTravel((toCorner) => settled.push(toCorner));
  const advance = (ms: number) => {
    clock.now += ms;
    for (const h of halves) h.tick();
  };
  return { clock, halves, travel, advance, settled: () => settled };
}

describe("the name's travel: where each half is at every moment, and where it is left", () => {
  it("goes to the corner: the inline transform is the corner's from the start (the animation overrides it), and it is the corner when the animation ends", () => {
    const { halves, travel, advance, settled } = setup();
    travel.go(halves, true);
    expect(halves.map((h) => h.inline)).toEqual(["corner:100", "corner:240"]);
    expect(travel.isRunning).toBe(true);
    advance(160);
    expect(halves[0]!.position()).toBeCloseTo(50, 9);
    advance(200);
    expect(travel.isRunning).toBe(false);
    expect(halves.map((h) => h.position())).toEqual([100, 240]);
    expect(settled()).toEqual([true]);
  });

  it("a travel asked for while one runs starts from where the half is, even when the caller builds new half objects for it (the hero measures them anew each time)", () => {
    const { halves, travel, advance } = setup();
    const ids = halves.map((_, i) => `half-${i}`);
    // (the same elements, new objects each time: as `halvesOf` makes them)
    const fresh = (): TravelHalf[] => halves.map((h, i) => ({ id: ids[i], final: h.final, setInline: (v) => h.setInline(v), computed: () => h.computed(), animate: (f, t) => h.animate(f, t) }));
    travel.go(fresh(), true);
    advance(160);
    const here = halves[0]!.position();
    travel.go(fresh(), true);
    expect(halves[0]!.anim!.from).toBeCloseTo(here, 9);
    expect(here).toBeGreaterThan(0);
  });

  it("comes back: the inline transform is removed at the start, and the half ends in place", () => {
    const { halves, travel, advance } = setup();
    travel.go(halves, true);
    advance(400);
    travel.go(halves, false);
    expect(halves.map((h) => h.inline)).toEqual([null, null]);
    advance(400);
    expect(halves.map((h) => h.position())).toEqual([0, 0]);
    expect(halves.every((h) => h.anim === null)).toBe(true);
  });

  it("turns round mid-flight (collapse, then restore within the travel): it starts from where it IS, is never left at the corner and ends in place", () => {
    const { halves, travel, advance } = setup();
    travel.go(halves, true);
    advance(100); // 31 % of the way to the corner
    const where = halves.map((h) => h.position());
    expect(where[0]).toBeGreaterThan(0);
    expect(where[0]).toBeLessThan(100);
    travel.go(halves, false);
    // the inline transform follows the new direction at once (this is what the old code left at the corner)
    expect(halves.map((h) => h.inline)).toEqual([null, null]);
    // and the picture has not jumped: the new animation starts at the same place
    expect(halves.map((h) => h.position())).toEqual(where);
    advance(160);
    expect(halves[0]!.position()).toBeLessThan(where[0]!);
    advance(200);
    expect(halves.map((h) => h.position())).toEqual([0, 0]);
    expect(halves.map((h) => h.inline)).toEqual([null, null]);
  });

  it("turns round the other way too (restore, then collapse again): the half ends at the corner with the corner as its inline style", () => {
    const { halves, travel, advance } = setup();
    travel.go(halves, true);
    advance(400);
    travel.go(halves, false);
    advance(80);
    const where = halves.map((h) => h.position());
    expect(where[1]).toBeGreaterThan(0);
    travel.go(halves, true);
    expect(halves.map((h) => h.inline)).toEqual(["corner:100", "corner:240"]);
    expect(halves.map((h) => h.position())).toEqual(where);
    advance(400);
    expect(halves.map((h) => h.position())).toEqual([100, 240]);
    expect(halves.map((h) => h.inline)).toEqual(["corner:100", "corner:240"]);
  });

  it("settles once per travel, for the direction it ended in: a turned-round travel does not report the one it replaced", () => {
    const { halves, travel, advance, settled } = setup();
    travel.go(halves, true);
    advance(100);
    travel.go(halves, false);
    advance(400);
    expect(settled()).toEqual([false]);
  });

  it("cancel leaves the inline transform where it is and nothing running", () => {
    const { halves, travel, advance } = setup();
    travel.go(halves, true);
    advance(50);
    travel.cancel();
    expect(travel.isRunning).toBe(false);
    expect(halves.every((h) => h.anim === null)).toBe(true);
    advance(400);
    expect(halves.map((h) => h.inline)).toEqual(["corner:100", "corner:240"]);
  });
});
