import { bell } from "./neon";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/**
 * One of the start-up's bell-like clicks, on demand (a "cling", for a change the visitor made: a new colour): a small one, or a big one (a deeper bell with a high one over it). It is made with the same synthesised bell as the
 * start-up's dings, quiet, and only if the browser lets the page make sound (an audio context made in a click is allowed to play; before any interaction it stays silent and nothing else happens). No file.
 */
export function cling(size: "small" | "big" = "small"): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const when = ctx.currentTime + 0.01;
    const pitch = 2700 + Math.random() * 650;
    if (size === "big") {
      bell(ctx, master!, when, 1000 + Math.random() * 150, 0, 2.6);
      bell(ctx, master!, when + 0.03, pitch, 0, 1.6);
    } else {
      bell(ctx, master!, when, pitch, 0, 1.2);
    }
  } catch {
    /* (no audio: nothing to do) */
  }
}
