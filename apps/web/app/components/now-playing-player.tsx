import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "~/components/ui/icon";
import { nowPlaying, pillVisible, type NowPlayingSnapshot, type Track } from "~/globe";

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

/** What the credit line says while the browser will not let the page make sound until the visitor has touched it: it gives way to the credit, with a fade, when the first touch starts the music. */
const WARNING = "Tap anywhere to start the music";

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

/** How many motes drift off a playing disc: few, each its own compositor-only animation (transform and opacity), so the cost is nothing while it plays and none while it rests. */
const MOTES = 9;

/** How big a mote is, in px: at least `min`, and up to `min + range` (owner iterates on how obvious they are). */
const MOTE_PX = { min: 2.5, range: 2 } as const;

/**
 * Where mote `i` goes: a unit vector out of the disc (the golden angle, so that they never bunch), how far it travels, how long it takes, and when it starts (staggered, so that there is always one in flight and
 * never a burst). A function of `i` alone: the same on the server and in the browser.
 */
function mote(i: number): React.CSSProperties {
  const angle = i * 2.399963 + 0.6;
  const unit = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return {
    "--ux": Math.cos(angle).toFixed(3),
    "--uy": Math.sin(angle).toFixed(3),
    "--reach": (0.55 + unit(1) * 0.5).toFixed(2),
    "--mote-size": `${(MOTE_PX.min + unit(2) * MOTE_PX.range).toFixed(1)}px`,
    "--mote-ms": `${Math.round(2600 + unit(3) * 1600)}ms`,
    "--mote-delay": `${Math.round((i / MOTES) * 3200)}ms`,
  } as React.CSSProperties;
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
        <span className="np-disc" aria-hidden="true">
          {track.cover && coverOk ? <img src={track.cover} alt="" draggable={false} onError={() => setCoverOk(false)} /> : <span className="np-label" />}
          <span className="np-groove" />
          <span className="np-hole" />
        </span>
        <span className="np-gloss" aria-hidden="true" />
        <span className="np-motes" aria-hidden="true">
          {Array.from({ length: MOTES }, (_, i) => (
            <span key={i} className="np-mote" style={mote(i)} />
          ))}
        </span>
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
