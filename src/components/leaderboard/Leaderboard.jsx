import LeaderboardRow from './LeaderboardRow'

export default function Leaderboard({ players, myNickname }) {
  return (
    <ol className="leaderboard" aria-label="Leaderboard">
      {players.map((player, index) => (
        <LeaderboardRow
          key={player.nickname ?? index}
          player={player}
          rank={Number(player.rank ?? index + 1)}
          isMe={myNickname ? player.nickname === myNickname : false}
        />
      ))}
    </ol>
  )
}
