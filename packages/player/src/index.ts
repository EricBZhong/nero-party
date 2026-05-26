import type { TrackSourceType } from "@nero/shared";

export interface SearchTrack {
  sourceType: TrackSourceType;
  sourceId: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  streamUrl: string | null;
  durationSeconds: number;
  permalinkUrl?: string;
}

export interface AudiusTrackResponse {
  id: string;
  track_id?: number;
  title: string;
  duration: number;
  permalink?: string;
  artwork?: {
    "150x150"?: string;
    "480x480"?: string;
    "1000x1000"?: string;
  } | null;
  stream?: {
    url?: string;
  } | null;
  user?: {
    name?: string;
    handle?: string;
  } | null;
}

export interface AudiusClientOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export interface SpotifyClientOptions {
  apiBase?: string;
  accountsBase?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  fetchImpl?: typeof fetch;
}

export interface SpotifyTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
  tokenType: string;
}

export interface SpotifyProfile {
  id: string;
  displayName: string;
}

interface SpotifyTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface SpotifyProfileResponse {
  id: string;
  display_name?: string | null;
}

interface SpotifyTrackResponse {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  external_urls?: {
    spotify?: string;
  };
  album?: {
    images?: Array<{
      url: string;
      height?: number | null;
      width?: number | null;
    }>;
  };
  artists?: Array<{
    name: string;
  }>;
}

interface SpotifySearchResponse {
  tracks?: {
    items?: SpotifyTrackResponse[];
  };
}

export class AudiusClient {
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AudiusClientOptions = {}) {
    this.apiBase = options.apiBase ?? "https://api.audius.co/v1";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async searchTracks(query: string, limit = 12): Promise<SearchTrack[]> {
    const url = new URL(`${this.apiBase}/tracks/search`);
    url.searchParams.set("query", query);
    url.searchParams.set("limit", String(limit));
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Audius search failed with ${response.status}`);
    }
    const payload = (await response.json()) as { data?: AudiusTrackResponse[] };
    return (payload.data ?? [])
      .filter((track) => track.stream?.url && track.duration > 0)
      .map((track) => this.mapTrack(track));
  }

  async getTrack(trackId: string): Promise<SearchTrack | null> {
    const response = await this.fetchImpl(`${this.apiBase}/tracks/${encodeURIComponent(trackId)}`);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Audius track lookup failed with ${response.status}`);
    }
    const payload = (await response.json()) as { data?: AudiusTrackResponse };
    return payload.data ? this.mapTrack(payload.data) : null;
  }

  private mapTrack(track: AudiusTrackResponse): SearchTrack {
    return {
      sourceType: "audius",
      sourceId: track.id,
      title: track.title,
      artist: track.user?.name ?? track.user?.handle ?? "Audius artist",
      artworkUrl: track.artwork?.["480x480"] ?? track.artwork?.["150x150"] ?? null,
      streamUrl: track.stream?.url ?? null,
      durationSeconds: track.duration,
      permalinkUrl: track.permalink ? `https://audius.co${track.permalink}` : undefined,
    };
  }
}

