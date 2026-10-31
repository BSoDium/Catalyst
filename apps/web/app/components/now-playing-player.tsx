import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, useSyncExternalStore } from "react";
import { IconButton } from "~/components/ui/icon-button";
import { nowPlaying, pillVisible, type NowPlayingSnapshot, type Track } from "~/globe";

/**
 * Where the player sits (`.np-root`, app.css), in one place (owner: "we might iterate on where it shows and when it goes"): docked in the top left corner when there is room, and moved down under the header when the header
 * needs the corner. The header's links are centred and 816 px wide, so they start at (width - 816) / 2: from 1280 px the player is in the corner (`--np-inset`, 1.25rem: room for the halo to flow), its words taking the room
 * the links leave and cut with an ellipsis past it. Narrower (a tablet, a phone, where the header is a short "01 Globe / Search" row) it is the same row under the header, 0.75rem under it when the header is there, and at the
 * top of the screen when it is not (the home screen at rest has none: `body:has([data-slot="site-header"])`). The disc is 2.35rem at every size (as tall as the two lines beside it). It is a row (the disc on the left, the
 * title and the artist on its right) at every size, so it is never over the hero's text at the bottom.
 */
const PLACEMENT = "np-root pointer-events-none absolute z-20";

/** How a sound comes in, gives way to another, and goes: it fades and blurs (opacity and blur only under reduced motion: no travel). */
const TRANSITION = {
  hidden: { opacity: 0, filter: "blur(14px)", y: 8, scale: 0.97 },
  shown: { opacity: 1, filter: "blur(0px)", y: 0, scale: 1 },
  leaving: { opacity: 0, filter: "blur(14px)", y: -4, scale: 0.98 },
  ms: 0.55,
} as const;

/** What the credit line says (it is ONE line, like the credit it replaces: the text beside the disc must not change height, and `.np-warn` does not wrap) while the browser will not let the page make sound until the visitor has touched it: it gives way to the credit, with a fade, when the first touch starts the music. */
const WARNING = "Click anywhere to start";
/** The same on a touch screen (owner: "Touch anywhere" for mobile): the primary pointer is a finger. */
const WARNING_TOUCH = "Touch anywhere to start";
const touchPrimary = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

const SERVER: NowPlayingSnapshot = { track: null, state: "paused", muted: false };

/**
 * What the page is playing, as a record: the sleeve, a square with the system's hairline (#434), the title beside it with its state (bars that move while the sound plays, the play glyph while it waits or is paused) (a link to the song)
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
  const credit = track.artist ? `${track.title} by ${track.artist}` : track.title;
  const blocked = snap.state === "blocked" && !snap.muted;
  const [coverOk, setCoverOk] = useState(true);
  return (
    <div data-now-playing data-state={snap.state} data-muted={snap.muted} data-blocked={blocked} className="np flex items-center gap-2.5">
      <span className="np-disc" aria-hidden="true">
        {track.cover && coverOk ? <img src={track.cover} alt="" draggable={false} onError={() => setCoverOk(false)} /> : <span className="np-label" />}
      </span>
      <div className="np-text min-w-0" title={track.note ?? credit}>
        <p className="np-title">{track.titleHref ? <a href={track.titleHref} target="_blank" rel="noopener noreferrer">{track.title}</a> : track.title}</p>
        <AnimatePresence mode="wait" initial={false}>
          {blocked ? (
            <motion.p key="blocked" role="status" className="np-artist np-warn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
              {touchPrimary() ? WARNING_TOUCH : WARNING}
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
      <IconButton
        variant="ghost"
        className="np-toggle"
        icon={snap.muted ? "play" : "pause"}
        label={snap.muted ? `Play ${credit}` : `Pause ${credit}`}
        onClick={() => nowPlaying.setMuted(!snap.muted)}
      />
    </div>
  );
}
