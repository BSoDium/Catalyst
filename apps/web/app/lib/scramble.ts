/**
 * The name that scrambles into the handle and back (#588): random characters iterating in place of the text, and settling from the left. Pure frames (`scrambleText`) and one controller (`NameScrambler`) that
 * runs them on the page, with the care a text that is always on screen asks for: nothing runs while the tab is hidden, a frame is drawn at most every `frameMs` (not on every display frame), only the characters of
 * the few elements it owns are written, and under reduced motion the text changes with no iteration at all.
 */

/** What an unsettled character is drawn as (mono-like widths are not needed: the line is set in the page's own face). */
export const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=?/<>";

/**
 * The text at `progress` (0..1) on its way from `from` to `to`: its length goes from the one to the other, and the characters settle into `to` from the left, the rest random glyphs (spaces and
 * hyphens stay where `to` has them). 0 is `from` and 1 is `to`, exactly.
 */
export function scrambleText(from: string, to: string, progress: number, rand: () => number = Math.random): string {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const n = Math.max(1, Math.round(from.length + (to.length - from.length) * progress));
  let out = "";
  for (let i = 0; i < n; i++) {
    const want = to[Math.min(i, to.length - 1)] ?? "";
    const settled = progress >= 0.2 + 0.8 * (i / n);
    if (settled && i < to.length) out += want;
    else if (want === " " || want === "-") out += want;
    else out += GLYPHS[Math.min(GLYPHS.length - 1, Math.floor(rand() * GLYPHS.length))];
  }
  return out;
}

export interface ScrambleSlot {
  el: HTMLElement;
  /** The text this element shows as the name, and as the handle. */
  name: string;
  handle: string;
}

export interface ScrambleOptions {
  /** The wait between one change and the next, ms, drawn between the two. */
  waitMs?: [number, number];
  /** How long a change takes, ms. */
  durationMs?: number;
  /** The least time between two frames, ms. */
  frameMs?: number;
  rand?: () => number;
}

/**
 * Shows the name and, every `waitMs` (10 to 15 s), scrambles it into the handle and, the next time, back. `stop()` puts the name back as it was (its markup too), whatever it was doing. The elements are
 * written with `textContent`, only while a change runs; between changes nothing runs but one timer.
 */
export class NameScrambler {
  private timer = 0;
  private raf = 0;
  private showing: "name" | "handle" = "name";
  private originals: string[];
  private running = false;
  private readonly wait: [number, number];
  private readonly duration: number;
  private readonly frameMs: number;
  private readonly rand: () => number;

  constructor(
    private slots: ScrambleSlot[],
    opts: ScrambleOptions = {},
  ) {
    this.originals = slots.map((s) => s.el.innerHTML);
    this.wait = opts.waitMs ?? [10_000, 15_000];
    this.duration = opts.durationMs ?? 900;
    this.frameMs = opts.frameMs ?? 45;
    this.rand = opts.rand ?? Math.random;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    this.arm();
  }

  stop(): void {
    this.running = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.clearTimeout(this.timer);
    window.cancelAnimationFrame(this.raf);
    this.timer = 0;
    this.raf = 0;
    this.slots.forEach((s, i) => (s.el.innerHTML = this.originals[i]!));
    this.showing = "name";
  }

  private arm(): void {
    window.clearTimeout(this.timer);
    const [a, b] = this.wait;
    this.timer = window.setTimeout(() => this.change(), a + this.rand() * (b - a));
  }

  private onVisibility = (): void => {
    if (!this.running) return;
    if (document.hidden) {
      // nothing runs behind the tab: a change under way is finished at once, the timer is dropped
      window.clearTimeout(this.timer);
      if (this.raf) this.finish();
    } else if (!this.timer && !this.raf) this.arm();
  };

  private reduced(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private change(): void {
    this.timer = 0;
    if (!this.running || document.hidden) return;
    if (this.reduced()) {
      this.showing = this.showing === "name" ? "handle" : "name";
      this.settle();
      this.arm();
      return;
    }
    const from = this.showing;
    const to = from === "name" ? "handle" : "name";
    const texts = this.slots.map((s) => ({ a: from === "name" ? s.name : s.handle, b: to === "name" ? s.name : s.handle }));
    const t0 = performance.now();
    let last = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / this.duration);
      if (p >= 1) return this.finish();
      if (now - last >= this.frameMs) {
        last = now;
        this.slots.forEach((s, i) => (s.el.textContent = scrambleText(texts[i]!.a, texts[i]!.b, p, this.rand)));
      }
      this.raf = window.requestAnimationFrame(step);
    };
    this.raf = window.requestAnimationFrame(step);
  }

  /** The change under way is over: the other text is shown. */
  private finish(): void {
    window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.showing = this.showing === "name" ? "handle" : "name";
    this.settle();
    if (!document.hidden) this.arm();
  }

  /** The settled text: the name with its own markup, the handle as plain text. */
  private settle(): void {
    this.slots.forEach((s, i) => {
      if (this.showing === "name") s.el.innerHTML = this.originals[i]!;
      else s.el.textContent = s.handle;
    });
  }
}
