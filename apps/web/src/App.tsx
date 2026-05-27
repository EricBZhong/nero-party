import { useEffect, useMemo, useRef, useState } from "react";
import type { Participant, PartyState, Track } from "@nero/shared";
import {
  createParty,
  getParty,
  joinParty,
} from "./lib/api";
import { socket } from "./lib/socket";
import { Entry } from "./components/Entry";
import { FocusRoom } from "./components/FocusRoom";
import { OverlayShell } from "./components/OverlayShell";

export type Surface = "web" | "overlay";
export type Flash = { tone: "good" | "warn" | "bad"; message: string } | null;

const route = parseRoute();

function App() {
  const [partyCode, setPartyCode] = useState(route.code);
  const [participantToken, setParticipantToken] = useState(
    route.code ? localStorage.getItem(tokenKey(route.code)) ?? "" : ""
  );
  const [state, setState] = useState<PartyState | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [leaveIntent, setLeaveIntent] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentParticipant = useMemo(
    () => state?.participants.find((p) => p.token === participantToken) ?? null,
    [state, participantToken]
  );
  const currentTrack = useMemo(
    () => state?.tracks.find((t) => t.id === state.playback.currentTrackId) ?? null,
    [state]
  );
  const isHost = currentParticipant?.role === "host";

  // Handle Spotify callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const spotifyResult = params.get("spotify");
    if (!spotifyResult) return;
    setFlash(
      spotifyResult === "connected"
        ? { tone: "good", message: "Spotify connected. Tracks will start on linked listener devices." }
        : { tone: "bad", message: "Spotify connection failed. Try again." }
    );
    params.delete("spotify");
    const next = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
  }, []);

  // Fetch initial state
  useEffect(() => {
    if (!partyCode) return;
    getParty(partyCode)
      .then((s) => setState(s))
      .catch((e: Error) => setFlash({ tone: "bad", message: e.message }));
  }, [partyCode]);

  // Socket connection
  useEffect(() => {
    if (!partyCode) return;
    if (!socket.connected) socket.connect();

    const onConnect = () => {
      setConnected(true);
      socket.emit("party:subscribe", { partyCode, participantToken });
    };
    const onDisconnect = () => setConnected(false);
    const onState = (next: PartyState) => setState(next);
    const onError = (payload: { message?: string }) =>
      setFlash({ tone: "bad", message: payload.message ?? "Connection failed." });

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("party:state", onState);
    socket.on("party:error", onError);
    socket.emit("party:subscribe", { partyCode, participantToken });

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("party:state", onState);
      socket.off("party:error", onError);
    };
  }, [partyCode, participantToken]);

  // Presence heartbeat
  useEffect(() => {
    if (!participantToken || !socket.connected) return;
    const timer = window.setInterval(
      () => socket.emit("presence:heartbeat", { participantToken }),
      15000
    );
    return () => window.clearInterval(timer);
  }, [participantToken, connected]);

  // Audio unlock on first interaction
  useEffect(() => {
    if (!participantToken || audioUnlocked) return;
    const prime = () => void unlockAudio();
    window.addEventListener("pointerdown", prime, { once: true, capture: true });
    window.addEventListener("keydown", prime, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", prime, true);
      window.removeEventListener("keydown", prime, true);
    };
  }, [participantToken, audioUnlocked, currentTrack?.id, currentTrack?.streamUrl, state?.playback.isPlaying]);

  // Audio sync
  useEffect(() => {
    if (!audioRef.current || !state || !currentTrack?.streamUrl || !audioUnlocked) return;
    const audio = audioRef.current;
    const pos = state.playback.positionSeconds;
    if (!audio.src || !audio.src.includes(currentTrack.streamUrl)) {
      audio.src = currentTrack.streamUrl;
    }
    if (Math.abs(audio.currentTime - pos) > 2) {
      audio.currentTime = Math.min(pos, Math.max(currentTrack.durationSeconds - 1, 0));
    }
    if (state.playback.isPlaying) {
      audio.play().catch(() =>
        setFlash({ tone: "warn", message: "Tap anywhere to enable audio." })
      );
    } else {
      audio.pause();
    }
  }, [audioUnlocked, currentTrack, state?.playback.currentTrackId, state?.playback.isPlaying, state?.playback.positionSeconds]);

  async function handleCreate(input: Parameters<typeof createParty>[0]) {
    setIsJoining(true);
    setFlash(null);
    try {
      const res = await createParty(input);
      storeSession(res.partyCode, res.participantToken);
      setParticipantToken(res.participantToken);
      setPartyCode(res.partyCode);
      setState(res.state);
      window.history.replaceState(null, "", `/party/${res.partyCode}`);
    } catch (e) {
      setFlash({ tone: "bad", message: getErrorMessage(e) });
    } finally {
      setIsJoining(false);
    }
  }

  async function handleJoin(code: string, displayName: string) {
    setIsJoining(true);
    setFlash(null);
    try {
      const res = await joinParty(code, {
        displayName,
        source: route.surface === "overlay" ? "overlay" : "web",
        participantToken: localStorage.getItem(tokenKey(code)) ?? undefined,
      });
      storeSession(code, res.participantToken);
      setParticipantToken(res.participantToken);
      setPartyCode(code.toUpperCase());
      setState(res.state);
      window.history.replaceState(
        null,
        "",
        route.surface === "overlay"
          ? `/companion/${code.toUpperCase()}?source=overlay`
          : `/party/${code.toUpperCase()}`
      );
    } catch (e) {
      setFlash({ tone: "bad", message: getErrorMessage(e) });
    } finally {
      setIsJoining(false);
    }
  }

  async function unlockAudio() {
    setAudioUnlocked(true);
    socket.emit("audio:ready", { participantToken, audioReady: true });
    const audio = audioRef.current;
    if (!audio || !currentTrack?.streamUrl) return;
    audio.muted = false;
    if (!audio.src.includes(currentTrack.streamUrl)) {
      audio.src = currentTrack.streamUrl;
    }
    audio.currentTime = Math.min(
      state?.playback.positionSeconds ?? 0,
      Math.max(currentTrack.durationSeconds - 1, 0)
    );
    await audio.play().catch(() => undefined);
    if (!state?.playback.isPlaying) audio.pause();
  }

  function leaveRoom() {
    if (partyCode) localStorage.removeItem(tokenKey(partyCode));
    setParticipantToken("");
    setState(null);
    setPartyCode("");
    window.history.replaceState(null, "", "/");
  }

  const showRoom = state && participantToken && currentParticipant;

  return (
    <main className={`nero-app min-h-screen bg-nero-ink text-white ${route.surface === "overlay" ? "overlay-shell" : ""}`}>
      <audio ref={audioRef} preload="auto" />
      <div className="nero-grid-bg fixed inset-0 pointer-events-none" />

      {flash && <FlashBanner flash={flash} onDismiss={() => setFlash(null)} />}

      {!showRoom ? (
        <Entry
          routeCode={partyCode}
          loading={isJoining}
          onCreate={handleCreate}
          onJoin={handleJoin}
        />
      ) : route.surface === "overlay" ? (
        <OverlayShell
          state={state}
          participant={currentParticipant}
          participantToken={participantToken}
          currentTrack={currentTrack}
          onFlash={setFlash}
        />
      ) : (
        <FocusRoom
          state={state}
          participant={currentParticipant}
          participantToken={participantToken}
          currentTrack={currentTrack}
          isHost={isHost}
          connected={connected}
          audioUnlocked={audioUnlocked}
          onUnlockAudio={unlockAudio}
          onFlash={setFlash}
          onStateChange={setState}
          onLeave={() => setLeaveIntent(true)}
        />
      )}

      {leaveIntent && (
        <ConfirmLeaveModal
          onCancel={() => setLeaveIntent(false)}
          onConfirm={() => {
            setLeaveIntent(false);
            leaveRoom();
          }}
        />
      )}
    </main>
  );
}

