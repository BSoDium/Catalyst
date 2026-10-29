import { useSyncExternalStore, type CSSProperties } from "react";
import { sunMusic } from "~/globe";
import { Icon } from "~/components/ui/icon";
import { Toggle } from "~/components/ui/toggle";

const SERVER = { muted: false, sunSeen: false, status: "idle" } as const;

/**
 * The switch of the sun's music (`engine/sun-music.ts`): sound is on unless the visitor turns it off here, and what they choose is kept. It is not there until the sun has been in the picture
 * this visit (the music comes with the sun, and a switch for nothing is noise on the home screen), and not at all if there is no music (the file is missing, or the connection saves data).
 * One `Toggle` named "Sound", pressed when it is muted (its name does not change with its state: the icon and `aria-pressed` carry it). Bottom right of the globe, on the map credits' line (`attribution-button.tsx`: the same right edge, left of the detail panel) and one line above it.
 */
export function SunSoundToggle({ insetRight }: { insetRight: number }) {
  const { muted, sunSeen, status } = useSyncExternalStore(sunMusic.subscribe, sunMusic.getSnapshot, () => SERVER);
  if (!sunSeen || status === "failed") return null;
  return (
    <div
      data-sun-sound
      style={{ "--credits-inset": `${insetRight}px`, bottom: "calc(max(0.25rem, env(safe-area-inset-bottom)) + 1.5rem)" } as CSSProperties}
      className="absolute right-[calc(var(--credits-inset)+0.5rem)] z-20 animate-[sun-sound-in_1.2s_var(--ease-standard)_both] motion-reduce:animate-none max-md:right-2"
    >
      <Toggle variant="ghost" size="sm" icon pressed={muted} onPressedChange={(next) => sunMusic.setMuted(next)} aria-label="Mute sound" title={muted ? "Sound is off" : "Sound is on"}>
        <Icon name={muted ? "sound-off" : "sound"} size="control" />
      </Toggle>
    </div>
  );
}
