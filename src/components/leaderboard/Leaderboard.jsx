import { memo } from 'react'
import LeaderboardRow from './LeaderboardRow'

function Leaderboard({ players }) {
  return (
    <ol className="leaderboard" aria-label="Leaderboard">
      {players.map((player, index) => (
        <LeaderboardRow
          key={index}
          player={player}
          rank={Number(player.rank ?? index + 1)}
          isMe={player.isMe}
        />
      ))}
    </ol>
  )
}

// Local countdown ticks do not need to repaint the entire player list.
export default memo(Leaderboard)
