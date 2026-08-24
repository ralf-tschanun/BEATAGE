import { cookies } from "next/headers";
import { getRequestSiteUrl, getSiteUrl } from "@/lib/site-url";

const COOKIE_NAME = "beatage_spotify_user";
const SCOPES = [
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

type RequestLike = {
  headers: Headers;
};

export type SpotifyUserTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
};

function getSpotifyCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isSpotifyConnectConfigured(): boolean {
  return getSpotifyCredentials() != null;
}

/** OAuth redirect_uri — gosmooth in prod / loopback locally; never *.vercel.app. */
export function getSpotifyConnectRedirectUri(request?: RequestLike): string {
  const base = request ? getRequestSiteUrl(request) : getSiteUrl();
  return `${base}/api/spotify/callback`;
}

export function buildSpotifyConnectUrl(opts: {
  state: string;
  request?: RequestLike;
}): string | null {
  const credentials = getSpotifyCredentials();
  if (!credentials) return null;
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", getSpotifyConnectRedirectUri(opts.request));
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("show_dialog", "true");
  return url.toString();
}

export async function exchangeSpotifyAuthCode(
  code: string,
  request?: RequestLike,
): Promise<SpotifyUserTokens | null> {
  const credentials = getSpotifyCredentials();
  if (!credentials) return null;

  const basic = Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getSpotifyConnectRedirectUri(request),
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token || !data.refresh_token) return null;

  const expiresInSec =
    typeof data.expires_in === "number" && data.expires_in > 0
      ? data.expires_in
      : 3600;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };
}

async function refreshSpotifyAccessToken(
  refreshToken: string,
): Promise<SpotifyUserTokens | null> {
  const credentials = getSpotifyCredentials();
  if (!credentials) return null;

  const basic = Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return null;

  const expiresInSec =
    typeof data.expires_in === "number" && data.expires_in > 0
      ? data.expires_in
      : 3600;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };
}

