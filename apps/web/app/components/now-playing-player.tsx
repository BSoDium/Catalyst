import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { outlinePoints } from "~/lib/now-playing-wave";
import { Icon } from "~/components/ui/icon";
import { TRACKS, artPixelNow, nowPlaying, pillVisible, sunMusic, type NowPlayingSnapshot, type Track } from "~/globe";

/**
 * Where the player sits (`.np-root`, app.css), in one place (owner: "we might iterate on where it shows and when it goes"): docked in the top left corner when there is room, and moved down under the header when the header
 * needs the corner. The header's links are centred and 816 px wide, so they start at about 230 px at 1280; the player, its longest line included, ends at about 215: from 1280 px it is in the corner, the disc 3rem. Narrower
 * (a tablet, a phone, where the header is a short "01 Globe / Search" row) it is the same row, the disc 2.5rem, under the header: 0.5rem under it when the header is there, and at the top of the screen when it is not (the
 * home screen at rest has none: `body:has([data-slot="site-header"])`). It is a row (the disc on the left, the title and the artist on its right) at every size, so it is never over the hero's text at the bottom.
 */
const PLACEMENT = "np-root pointer-events-none absolute z-20";

/** How a sound comes in, gives way to another, and goes: it fades and blurs (opacity and blur only under reduced motion: no travel). */
const TRANSITION = {
  hidden: { opacity: 0, filter: "blur(14px)", y: 8, scale: 0.97 },
  shown: { opacity: 1, filter: "blur(0px)", y: 0, scale: 1 },
  leaving: { opacity: 0, filter: "blur(14px)", y: -4, scale: 0.98 },
  ms: 0.55,
} as const;

/** What the credit line says (it is ONE line: the text beside the disc must not change height, so it is short and `.np-warn` does not wrap) while the browser will not let the page make sound until the visitor has touched it: it gives way to the credit, with a fade, when the first touch starts the music. */
const WARNING = "Click anywhere to start";

const SERVER: NowPlayingSnapshot = { track: null, state: "paused", muted: false };

/**
 * What the page is playing, as a record: the sleeve in a disc that turns while the sound plays and rests while it waits (the sun is out of the picture) or is paused, the title under it (a link to the song)
 * and who made it under that (a link to their page). Clicking the disc plays or pauses the page's sound (`NowPlaying.setMuted`: ONE choice for all of it; a sound that is the picture's, the interlude's, takes it from
 * where it is: it cannot be paused, only silenced), and hovering it shows which. A touch screen has no hover: the icon is shown for a moment after a tap. It is there only while a sound has played and is not done;
 * one sound gives way to the next, and no sound to a sound, with a fade and a blur.
 */
export function NowPlayingPlayer() {
  const snap = useSyncExternalStore(nowPlaying.subscribe, nowPlaying.getSnapshot, () => SERVER);
  const reduced = useReducedMotion();
  const track = pillVisible(snap) ? snap.track : null;
  const t = reduced ? { opacity: 0 } : TRANSITION.hidden;
  return (
    <div data-now-playing-root className={PLACEMENT}>
      <AnimatePresence mode="wait">
        {track && (
          <motion.div
            key={track.id}
            className="pointer-events-auto w-fit max-w-full"
            initial={t}
            animate={reduced ? { opacity: 1 } : TRANSITION.shown}
            exit={reduced ? { opacity: 0 } : TRANSITION.leaving}
            transition={{ duration: TRANSITION.ms, ease: [0.2, 0, 0, 1] }}
          >
            <Player snap={snap} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The wavy outline round a playing disc (owner, 2026-10-29: it replaced the glow, the motes, a turning pair of rings, and a thin line): a SHAPE a little way off the disc, filled with a soft grey close to the page's colour
 * and edged with a lighter line, as a raised surface is, whose outline shivers in place with the music (lib/now-playing-wave.ts: standing waves, nothing turns). It is PIXELATED to the globe's own grid (`artPixelNow`: the
 * art pixel, 2.5 CSS px on a desktop, 2 on a phone): it is drawn at one canvas pixel to a cell, with no smoothing (the shape and its edge are cut at half a pixel, so that none is blended), and the canvas is scaled up with
 * `image-rendering: pixelated`. The disc is not: it is above it, as sharp as it was. It is the one thing here drawn by script: a frame loop that fills a canvas of a few hundred pixels, no layout, no React render, run only while
 * the disc plays and motion is wanted. The sun's music's level moves it (`SunMusic.pulse().energy`); the interlude's sound has none to read, and it shivers at rest. Colours are the canvas's own `color` (the fill) and
 * `border-color` (the edge), set in CSS (`.np-waves`), read again about twice a second (a change of theme).
 */
const WAVES_BOX = 1.5; // (the canvas, in disc diameters)

/** A CSS colour as bytes (the canvas resolves whatever the page's CSS computed to: `color-mix` included). */
function rgbOf(probe: CanvasRenderingContext2D, color: string): [number, number, number] {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!];
}

function Waves({ active, sun }: { active: boolean; sun: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!active || !canvas) return;
    const out = canvas.getContext("2d");
    const mask = document.createElement("canvas");
    const m = mask.getContext("2d", { willReadFrequently: true });
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!out || !m || !probe) return;
    probe.canvas.width = probe.canvas.height = 1;
    let n = 0;
    let fill: [number, number, number] = [0, 0, 0];
    let edge: [number, number, number] = [0, 0, 0];
    let image: ImageData | null = null;
    // (the size of the grid, and the colours: when they change, and now and then)
    const measure = () => {
      const cell = artPixelNow();
      const disc = canvas.parentElement!.getBoundingClientRect().width || 40;
      const size = Math.max(8, Math.round((disc * WAVES_BOX) / cell));
      if (size !== n) {
        n = size;
        canvas.width = mask.width = n;
        canvas.height = mask.height = n;
        image = out.createImageData(n, n);
      }
      // (a whole number of cells, centred on the disc by CSS)
      canvas.style.width = canvas.style.height = `${n * cell}px`;
      const css = getComputedStyle(canvas);
      fill = rgbOf(probe, css.color);
      edge = rgbOf(probe, css.borderTopColor);
    };
    const path = (t: number, level: number) => {
      const p = outlinePoints(t, level, n);
      m.beginPath();
      for (let i = 0; i < p.length; i += 2) (i === 0 ? m.moveTo : m.lineTo).call(m, p[i]!, p[i + 1]!);
      m.closePath();
    };
    let raf = 0;
    let frames = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      if (frames++ % 30 === 0) measure();
      const t = (now - t0) / 1000;
      const level = sun ? (sunMusic.pulse()?.energy ?? 0) : 0;
      const px = image!.data;
      // (the shape: filled, then the edge: the same line stroked a cell wide, each cut at half coverage so that no pixel is blended)
      m.clearRect(0, 0, n, n);
      path(t, level);
      m.fillStyle = "#000";
      m.fill();
      const shape = m.getImageData(0, 0, n, n).data;
      m.clearRect(0, 0, n, n);
      path(t, level);
      m.lineWidth = 1;
      m.strokeStyle = "#000";
      m.stroke();
      const line = m.getImageData(0, 0, n, n).data;
      for (let i = 0; i < n * n; i++) {
        const o = i * 4 + 3;
        const c = line[o]! > 100 ? edge : shape[o]! > 127 ? fill : null;
        px[o - 3] = c ? c[0] : 0;
        px[o - 2] = c ? c[1] : 0;
        px[o - 1] = c ? c[2] : 0;
        px[o] = c ? 255 : 0;
      }
      out.putImageData(image!, 0, 0);
      raf = requestAnimationFrame(frame);
    };
    measure();
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, sun]);
  return <canvas ref={ref} className="np-waves" aria-hidden="true" />;
}

