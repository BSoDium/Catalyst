import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "~/components/ui/icon";
import { nowPlaying, pillVisible, type NowPlayingSnapshot } from "~/globe";
import { cn } from "~/lib/utils";

/**
 * Where the player sits, in one place (owner: "we might iterate on where it shows and when it goes"). A wide screen (from 1180 px) has room: top left, the disc big with the words under it, clear of the header (whose
 * links start at about 230 px at 1280). From 768 px to there it is a compact row (the small disc beside the words) top left under the header, which is a short one there; on a phone the same row is bottom left, under the hero's links (or its name, once the hero has collapsed) and above the map credits' line (`attribution-button.tsx`). When it shows is `pillVisible`
 * (engine/now-playing.ts: a sound that has played and is not done); how it comes, changes and goes is `TRANSITION` below.
 */
// (the classes are written out whole: Tailwind finds them by reading the source, it cannot read a string that is put together)
const PLACEMENT = cn(
  "pointer-events-none absolute z-20",
  "bottom-[calc(max(0.25rem,env(safe-area-inset-bottom))+1.75rem)] left-4 [--np-size:3.25rem]",
  "md:top-[calc(var(--navbar-height)+0.75rem)] md:bottom-auto",
  "min-[1180px]:top-6 min-[1180px]:bottom-auto min-[1180px]:left-6 min-[1180px]:[--np-size:6rem]",
);

/** How a sound comes in, gives way to another, and goes: it fades and blurs (opacity and blur only under reduced motion: no travel). */
const TRANSITION = {
  hidden: { opacity: 0, filter: "blur(14px)", y: 8, scale: 0.97 },
  shown: { opacity: 1, filter: "blur(0px)", y: 0, scale: 1 },
  leaving: { opacity: 0, filter: "blur(14px)", y: -4, scale: 0.98 },
  ms: 0.55,
} as const;

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
  return (
    <div
      data-now-playing
      data-state={snap.state}
      data-muted={snap.muted}
      data-spin={playing}
      data-flash={flash}
      className="np flex items-center gap-3 min-[1180px]:flex-col min-[1180px]:items-start"
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
        <span className="np-icon" aria-hidden="true">
          <Icon name={snap.muted ? "play" : "pause"} size="control" />
        </span>
      </button>
      <div className="np-text min-w-0">
        <p className="np-title">{track.titleHref ? <a href={track.titleHref} target="_blank" rel="noopener noreferrer">{track.title}</a> : track.title}</p>
        {track.artist && <p className="np-artist">{track.artistHref ? <a href={track.artistHref} target="_blank" rel="noopener noreferrer">{track.artist}</a> : track.artist}</p>}
      </div>
    </div>
  );
}
