import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { nowPlaying, pillVisible, type NowPlayingSnapshot } from "~/globe";
import { cn } from "~/lib/utils";

/**
 * Where the pill sits and how it comes and goes, in one place (owner: "we might iterate on the way it shows"). Its position is the classes of the wrapper below (bottom right of the globe, on the map
 * credits' line (`attribution-button.tsx`: the same right edge, left of the detail panel) and one line above it); when it shows is `pillVisible` (engine/now-playing.ts: a sound that has played and is not done);
 * how long it takes to go is `EXIT_MS` (and `--np-fade` of the `.np` rule in app.css, which follows it).
 */
const EXIT_MS = 400;
const SERVER: NowPlayingSnapshot = { track: null, state: "paused", muted: false };

/**
 * What the page is playing, and the switch for its sound (a "now playing" line): four bars that move while it plays and rest while it waits (the sun is out of the picture) or is off, the
 * title and who made it. The credits are this line: an artist is named wherever a sound is heard. It is ONE button, a `Toggle` in effect: pressed (`aria-pressed`) when the visitor has turned the page's sound
 * off, which strikes the words through and stills the bars; its name does not change with the state. Not there when nothing has played, or when what played is done (the interlude's last note): it fades out.
 * A phone shows the title and the bars (the artist where the line has room: from 480 px), and the touch target is 44 px.
 */
export function NowPlayingPill({ insetRight }: { insetRight: number }) {
  const snap = useSyncExternalStore(nowPlaying.subscribe, nowPlaying.getSnapshot, () => SERVER);
  const visible = pillVisible(snap);
  // the last sound that was shown stays on the screen while the pill fades out
  const last = useRef(snap);
  if (visible) last.current = snap;
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [visible]);
  if (!visible && !mounted) return null;
  const s = visible ? snap : last.current;
  const track = s.track;
  if (!track) return null;
  const credit = track.artist ? `${track.title} by ${track.artist}` : track.title;
  return (
    <div
      data-now-playing
      data-visible={visible}
      data-state={s.state}
      data-muted={s.muted}
      style={{ "--credits-inset": `${insetRight}px`, "--np-fade": `${EXIT_MS}ms`, bottom: "calc(max(0.25rem, env(safe-area-inset-bottom)) + 1.5rem)" } as CSSProperties}
      className={cn(
        "np absolute right-[calc(var(--credits-inset)+0.5rem)] z-20 max-w-[calc(100%-var(--credits-inset)-1rem)] max-md:right-2",
        "font-mono text-[10px] leading-4 tracking-wide text-subtle-foreground",
      )}
    >
      <button
        type="button"
        aria-pressed={s.muted}
        aria-label={`Sound: ${credit}`}
        title={s.muted ? "Sound is off" : "Sound is on"}
        className="relative flex max-w-full cursor-pointer touch-manipulation items-center gap-[1ch] whitespace-nowrap select-none after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-foreground focus-visible:text-foreground md:after:hidden"
        onClick={() => nowPlaying.setMuted(!s.muted)}
      >
        <span className="np-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="min-w-0 truncate" aria-hidden="true">
          <span className="np-title">{track.title}</span>
          {track.artist && <span className="np-artist max-[479px]:hidden"> · {track.artist}</span>}
        </span>
      </button>
    </div>
  );
}
