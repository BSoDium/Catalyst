import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DWELL_MS, MoonOverlay, READ_MS, TOUCH_HOLD_MS, type MoonFrame } from "./moon-overlay";

/**
 * The overlay's clocks (the 1.5 s before the box, the reveal, the 5 s it stays read), against a hand-made DOM and fake timers: the suite runs in node, and what is tested is the
 * overlay's own state (`data-seen`, `data-read`, the words), not a browser's layout.
 */
class El {
  dataset: Record<string, string> = {};
  style = { setProperty() {}, width: "", height: "", transform: "", pointerEvents: "" } as Record<string, unknown>;
  listeners = new Map<string, (e: unknown) => void>();
  textContent = "";
  className = "";
  hidden = false;
  tabIndex = 0;
  offsetWidth = 200;
  offsetHeight = 40;
  clientWidth = 600;
  clientHeight = 800;
  ownerDocument = { createElement: () => new El(), createElementNS: () => new El() };
  setAttribute() {}
  append(..._: unknown[]) {}
  remove() {}
  matches() {
    return false;
  }
  contains() {
    return false;
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, fn);
  }
}

const MOON = { href: "https://example.test", title: "Memory lane", description: "The first version of this site, kept just as it was.", cta: "Take a trip back" };
const frame = (unhidden = 1): MoonFrame => ({
  x: 300,
  y: 300,
  r: 12,
  amount: 1,
  unhidden,
  angle: 0,
  grid: { col: 120, row: 120, rad: 5, visible: null, cell: 2.5, left: 0, top: 0 },
  tone: "rgb(135 135 135)",
});

describe("MoonOverlay clocks", () => {
  let link: El;
  let words: { title: El; body: El };
  let current: MoonFrame | null;
  let overlay: MoonOverlay;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    // the elements are made in the order the constructor makes them: the link first, then the card, the text, the title, the body (a `El` each)
    const made: El[] = [];
    const root = new El();
    root.ownerDocument.createElement = () => {
      const e = new El();
      made.push(e);
      return e;
    };
    current = frame();
    overlay = new MoonOverlay(root as unknown as HTMLElement, MOON, () => current, () => {});
    link = made[0]!;
    words = { title: made[3]!, body: made[4]! };
  });

  afterEach(() => {
    overlay.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const tick = (ms: number) => vi.advanceTimersByTime(ms);
  const clear = () => words.title.textContent === MOON.title && words.body.textContent === MOON.description;
  const enter = () => link.listeners.get("pointerenter")!({ pointerType: "mouse" });
  const leave = () => link.listeners.get("pointerleave")!({ pointerType: "mouse" });

  it("is not boxed until the moon has been a target for DWELL_MS, and its words are scrambled then", () => {
    overlay.update();
    tick(DWELL_MS - 1);
    expect("seen" in link.dataset).toBe(false);
    tick(1);
    expect("seen" in link.dataset).toBe(true);
    expect(clear()).toBe(false);
    expect(words.title.textContent).toHaveLength(MOON.title.length);
  });

  it("starts the count again after a break: a moon that passes quickly is never boxed", () => {
    overlay.update();
    tick(1000);
    current = frame(0); // the planet is in front of it: not a target
    overlay.update();
    current = frame();
    overlay.update();
    tick(DWELL_MS - 1);
    expect("seen" in link.dataset).toBe(false);
    tick(1);
    expect("seen" in link.dataset).toBe(true);
  });

  it("comes clear when held, stays clear for READ_MS after it is let go of, then scrambles again", () => {
    overlay.update();
    tick(DWELL_MS);
    enter();
    tick(700);
    expect(clear()).toBe(true);
    expect("read" in link.dataset).toBe(true);
    leave();
    tick(160 + READ_MS - 200); // the card closes 160 ms after the pointer leaves; the count is from then
    expect(clear()).toBe(true);
    tick(1000);
    expect(clear()).toBe(false);
    expect("read" in link.dataset).toBe(false);
  });

  it("holds it again within the linger and the count starts over", () => {
    overlay.update();
    tick(DWELL_MS);
    enter();
    tick(700);
    leave();
    tick(160);
    tick(READ_MS - 500);
    enter();
    tick(100);
    leave();
    tick(160 + READ_MS - 500);
    expect(clear()).toBe(true);
    tick(1000);
    expect(clear()).toBe(false);
  });

  it("is unread the next time when the box goes before the words are scrambled again", () => {
    overlay.update();
    tick(DWELL_MS);
    enter();
    tick(700);
    leave();
    tick(500);
    expect(clear()).toBe(true);
    current = frame(0); // no longer a target: the box and the card go
    overlay.update();
    expect("seen" in link.dataset).toBe(false);
    expect(clear()).toBe(false);
    expect("read" in link.dataset).toBe(false);
  });
});

