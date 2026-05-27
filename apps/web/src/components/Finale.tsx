import type { PartyState } from "@nero/shared";
import { TrackArtwork } from "./shared/TrackArtwork";

interface FinaleProps {
  state: PartyState;
}

export function Finale({ state }: FinaleProps) {
  const { winners, tracks } = state;
  if (winners.length === 0) return null;

  // Podium order: 2nd, 1st, 3rd for visual layout
  const first = winners[0];
  const second = winners[1];
  const third = winners[2];

  const podium = [second, first, third].filter(Boolean);

  return (
    <div className="finale">
      {/* Rays / celebration background */}
      <div className="finale-rays" aria-hidden />

      {/* Header */}
      <div className="finale-header">
        <span className="finale-kicker">Nero Party</span>
        <h1 className="finale-headline">We have a winner!</h1>
        <p className="finale-subline">Great picks. Unforgettable vibes.</p>
      </div>

      {/* Podium */}
      <div className="finale-podium">
        {podium.map((winner) => {
          if (!winner) return null;
          const track = tracks.find((t) => t.id === winner.trackId);
          if (!track) return null;
          const rank = winners.indexOf(winner) + 1;
          const isFirst = rank === 1;

          return (
            <div
              key={winner.trackId}
              className={`finale-card ${isFirst ? "finale-card-first" : ""}`}
              style={{ order: rank === 1 ? 1 : rank === 2 ? 0 : 2 }}
            >
              {isFirst && <CrownIcon />}
              <span className={`finale-rank ${isFirst ? "finale-rank-first" : ""}`}>
                {rank}
              </span>
              <TrackArtwork track={track} size="medium" />
              <div className="finale-card-info">
                <strong>{track.title}</strong>
                <span>{track.artist}</span>
              </div>
              <div className="finale-card-score">
                <span className="finale-pts">{winner.score}</span>
                <span className="finale-pts-label">points</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Scoring explanation */}
      <div className="finale-scoring">
        <div className="finale-score-rule">
          <span className="finale-score-num">5</span>
          <span>Your #1 pick</span>
        </div>
        <div className="finale-score-rule">
          <span className="finale-score-num">3</span>
          <span>Your #2 pick</span>
        </div>
        <div className="finale-score-rule">
          <span className="finale-score-num">1</span>
          <span>Your #3 pick</span>
        </div>
      </div>
    </div>
  );
}

function CrownIcon() {
  return (
    <svg className="finale-crown" viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
      <path d="M2 8l4 12h12l4-12-5 4-5-8-5 8-5-4z" />
    </svg>
  );
}