// ─── Flash Banner ────────────────────────────────────────────────────────────

function FlashBanner({ flash, onDismiss }: { flash: NonNullable<Flash>; onDismiss: () => void }) {
  const color =
    flash.tone === "good"
      ? "border-nero-live/40 bg-nero-live/10 text-nero-live"
      : flash.tone === "warn"
        ? "border-nero-warning/40 bg-nero-warning/10 text-nero-warning"
        : "border-red-400/40 bg-red-500/10 text-red-200";

  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-full border px-4 py-2.5 text-sm font-semibold shadow-lg backdrop-blur-xl ${color}`}>
      <span>{flash.message}</span>
      <button className="rounded-full p-1 hover:bg-white/10" onClick={onDismiss} aria-label="Dismiss">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function ConfirmLeaveModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal confirm-modal">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Leave this room?</h2>
            <p className="modal-subtitle">Your local guest session for this room will be removed from this browser.</p>
          </div>
          <button className="modal-close" onClick={onCancel} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="confirm-actions">
          <button className="confirm-secondary" onClick={onCancel}>Stay</button>
          <button className="confirm-danger" onClick={onConfirm}>Leave room</button>
        </div>
      </div>
    </div>
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function tokenKey(code: string) {
  return `nero-party-token-${code.toUpperCase()}`;
}

function storeSession(code: string, token: string) {
  localStorage.setItem(tokenKey(code), token);
}

function parseRoute(): { code: string; surface: Surface } {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(window.location.search);
  if (parts[0] === "discord") return { code: (parts[1] ?? params.get("code") ?? "").toUpperCase(), surface: "web" };
  if (parts[0] === "companion") return { code: (parts[1] ?? params.get("code") ?? "").toUpperCase(), surface: "overlay" };
  if (parts[0] === "party") return { code: (parts[1] ?? params.get("code") ?? "").toUpperCase(), surface: "web" };
  return { code: (params.get("code") ?? "").toUpperCase(), surface: params.get("source") === "overlay" ? "overlay" : "web" };
}

// ─── Shared helpers (exported for child components) ──────────────────────────

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.floor(seconds % 60));
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const r = safe % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
  }
  if (m > 0) return r ? `${m}m ${r}s` : `${m}m`;
  return `${r}s`;
}

export function ordinal(n: number) {
  const s = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${n}${s}`;
}

export function getParticipantRanking(state: PartyState, participantId: string) {
  return state.ranking
    .filter((e) => e.participantId === participantId)
    .sort((a, b) => a.rank - b.rank)
    .map((e) => e.trackId);
}

export function getListenedTracks(state: PartyState) {
  return state.tracks
    .filter((t) => t.status === "played" || t.status === "playing")
    .sort((a, b) => b.queuePosition - a.queuePosition);
}

export function getLimitStats(state: PartyState, participantId: string) {
  const totalTracks = state.tracks.length;
  const totalSeconds = state.tracks.reduce((sum, t) => sum + t.durationSeconds, 0);
  const participantTracks = state.tracks.filter((t) => t.submittedByParticipantId === participantId).length;
  const maxSeconds = state.party.settings.maxDurationMinutes * 60;
  return {
    totalTracks,
    totalSeconds,
    participantTracks,
    songPercent: clamp((totalTracks / state.party.settings.maxQueueSize) * 100),
    timePercent: clamp((totalSeconds / maxSeconds) * 100),
    participantPercent: clamp((participantTracks / state.party.settings.maxSubmissionsPerParticipant) * 100),
  };
}

function clamp(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, Math.round(v)));
}

export default App;