export async function readSpotifyUserTokens(): Promise<SpotifyUserTokens | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SpotifyUserTokens;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.expiresAtMs !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeSpotifyUserTokens(
  tokens: SpotifyUserTokens,
): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, JSON.stringify(tokens), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSpotifyUserTokens(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getValidSpotifyUserAccessToken(): Promise<string | null> {
  const tokens = await readSpotifyUserTokens();
  if (!tokens) return null;

  if (tokens.expiresAtMs > Date.now() + 60_000) {
    return tokens.accessToken;
  }

  const refreshed = await refreshSpotifyAccessToken(tokens.refreshToken);
  if (!refreshed) {
    await clearSpotifyUserTokens();
    return null;
  }
  await writeSpotifyUserTokens(refreshed);
  return refreshed.accessToken;
}

export type SpotifyPlayResult =
  | { ok: true; deviceId?: string }
  | {
      ok: false;
      code: "not_connected" | "no_device" | "premium_required" | "failed";
      message: string;
    };

/** Active or first available Connect device. */
async function resolveSpotifyDeviceId(
  accessToken: string,
): Promise<
  | { ok: true; deviceId: string }
  | { ok: false; code: "not_connected" | "no_device"; message: string }
> {
  const devicesResponse = await fetch(
    "https://api.spotify.com/v1/me/player/devices",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  if (devicesResponse.status === 401) {
    await clearSpotifyUserTokens();
    return {
      ok: false,
      code: "not_connected",
      message: "Spotify session expired. Connect again.",
    };
  }

  const devicesData = (await devicesResponse.json().catch(() => null)) as {
    devices?: Array<{
      id?: string | null;
      is_active?: boolean;
      is_restricted?: boolean;
    }>;
  } | null;

  const devices = (devicesData?.devices ?? []).filter(
    (device): device is { id: string; is_active?: boolean } =>
      typeof device.id === "string" &&
      device.id.length > 0 &&
      device.is_restricted !== true,
  );

  const deviceId =
    devices.find((device) => device.is_active)?.id ?? devices[0]?.id ?? null;

  if (!deviceId) {
    return {
      ok: false,
      code: "no_device",
      message:
        "Open the Spotify app on this computer (same account), leave it running, then try again.",
    };
  }

  return { ok: true, deviceId };
}

function mapPlayerFailure(
  status: number,
  body: string,
  fallback: string,
): SpotifyPlayResult {
  if (/premium required/i.test(body)) {
    return {
      ok: false,
      code: "premium_required",
      message: "Spotify Premium is required to control playback from BEATAGE.",
    };
  }
  if (/restriction violated/i.test(body) || status === 403) {
    return {
      ok: false,
      code: "failed",
      message:
        "Spotify blocked that command. Click play once in the Spotify app, then try again from BEATAGE.",
    };
  }
  if (status === 404) {
    return {
      ok: false,
      code: "no_device",
      message:
        "Open the Spotify app on this computer (same account), leave it running, then try again.",
    };
  }
  // Never surface raw Spotify payloads / device ids in the UI.
  return {
    ok: false,
    code: "failed",
    message: fallback,
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function putPlay(
  accessToken: string,
  deviceId: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  const playUrl = new URL("https://api.spotify.com/v1/me/player/play");
  if (deviceId) playUrl.searchParams.set("device_id", deviceId);
  return fetch(playUrl.toString(), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

async function putPause(
  accessToken: string,
  deviceId: string | null,
): Promise<Response> {
  const pauseUrl = new URL("https://api.spotify.com/v1/me/player/pause");
  if (deviceId) pauseUrl.searchParams.set("device_id", deviceId);
  return fetch(pauseUrl.toString(), {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
}

function isSuccessStatus(status: number) {
  return status === 204 || status === 202 || status === 200;
}

function isRestriction(status: number, body: string) {
  return status === 403 && /restriction violated/i.test(body);
}

/** Start a track on the user's Spotify device (Connect API). */
export async function playSpotifyTrackForUser(
  trackUri: string,
): Promise<SpotifyPlayResult> {
  const uri = trackUri.trim().replace(/:play$/i, "");
  if (!uri.startsWith("spotify:track:")) {
    return { ok: false, code: "failed", message: "Invalid Spotify track URI." };
  }

  const accessToken = await getValidSpotifyUserAccessToken();
  if (!accessToken) {
    return {
      ok: false,
      code: "not_connected",
      message: "Connect Spotify once to play tracks from the host dashboard.",
    };
  }

  const device = await resolveSpotifyDeviceId(accessToken);
  if (!device.ok) return device;

  // Keep this small: try with device, then without, then resume.
  // "Restriction violated" often happens after pause→play with device_id + uris.
  const attempts: Array<{ deviceId: string | null; body: Record<string, unknown> }> = [
    { deviceId: device.deviceId, body: { uris: [uri] } },
    { deviceId: null, body: { uris: [uri] } },
    { deviceId: null, body: {} },
  ];

  let lastStatus = 0;
  let lastBody = "";

  for (let i = 0; i < attempts.length; i += 1) {
    if (i > 0) await sleep(400);
    const attempt = attempts[i]!;
    const response = await putPlay(accessToken, attempt.deviceId, attempt.body);

    if (isSuccessStatus(response.status)) {
      return { ok: true, deviceId: device.deviceId };
    }
    if (response.status === 401) {
      await clearSpotifyUserTokens();
      return {
        ok: false,
        code: "not_connected",
        message: "Spotify session expired. Connect again.",
      };
    }

    lastStatus = response.status;
    lastBody = await response.text().catch(() => "");

    // Premium is final; restriction / 404 → try next strategy.
    if (/premium required/i.test(lastBody)) {
      return mapPlayerFailure(lastStatus, lastBody, "Could not start Spotify playback.");
    }
    if (isRestriction(lastStatus, lastBody) || lastStatus === 404) {
      continue;
    }
    // Other errors: stop early.
    break;
  }

  return mapPlayerFailure(
    lastStatus,
    lastBody,
    "Could not start Spotify playback.",
  );
}

/** Pause on the user's Spotify device (Connect API). */
export async function pauseSpotifyPlaybackForUser(
  _preferredDeviceId?: string | null,
): Promise<SpotifyPlayResult> {
  const accessToken = await getValidSpotifyUserAccessToken();
  if (!accessToken) {
    return {
      ok: false,
      code: "not_connected",
      message: "Connect Spotify once to control playback from the host dashboard.",
    };
  }

  // Always resolve a fresh device — cached client device ids often cause
  // "Restriction violated" after the first play/pause cycle.
  const device = await resolveSpotifyDeviceId(accessToken);
  if (!device.ok) return device;

  let response = await putPause(accessToken, device.deviceId);
  if (!isSuccessStatus(response.status)) {
    const firstBody = await response.clone().text().catch(() => "");
    if (isRestriction(response.status, firstBody) || response.status === 404) {
      await sleep(300);
      response = await putPause(accessToken, null);
    }
  }

  if (isSuccessStatus(response.status)) {
    return { ok: true, deviceId: device.deviceId };
  }
  if (response.status === 401) {
    await clearSpotifyUserTokens();
    return {
      ok: false,
      code: "not_connected",
      message: "Spotify session expired. Connect again.",
    };
  }

  const errText = await response.text().catch(() => "");
  if (/premium required/i.test(errText)) {
    return mapPlayerFailure(
      response.status,
      errText,
      "Could not pause Spotify playback.",
    );
  }
  // Spotify often pauses successfully while still returning a non-2xx status
  // (403 restriction, 502 blips, etc.). Host UI only needs "paused".
  return { ok: true, deviceId: device.deviceId };
}


export type SpotifyCurrentlyPlaying = {
  isPlaying: boolean;
  spotifyTrackId: string;
  title: string;
  artist: string;
  albumArtUrl: string | null;
  releaseYear: number | null;
  progressMs: number;
  durationMs: number;
};

function parseReleaseYear(releaseDate: string | undefined | null): number | null {
  if (!releaseDate || typeof releaseDate !== "string") return null;
  const year = Number(releaseDate.slice(0, 4));
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? year : null;
}

/** Read the host's currently playing Spotify track (Connect). */
export async function getCurrentlyPlayingForUser(): Promise<
  | { ok: true; playing: false }
  | { ok: true; playing: true; track: SpotifyCurrentlyPlaying }
  | { ok: false; code: "not_connected" | "failed"; message: string }
> {
  const accessToken = await getValidSpotifyUserAccessToken();
  if (!accessToken) {
    return {
      ok: false,
      code: "not_connected",
      message: "Connect Spotify once to use Auto Spotify mode.",
    };
  }

  const response = await fetch(
    "https://api.spotify.com/v1/me/player/currently-playing",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );

  if (response.status === 204) {
    return { ok: true, playing: false };
  }
  if (response.status === 401) {
    await clearSpotifyUserTokens();
    return {
      ok: false,
      code: "not_connected",
      message: "Spotify session expired. Connect again.",
    };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      code: "failed",
      message: body.slice(0, 160) || "Could not read Spotify now playing.",
    };
  }

  const data = (await response.json().catch(() => null)) as {
    is_playing?: boolean;
    progress_ms?: number;
    item?: {
      id?: string;
      name?: string;
      duration_ms?: number;
      artists?: Array<{ name?: string }>;
      album?: {
        images?: Array<{ url?: string }>;
        release_date?: string;
      };
      type?: string;
    } | null;
  } | null;

  const item = data?.item;
  if (!item || item.type === "episode" || typeof item.id !== "string" || !item.id) {
    return { ok: true, playing: false };
  }

  const artist =
    (item.artists ?? [])
      .map((a) => a.name?.trim())
      .filter((name): name is string => Boolean(name))
      .join(", ") || "Unknown artist";

  return {
    ok: true,
    playing: true,
    track: {
      isPlaying: Boolean(data?.is_playing),
      spotifyTrackId: item.id,
      title: item.name?.trim() || "Unknown track",
      artist,
      albumArtUrl: item.album?.images?.[0]?.url ?? null,
      releaseYear: parseReleaseYear(item.album?.release_date),
      progressMs: typeof data?.progress_ms === "number" ? data.progress_ms : 0,
      durationMs: typeof item.duration_ms === "number" ? item.duration_ms : 0,
    },
  };
}

/** Skip to the next track in the user's Spotify queue. */
export async function skipToNextSpotifyTrackForUser(): Promise<SpotifyPlayResult> {
  const accessToken = await getValidSpotifyUserAccessToken();
  if (!accessToken) {
    return {
      ok: false,
      code: "not_connected",
      message: "Connect Spotify once to control playback from the host dashboard.",
    };
  }

  const device = await resolveSpotifyDeviceId(accessToken);
  const url = new URL("https://api.spotify.com/v1/me/player/next");
  if (device.ok) url.searchParams.set("device_id", device.deviceId);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (isSuccessStatus(response.status) || response.status === 204) {
    return { ok: true, deviceId: device.ok ? device.deviceId : undefined };
  }
  if (response.status === 401) {
    await clearSpotifyUserTokens();
    return {
      ok: false,
      code: "not_connected",
      message: "Spotify session expired. Connect again.",
    };
  }

  // Retry without device_id
  if (device.ok) {
    const retry = await fetch("https://api.spotify.com/v1/me/player/next", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (isSuccessStatus(retry.status) || retry.status === 204) {
      return { ok: true };
    }
  }

  const errText = await response.text().catch(() => "");
  return mapPlayerFailure(response.status, errText, "Could not skip to next track.");
}