describe("MoonOverlay on a touch screen", () => {
  let link: El;
  let words: { title: El; body: El };
  let overlay: MoonOverlay;
  let held: boolean[];
  let doc: Map<string, (e: unknown) => void>;

  const setup = (coarse: boolean) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: coarse && q === "(hover: none)" }));
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    held = [];
    doc = new Map();
    const made: El[] = [];
    const root = new El();
    root.ownerDocument = {
      createElement: () => {
        const e = new El();
        made.push(e);
        return e;
      },
      createElementNS: () => new El(),
      addEventListener: (t: string, fn: (e: unknown) => void) => void doc.set(t, fn),
      removeEventListener: (t: string) => void doc.delete(t),
    } as unknown as El["ownerDocument"];
    overlay = new MoonOverlay(root as unknown as HTMLElement, MOON, () => frame(), (on) => held.push(on));
    link = made[0]!;
    words = { title: made[3]!, body: made[4]! };
  };

  afterEach(() => {
    overlay.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const tick = (ms: number) => vi.advanceTimersByTime(ms);
  const clear = () => words.title.textContent === MOON.title && words.body.textContent === MOON.description;
  const tap = () => {
    link.listeners.get("pointerdown")!({ pointerType: "touch" });
    link.listeners.get("click")!({ preventDefault() {} });
  };

  it("holds the moon still once its box is up, so that it can be tapped, and lets it go if it is not", () => {
    setup(true);
    overlay.update();
    tick(DWELL_MS - 1);
    expect(held).toEqual([]);
    tick(1);
    expect(held).toEqual([true]);
    tick(TOUCH_HOLD_MS - 1);
    expect(held).toEqual([true]);
    tick(1);
    expect(held).toEqual([true, false]);
  });

  it("the first tap reads the words and keeps the moon held past the wait; a press elsewhere puts the card away", () => {
    setup(true);
    overlay.update();
    tick(DWELL_MS);
    tap();
    tick(700);
    expect(link.dataset.open).toBeDefined();
    expect(clear()).toBe(true);
    tick(TOUCH_HOLD_MS * 2);
    expect(held.at(-1)).toBe(true); // still held: the open card holds it
    expect(doc.has("pointerdown")).toBe(true);
    doc.get("pointerdown")!({ target: {} });
    expect("open" in link.dataset).toBe(false);
    expect(held.at(-1)).toBe(false);
    expect(doc.has("pointerdown")).toBe(false);
  });

  it("says the second line in fewer words on a touch screen when it has them, and in full otherwise", () => {
    setup(true);
    overlay.dispose();
    const made: El[] = [];
    const root = new El();
    root.ownerDocument.createElement = () => {
      const e = new El();
      made.push(e);
      return e;
    };
    const short = "The first version of this site.";
    new MoonOverlay(root as unknown as HTMLElement, { ...MOON, shortDescription: short }, () => frame(), () => {});
    expect(made[4]!.textContent).toHaveLength(short.length); // (the words start scrambled: the length is the sentence's)
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    made.length = 0;
    new MoonOverlay(root as unknown as HTMLElement, { ...MOON, shortDescription: short }, () => frame(), () => {});
    expect(made[4]!.textContent).toHaveLength(MOON.description.length);
  });

  it("does not hold the moon where there is a pointer to hover with", () => {
    setup(false);
    overlay.update();
    tick(DWELL_MS + TOUCH_HOLD_MS);
    expect(held).toEqual([]);
    expect("seen" in link.dataset).toBe(true);
  });
});