export class SpotifyClient {
  private readonly apiBase: string;
  private readonly accountsBase: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly fetchImpl: typeof fetch;
  private clientCredentialsToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(options: SpotifyClientOptions = {}) {
    this.apiBase = options.apiBase ?? "https://api.spotify.com/v1";
    this.accountsBase = options.accountsBase ?? "https://accounts.spotify.com";
    this.clientId = options.clientId ?? "";
    this.clientSecret = options.clientSecret ?? "";
    this.redirectUri = options.redirectUri ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.redirectUri);
  }

  buildAuthorizationUrl(state: string, scope: string): string {
    this.assertConfigured();
    const url = new URL(`${this.accountsBase}/authorize`);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", state);
    url.searchParams.set("show_dialog", "true");
    return url.toString();
  }

  async exchangeCode(code: string): Promise<SpotifyTokenSet> {
    this.assertConfigured();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
    });
    return this.requestToken(body);
  }

  async refreshAccessToken(refreshToken: string): Promise<SpotifyTokenSet> {
    this.assertConfigured();
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return this.requestToken(body);
  }

  async getProfile(accessToken: string): Promise<SpotifyProfile> {
    const response = await this.fetchImpl(`${this.apiBase}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Spotify profile lookup failed with ${response.status}`);
    }
    const profile = (await response.json()) as SpotifyProfileResponse;
    return {
      id: profile.id,
      displayName: profile.display_name ?? "Spotify host",
    };
  }

  async searchTracks(query: string, accessToken?: string, limit = 10): Promise<SearchTrack[]> {
    const token = accessToken ?? (await this.getClientCredentialsAccessToken());
    const url = new URL(`${this.apiBase}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("type", "track");
    url.searchParams.set("limit", String(limit));
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Spotify search failed with ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const payload = (await response.json()) as SpotifySearchResponse;
    return (payload.tracks?.items ?? []).map((track) => this.mapTrack(track));
  }

  async addToQueue(accessToken: string, uri: string, deviceId?: string | null): Promise<void> {
    const url = new URL(`${this.apiBase}/me/player/queue`);
    url.searchParams.set("uri", uri);
    if (deviceId) url.searchParams.set("device_id", deviceId);
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 204) return;
    if (response.status === 404) {
      throw new Error("Spotify has no active host device. Open Spotify on the host machine or phone, then try again.");
    }
    if (response.status === 403) {
      throw new Error("Spotify refused playback control. Use a Premium, allowlisted host account for this demo.");
    }
    if (response.status === 429) {
      throw new Error("Spotify rate-limited queue control. Wait a moment and try again.");
    }
    throw new Error(`Spotify queue failed with ${response.status}`);
  }

  async playUri(accessToken: string, uri: string, deviceId?: string | null, positionMs = 0): Promise<void> {
    const url = new URL(`${this.apiBase}/me/player/play`);
    if (deviceId) url.searchParams.set("device_id", deviceId);
    const response = await this.fetchImpl(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: [uri], position_ms: Math.max(0, Math.floor(positionMs)) }),
    });
    if (response.status === 204) return;
    if (response.status === 404) {
      throw new Error("Spotify has no active device for this listener. Open Spotify on that device, then try again.");
    }
    if (response.status === 403) {
      throw new Error("Spotify refused playback control. Use a Premium, allowlisted account for this demo.");
    }
    if (response.status === 429) {
      throw new Error("Spotify rate-limited playback control. Wait a moment and try again.");
    }
    throw new Error(`Spotify playback failed with ${response.status}`);
  }

  private async getClientCredentialsAccessToken(): Promise<string> {
    this.assertConfigured();
    const now = Date.now();
    if (this.clientCredentialsToken && this.clientCredentialsToken.expiresAt - now > 60_000) {
      return this.clientCredentialsToken.accessToken;
    }
    const token = await this.requestToken(new URLSearchParams({ grant_type: "client_credentials" }));
    this.clientCredentialsToken = { accessToken: token.accessToken, expiresAt: token.expiresAt };
    return token.accessToken;
  }

  private async requestToken(body: URLSearchParams): Promise<SpotifyTokenSet> {
    const response = await this.fetchImpl(`${this.accountsBase}/api/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const payload = (await response.json()) as SpotifyTokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new Error(payload.error_description ?? payload.error ?? `Spotify token exchange failed with ${response.status}`);
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: Date.now() + Math.max(1, payload.expires_in ?? 3600) * 1000,
      scope: payload.scope,
      tokenType: payload.token_type ?? "Bearer",
    };
  }

  private mapTrack(track: SpotifyTrackResponse): SearchTrack {
    const artwork = [...(track.album?.images ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
    return {
      sourceType: "spotify",
      sourceId: track.uri,
      title: track.name,
      artist: track.artists?.map((artist) => artist.name).join(", ") || "Spotify artist",
      artworkUrl: artwork,
      streamUrl: null,
      durationSeconds: Math.max(1, Math.round(track.duration_ms / 1000)),
      permalinkUrl: track.external_urls?.spotify,
    };
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new Error("Spotify is not configured. Add SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI.");
    }
  }
}

export function isSupportedUploadMimeType(mimeType: string): boolean {
  return ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/flac", "audio/aac", "audio/mp4"].includes(mimeType);
}

export function sanitizeUploadFileName(fileName: string): string {
  return fileName
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}