/** The credit: each artist is a link to their page where they have one, joined as they are named. */
function Artists({ track }: { track: Track }) {
  const artists = track.artists;
  if (!artists) return <>{track.artist}</>;
  return (
    <>
      {artists.map((a, i) => (
        <span key={a.name}>
          {i > 0 && (i === artists.length - 1 ? " & " : ", ")}
          {a.href ? <a href={a.href} target="_blank" rel="noopener noreferrer">{a.name}</a> : a.name}
        </span>
      ))}
    </>
  );
}

function Player({ snap }: { snap: NowPlayingSnapshot }) {
  const track = snap.track!;
  const reduced = useReducedMotion();
  const [coverOk, setCoverOk] = useState(true);
  // a touch screen has no hover to show the icon with: it shows for a moment after a tap
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(false), 1100);
    return () => window.clearTimeout(id);
  }, [flash]);
  const credit = track.artist ? `${track.title} by ${track.artist}` : track.title;
  const playing = snap.state === "playing" && !snap.muted;
  const blocked = snap.state === "blocked" && !snap.muted;
  return (
    <div
      data-now-playing
      data-state={snap.state}
      data-muted={snap.muted}
      data-spin={playing}
      data-blocked={blocked}
      data-flash={flash}
      className="np flex items-center gap-2.5"
    >
      <button
        type="button"
        aria-pressed={!snap.muted}
        aria-label={`Play ${credit}`}
        className="np-disc-btn"
        onClick={() => {
          nowPlaying.setMuted(!snap.muted);
          setFlash(true);
        }}
      >
        <Waves active={playing && !reduced} sun={track.id === TRACKS.sun.id} />
        <span className="np-disc" aria-hidden="true">
          {track.cover && coverOk ? <img src={track.cover} alt="" draggable={false} onError={() => setCoverOk(false)} /> : <span className="np-label" />}
          <span className="np-groove" />
          <span className="np-hole" />
        </span>
        <span className="np-gloss" aria-hidden="true" />
        <span className="np-icon" aria-hidden="true">
          <Icon name={snap.muted ? "play" : "pause"} size="control" />
        </span>
      </button>
      <div className="np-text min-w-0" title={track.note}>
        <p className="np-title">{track.titleHref ? <a href={track.titleHref} target="_blank" rel="noopener noreferrer">{track.title}</a> : track.title}</p>
        <AnimatePresence mode="wait" initial={false}>
          {blocked ? (
            <motion.p key="blocked" role="status" className="np-artist np-warn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
              {WARNING}
            </motion.p>
          ) : (
            track.artist && (
              <motion.p key="artist" className="np-artist" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                <Artists track={track} />
              </motion.p>
            )
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
