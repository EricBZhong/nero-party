import type { Participant, PartyState, Track } from "@nero/shared";
import { getParticipantRanking } from "../App";

interface BallotCardProps {
  state: PartyState;
  participant: Participant;
  currentTrack: Track | null;
  onOpenRanking: () => void;
}

export function BallotCard({ state, participant, currentTrack, onOpenRanking }: BallotCardProps) {
  const ranking = getParticipantRanking(state, participant.id);
  const rankedTracks = ranking
    .map((id) => state.tracks.find((t) => t.id === id))
    .filter(Boolean) as Track[];

  const locked = rankedTracks.length;
  const isFinalized = state.party.status === "finalized";

  return (
    <div className="ballot-card">
      <div className="ballot-card-header">
        <div>
          <span className="ballot-kicker">Your Top 3</span>
          <span className="ballot-lock-count">{locked} / 3 locked in</span>
        </div>
        <button className="ballot-open-btn" onClick={onOpenRanking}>
          {isFinalized ? "View" : "Edit"}
        </button>
      </div>

      <div className="ballot-slots">
        {[0, 1, 2].map((i) => {
          const track = rankedTracks[i];
          return (
            <div
              key={i}
              className={`ballot-slot ${track ? "ballot-slot-filled" : "ballot-slot-empty"}`}
              onClick={onOpenRanking}
            >
              <span className="ballot-rank">{i + 1}</span>
              {track ? (
                <div className="ballot-slot-info">
                  <strong>{track.title}</strong>
                  <span>{track.artist}</span>
                </div>
              ) : (
                <span className="ballot-slot-placeholder">+ Add track</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
