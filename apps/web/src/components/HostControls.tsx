import { useState } from "react";
import type { PartyState } from "@nero/shared";
import type { Flash } from "../App";
import { getErrorMessage } from "../App";
import { advancePlayback, finalizeParty, startPlayback } from "../lib/api";

interface HostControlsProps {
  state: PartyState;
  participantToken: string;
  onFlash: (flash: Flash) => void;
  onStateChange: (state: PartyState) => void;
  onPrimeAudio: () => Promise<void>;
}

export function HostControls({
  state,
  participantToken,
  onFlash,
  onStateChange,
  onPrimeAudio,
}: HostControlsProps) {
  const [busyAction, setBusyAction] = useState<"start" | "advance" | "finale" | null>(null);
  const currentTrack = state.tracks.find((t) => t.id === state.playback.currentTrackId);
  const hasQueued = state.tracks.some((t) => t.status === "queued");
  const isFinalized = state.party.status === "finalized";
  const canStart = !currentTrack && hasQueued;
  const canAdvance = Boolean(currentTrack) || hasQueued;
  const canFinalize = state.tracks.some((t) => t.status === "played" || t.status === "playing");

  async function act(action: "start" | "advance" | "finale") {
    if (busyAction) return;
    setBusyAction(action);
    try {
      void onPrimeAudio();
      const result =
        action === "start"
          ? await startPlayback(state.party.id, participantToken)
          : action === "advance"
            ? await advancePlayback(state.party.id, participantToken)
            : await finalizeParty(state.party.id, participantToken);
      onStateChange(result.state);
      onFlash({
        tone: "good",
        message:
          action === "start"
            ? "Playback started."
            : action === "advance"
              ? "Advanced queue."
              : "Final ballot locked.",
      });
    } catch (e) {
      onFlash({ tone: "bad", message: getErrorMessage(e) });
    } finally {
      setBusyAction(null);
    }
  }

  if (isFinalized) return null;

  return (
    <div className="host-controls">
      <span className="host-badge">Host</span>
      <div className="host-actions">
        <button className="host-btn host-btn-primary" onClick={() => act("start")} disabled={!canStart || Boolean(busyAction)}>
          <PlayIcon /> {busyAction === "start" ? "Starting" : "Start"}
        </button>
        <button className="host-btn" onClick={() => act("advance")} disabled={!canAdvance || Boolean(busyAction)}>
          <SkipIcon /> {busyAction === "advance" ? "Advancing" : "Advance"}
        </button>
        <button className="host-btn host-btn-warn" onClick={() => act("finale")} disabled={!canFinalize || Boolean(busyAction)}>
          {busyAction === "finale" ? "Locking" : "Finale"}
        </button>
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function SkipIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
