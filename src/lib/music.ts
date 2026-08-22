export type ItunesTrackResult = {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string | null;
  artworkUrl: string | null;
  /** ~30s preview clip; playable without an Apple ID */
  previewUrl: string | null;
};

/** Prefer HTTPS for browser audio playback. */
export function normalizePreviewUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  return url.trim().replace(/^http:\/\//i, "https://");
}
