/**
 * Sleigh bells for the `?xmas` Easter egg: a recording ("Bells jingling 2", dragon-studio, trimmed to 3.4 s with a fade-out; `/audio/sleigh-bells.mp3`),
 * played ONCE, faintly, a moment after the picture's start-up begins. It plays only if the browser lets the page (not before the visitor has interacted
 * with it: a refused try is silent) and the picture is in view and the tab visible: if it is not, the try is repeated every second for up to 20 s, so that
 * the bells come when the visitor first sees the picture, and never twice. Stopped, it ends the sound and closes its audio context.
 */
export interface SleighBellsOptions {
  canPlay?: () => boolean;
}

const URL = "/audio/sleigh-bells.mp3";
const VOLUME = 0.3;

export function createSleighBells({ canPlay = () => true }: SleighBellsOptions = {}) {
  let running = false;
  let timer = 0;
  let ctx: AudioContext | null = null;
  let tries = 0;

  const attempt = async () => {
    if (!running) return;
    if (document.hidden || !canPlay() || typeof AudioContext === "undefined") return retry();
    let c: AudioContext;
    try {
      c = new AudioContext();
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      return retry();
    }
    // (not allowed to make sound yet: silent, and the next try may be)
    if (c.state !== "running" || !running) {
      c.close().catch(() => {});
      return retry();
    }
    try {
      const data = await (await fetch(URL)).arrayBuffer();
      const buffer = await c.decodeAudioData(data);
      if (!running) return void c.close().catch(() => {});
      ctx = c;
      const gain = c.createGain();
      gain.gain.value = VOLUME;
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(gain).connect(c.destination);
      src.onended = () => {
        if (ctx === c) ctx = null;
        c.close().catch(() => {});
      };
      src.start();
    } catch {
      c.close().catch(() => {});
    }
  };
  const retry = () => {
    if (!running || ++tries > 20) return;
    timer = window.setTimeout(attempt, 1000);
  };

  return {
    start() {
      if (running) return;
      running = true;
      tries = 0;
      // (a moment after the start-up begins)
      timer = window.setTimeout(attempt, 1500);
    },
    stop() {
      running = false;
      window.clearTimeout(timer);
      const x = ctx;
      ctx = null;
      if (x && x.state !== "closed") x.close().catch(() => {});
    },
  };
}
