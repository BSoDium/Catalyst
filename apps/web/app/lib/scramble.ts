/**
 * The name that scrambles into the handle and back (#588): random characters iterating in place of the text, and settling from the left. Pure frames (`scrambleText`) and one controller (`NameScrambler`) that
 * runs them on the page, with the care a text that is always on screen asks for: nothing runs while the tab is hidden, a frame is drawn at most every `frameMs` (not on every display frame), only the characters of
 * the few elements it owns are written, and under reduced motion the text changes with no iteration at all.
 */

/** What an unsettled character is drawn as (mono-like widths are not needed: the line is set in the page's own face). */
export const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=?/<>";

/** One character of a frame, and whether it is settled (lit) or still noise or an old letter on its way out (a ghost). */
export interface ScrambleChar {
  ch: string;
  lit: boolean;
}

/**
 * The frame at `progress` (0..1) of `from` on its way to `to`: the length goes from the one to the other; each position keeps its old letter for a little (the earlier ones sooner), then is a random glyph,
 * a ghost, and then settles into `to` from the left (`lit`). Hyphens and spaces stay where `to` has them. 0 is `from` and 1 is `to`, exactly.
 */
export function scrambleFrame(from: string, to: string, progress: number, rand: () => number = Math.random): ScrambleChar[] {
  if (progress <= 0) return [...from].map((ch) => ({ ch, lit: true }));
  if (progress >= 1) return [...to].map((ch) => ({ ch, lit: true }));
  const n = Math.max(1, Math.round(from.length + (to.length - from.length) * progress));
  const out: ScrambleChar[] = [];
  for (let i = 0; i < n; i++) {
    const at = i / n;
    const want = to[Math.min(i, to.length - 1)] ?? "";
    if (progress < 0.04 + 0.12 * at && i < from.length) out.push({ ch: from[i]!, lit: true });
    else if (progress >= 0.2 + 0.8 * at && i < to.length) out.push({ ch: want, lit: true });
    else if (want === " " || want === "-") out.push({ ch: want, lit: true });
    else out.push({ ch: GLYPHS[Math.min(GLYPHS.length - 1, Math.floor(rand() * GLYPHS.length))]!, lit: false });
  }
  return out;
}

/** The frame as text. */
export function scrambleText(from: string, to: string, progress: number, rand: () => number = Math.random): string {
  return scrambleFrame(from, to, progress, rand).map((c) => c.ch).join("");
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
  /** How long a letter takes to fade in or out (`.scramble-ch`, app.css), ms: the change is not over until the last of them has. */
  ghostMs?: number;
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
  /** The space between the first two elements (the name's two words): the handle is one word, so it is gone while the handle is shown. */
  private gap: Text | null;
  private gapData = " ";
  private running = false;
  private readonly wait: [number, number];
  private readonly duration: number;
  private readonly frameMs: number;
  private readonly ghostMs: number;
  private readonly rand: () => number;

  constructor(
    private slots: ScrambleSlot[],
    opts: ScrambleOptions = {},
  ) {
    this.originals = slots.map((s) => s.el.innerHTML);
    const between = slots[0]?.el.nextSibling ?? null;
    this.gap = between && between.nodeType === 3 && slots[1]?.el.previousSibling === between ? (between as Text) : null;
    this.gapData = this.gap?.data ?? " ";
    this.wait = opts.waitMs ?? [10_000, 15_000];
    this.duration = opts.durationMs ?? 900;
    this.frameMs = opts.frameMs ?? 45;
    this.ghostMs = opts.ghostMs ?? 450;
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
    this.slots.forEach((s, i) => {
      delete s.el.dataset.scrambling;
      s.el.innerHTML = this.originals[i]!;
    });
    if (this.gap) this.gap.data = this.gapData;
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
      const elapsed = now - t0;
      // (after the last frame the letters that were set last are still fading in: the plain text only replaces them when they are all the way there)
      if (elapsed >= this.duration + this.ghostMs) return this.finish();
      if (now - last >= this.frameMs) {
        last = now;
        const p = Math.min(1, elapsed / this.duration);
        this.slots.forEach((s, i) => this.draw(s.el, scrambleFrame(texts[i]!.a, texts[i]!.b, p, this.rand)));
      }
      this.raf = window.requestAnimationFrame(step);
    };
    this.raf = window.requestAnimationFrame(step);
  }

  /** The frame in `el`, a span for each character: the lit ones are fully there, the others are ghosts (`data-ghost`: dim, and the opacity eases, so a letter takes its time to go and to come). */
  private draw(el: HTMLElement, frame: ScrambleChar[]): void {
    const doc = el.ownerDocument;
    if (el.dataset.scrambling !== "") {
      el.textContent = "";
      el.dataset.scrambling = "";
    }
    while (el.childElementCount < frame.length) {
      const span = doc.createElement("span");
      span.className = "scramble-ch";
      el.append(span);
    }
    for (let i = 0; i < el.childElementCount; i++) {
      const span = el.children[i] as HTMLElement;
      const c = frame[i];
      if (!c) {
        // a character the text no longer has: it fades out where it is
        if (span.dataset.ghost !== "") span.dataset.ghost = "";
        continue;
      }
      if (span.textContent !== c.ch) span.textContent = c.ch;
      if (c.lit) delete span.dataset.ghost;
      else span.dataset.ghost = "";
    }
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
    if (this.gap) this.gap.data = this.showing === "handle" ? "" : this.gapData;
    this.slots.forEach((s, i) => {
      delete s.el.dataset.scrambling;
      if (this.showing === "name") s.el.innerHTML = this.originals[i]!;
      else s.el.textContent = s.handle;
    });
  }
}
