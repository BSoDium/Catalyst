/** The words that ask the palette for the sound row (#587): "mute", "unmute", "music", "sound", "audio", "volume", "silence". */
const SOUND_WORDS = ["mute", "unmute", "music", "sound", "audio", "volume", "silence", "quiet", "speaker"] as const;

/** Whether `query` is about the page's sound: every word of it starts a sound word, or is started by one (two letters at least). */
export function matchesSound(query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  return words.every((w) => w.length >= 2 && SOUND_WORDS.some((s) => s.startsWith(w) || w.startsWith(s)));
}
