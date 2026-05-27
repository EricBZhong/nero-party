import { useState, useMemo } from "react";
import type { Participant, PartyState, Track } from "@nero/shared";
import type { Flash } from "../App";
import { getListenedTracks } from "../App";
import { NowPlaying } from "./NowPlaying";
import { QueuePreview } from "./QueuePreview";
import { BallotCard } from "./BallotCard";
import { LeaderboardCard } from "./LeaderboardCard";
import { HostControls } from "./HostControls";
import { AddSongModal } from "./AddSongModal";
import { QueueDrawer } from "./QueueDrawer";
import { RankingDrawer } from "./RankingDrawer";
import { OverlayPreview } from "./OverlayPreview";
import { Finale } from "./Finale";
import { SpotifyButton } from "./shared/SpotifyButton";

type Layer = "add-song" | "queue" | "ranking" | "overlay" | null;

interface FocusRoomProps {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  currentTrack: Track | null;
  isHost: boolean;
  connected: boolean;
  audioUnlocked: boolean;
  onUnlockAudio: () => Promise<void>;
  onFlash: (flash: Flash) => void;
  onStateChange: (state: PartyState) => void;
  onLeave: () => void;
}

export function FocusRoom({
  state,
  participant,
  participantToken,
  currentTrack,
  isHost,
  connected,
  audioUnlocked,
  onUnlockAudio,
  onFlash,
  onStateChange,
  onLeave,
}: FocusRoomProps) {
  const [layer, setLayer] = useState<Layer>(null);
  const listenedTracks = useMemo(() => getListenedTracks(state), [state]);
  const isFinalized = state.party.status === "finalized";

  return (
    <div className="focus-room">
      {/* Top bar */}
      <header className="room-topbar">
        <div className="room-topbar-left">
          <div className="room-live-badge">
            <span className="live-dot" />
            <span>Live</span>
          </div>
          <h2 className="room-title">{state.party.title}</h2>
          <span className="room-code">{state.party.code}</span>
        </div>
        <div className="room-topbar-right">
          <button className="room-action-btn" onClick={() => setLayer("add-song")} aria-label="Add song" title="Add song">
            <PlusIcon />
            <span>Add song</span>
          </button>
          <button className="room-action-btn" onClick={() => setLayer("queue")} aria-label="Open queue" title="Open queue">
            <QueueIcon />
            <span>Queue</span>
          </button>
          <button className="room-action-btn" onClick={() => setLayer("overlay")} aria-label="Open overlay preview" title="Open overlay preview">
            <OverlayIcon />
            <span>Overlay</span>
          </button>
          <SpotifyButton state={state} participantToken={participantToken} />
          <button className="room-action-btn room-action-btn-muted" onClick={onLeave} title="Leave room">
            <LeaveIcon />
          </button>
        </div>
      </header>

      {/* Main three-column layout */}
      <div className="room-body">
        {/* Left: Queue preview */}
        <aside className="room-left">
          <QueuePreview state={state} onOpenQueue={() => setLayer("queue")} />
        </aside>

        {/* Center: Now playing stage */}
        <div className="room-center">
          <NowPlaying
            state={state}
            participant={participant}
            participantToken={participantToken}
            currentTrack={currentTrack}
            onFlash={onFlash}
            onOpenAddSong={() => setLayer("add-song")}
            onOpenRanking={() => setLayer("ranking")}
          />

          {!audioUnlocked && currentTrack?.streamUrl && (
            <button className="audio-unlock-banner" onClick={onUnlockAudio}>
              Tap anywhere to enable audio
            </button>
          )}

          {isHost && (
            <HostControls
              state={state}
              participantToken={participantToken}
              onFlash={onFlash}
              onStateChange={onStateChange}
              onPrimeAudio={onUnlockAudio}
            />
          )}

          {isFinalized && <Finale state={state} />}
        </div>

        {/* Right: Top 3 + Leaderboard */}
        <aside className="room-right">
          <BallotCard
            state={state}
            participant={participant}
            currentTrack={currentTrack}
            onOpenRanking={() => setLayer("ranking")}
          />
          <LeaderboardCard state={state} />
        </aside>

        <section className="room-mobile-panels" aria-label="Room details">
          <QueuePreview state={state} onOpenQueue={() => setLayer("queue")} />
          <BallotCard
            state={state}
            participant={participant}
            currentTrack={currentTrack}
            onOpenRanking={() => setLayer("ranking")}
          />
          <LeaderboardCard state={state} />
        </section>
      </div>

      {/* Connection status */}
      {!connected && (
        <div className="reconnect-banner">Reconnecting...</div>
      )}

      {/* Layers / Modals */}
      {layer === "add-song" && (
        <AddSongModal
          state={state}
          participant={participant}
          participantToken={participantToken}
          onFlash={onFlash}
          onClose={() => setLayer(null)}
        />
      )}
      {layer === "queue" && (
        <QueueDrawer state={state} onClose={() => setLayer(null)} />
      )}
      {layer === "ranking" && (
        <RankingDrawer
          state={state}
          participant={participant}
          participantToken={participantToken}
          tracks={listenedTracks}
          onFlash={onFlash}
          onClose={() => setLayer(null)}
        />
      )}
      {layer === "overlay" && (
        <OverlayPreview
          state={state}
          participant={participant}
          participantToken={participantToken}
          currentTrack={currentTrack}
          onFlash={onFlash}
          onClose={() => setLayer(null)}
        />
      )}
    </div>
  );
}

// ─── Inline SVG icons (small, no dependency) ─────────────────────────────────

function PlusIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function OverlayIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
