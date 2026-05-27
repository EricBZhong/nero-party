import type { PartyState } from "@nero/shared";

interface LeaderboardCardProps {
  state: PartyState;
}

export function LeaderboardCard({ state }: LeaderboardCardProps) {
  const { winners } = state;
  const isFinalized = state.party.status === "finalized";
  const totalParticipants = state.participants.length;
  const lockedCount = state.ranking.length > 0
    ? new Set(state.ranking.map((r) => r.participantId)).size
    : 0;

  if (winners.length === 0 && !isFinalized) {
    return (
      <div className="leaderboard-card">
        <div className="leaderboard-header">
          <span className="leaderboard-kicker">Leaderboard</span>
        </div>
        <p className="leaderboard-empty-text">
          Rankings appear after ballots are locked.
        </p>
      </div>
    );
  }

  return (
    <div className="leaderboard-card">
      <div className="leaderboard-header">
        <span className="leaderboard-kicker">Leaderboard</span>
        <span className="leaderboard-meta-text">
          {lockedCount}/{totalParticipants} voted
        </span>
      </div>

      <div className="leaderboard-list">
        {winners.slice(0, 5).map((entry, i) => {
          const topScore = winners[0]?.score ?? 1;
          const pct = Math.round((entry.score / topScore) * 100);
          return (
            <div key={entry.trackId} className="leaderboard-row">
              <span className="leaderboard-pos">{i + 1}</span>
              <div className="leaderboard-info">
                <strong>{entry.title}</strong>
                <span>{entry.artist}</span>
              </div>
              <div className="leaderboard-score">
                <span className="leaderboard-pts">{entry.score} pts</span>
                <div className="leaderboard-bar">
                  <div className="leaderboard-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
