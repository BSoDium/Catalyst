import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "~/components/ui/icon";
import { TRACKS, nowPlaying, pillVisible, sunMusic, type NowPlayingSnapshot, type Track } from "~/globe";

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
  const halo = useRef<HTMLSpanElement>(null);
  const credit = track.artist ? `${track.title} by ${track.artist}` : track.title;
  const playing = snap.state === "playing" && !snap.muted;
  const blocked = snap.state === "blocked" && !snap.muted;
  // how far the halo reaches follows the sun's music's level (the interlude's sound has none to read: the halo's own, steady): one custom property, written when it moves, while the disc plays
  const sun = track.id === TRACKS.sun.id;
  useEffect(() => {
    const el = halo.current;
    if (!playing || !sun || reduced || !el) return;
    let raf = 0;
    let last = -1;
    const frame = () => {
      const level = sunMusic.pulse()?.energy ?? 0;
      if (Math.abs(level - last) > 0.01) {
        last = level;
        el.style.setProperty("--np-level", level.toFixed(2));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, sun, reduced]);
  const [coverOk, setCoverOk] = useState(true);
  // a touch screen has no hover to show the icon with: it shows for a moment after a tap
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(false), 1100);
    return () => window.clearTimeout(id);
  }, [flash]);
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
        <span ref={halo} className="np-halo" aria-hidden="true">
          <span className="np-halo-a" />
          <span className="np-halo-b" />
          <span className="np-halo-c" />
        </span>
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
