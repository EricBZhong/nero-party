import type { PartyMode, PartySettings, PartyState, ReactionType, TrackSourceType } from "@nero/shared";

export const API_URL = import.meta.env.VITE_PUBLIC_API_URL ?? "http://localhost:3000";

export interface SearchTrack {
  sourceType: Extract<TrackSourceType, "audius" | "spotify" | "upload">;
  sourceId: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  streamUrl: string | null;
  durationSeconds: number;
  permalinkUrl?: string;
}

export interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  displayName: string | null;
  spotifyUserId: string | null;
  expiresAt: string | null;
  scope: string | null;
  roomConnectionCount?: number;
  hostConnected?: boolean;
  playbackReady?: boolean;
  deviceName?: string | null;
  deviceCount?: number;
  deviceError?: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export function createParty(input: {
  title: string;
  hostName: string;
  mode: PartyMode;
  settings: PartySettings;
}) {
  return request<{ partyCode: string; participantToken: string; state: PartyState }>("/api/parties", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function joinParty(code: string, input: { displayName: string; source: "web" | "discord" | "overlay"; participantToken?: string }) {
  return request<{ participantToken: string; state: PartyState }>(`/api/parties/${code}/join`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getParty(code: string) {
  return request<PartyState>(`/api/parties/${code}`);
}

export function searchAudius(query: string) {
  return request<{ results: SearchTrack[] }>(`/api/search/audius?q=${encodeURIComponent(query)}`);
}

export function searchSpotify(query: string) {
  return request<{ results: SearchTrack[] }>(`/api/search/spotify?q=${encodeURIComponent(query)}`);
}

export function getSpotifyStatus(partyId: string, participantToken?: string) {
  const query = participantToken ? `?participantToken=${encodeURIComponent(participantToken)}` : "";
  return request<SpotifyStatus>(`/api/parties/${partyId}/spotify/status${query}`);
}

export function spotifyLoginUrl(partyId: string, participantToken: string) {
  const url = new URL(`${API_URL}/api/parties/${partyId}/spotify/login`);
  url.searchParams.set("participantToken", participantToken);
  return url.toString();
}

export function getSpotifyWebToken(partyId: string, participantToken: string) {
  return request<{ accessToken: string }>(`/api/parties/${partyId}/spotify/web-token?participantToken=${encodeURIComponent(participantToken)}`);
}

export function setSpotifyDevice(partyId: string, participantToken: string, deviceId: string) {
  return request<{ deviceId: string }>(`/api/parties/${partyId}/spotify/device`, {
    method: "POST",
    body: JSON.stringify({ participantToken, deviceId }),
  });
}

export function uploadAudio(formData: FormData) {
  return request<SearchTrack>("/api/uploads/audio", {
    method: "POST",
    body: formData,
  });
}

export function addTrack(
  partyId: string,
  input: SearchTrack & {
    participantToken: string;
  },
) {
  return request<{ state: PartyState }>(`/api/parties/${partyId}/tracks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveTrack(participantId: string, participantToken: string, trackId: string) {
  return request<{ state: PartyState }>(`/api/participants/${participantId}/saved-tracks`, {
    method: "POST",
    body: JSON.stringify({ participantToken, trackId }),
  });
}

export function updateRanking(participantId: string, participantToken: string, trackIds: string[]) {
  return request<{ state: PartyState }>(`/api/participants/${participantId}/ranking`, {
    method: "PUT",
    body: JSON.stringify({ participantToken, trackIds }),
  });
}

export function startPlayback(partyId: string, participantToken: string) {
  return request<{ state: PartyState }>(`/api/parties/${partyId}/playback/start`, {
    method: "POST",
    body: JSON.stringify({ participantToken }),
  });
}

export function pausePlayback(partyId: string, participantToken: string) {
  return request<{ state: PartyState }>(`/api/parties/${partyId}/playback/pause`, {
    method: "POST",
    body: JSON.stringify({ participantToken }),
  });
}

export function advancePlayback(partyId: string, participantToken: string) {
  return request<{ state: PartyState }>(`/api/parties/${partyId}/playback/advance`, {
    method: "POST",
    body: JSON.stringify({ participantToken }),
  });
}

export function finalizeParty(partyId: string, participantToken: string) {
  return request<{ state: PartyState }>(`/api/parties/${partyId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ participantToken }),
  });
}

export function sendReaction(partyId: string, participantToken: string, trackId: string, type: ReactionType) {
  return { partyId, participantToken, trackId, type };
}
