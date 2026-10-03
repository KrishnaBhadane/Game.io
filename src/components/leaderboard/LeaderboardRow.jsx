import { getAvatarEmoji } from '../../data/avatars'

export default function LeaderboardRow({ player, rank, isMe }) {
  const emoji = getAvatarEmoji(player.avatar)
  return (
    <li className={`leaderboard-row${isMe ? ' is-me' : ''}`}>
      <span className={`rank ${rank === 1 ? 'rank-first' : ''}`}>
        {String(rank).padStart(2, '0')}
      </span>
      <span className="leaderboard-name">
        <span aria-hidden="true" style={{ marginRight: '6px' }}>{emoji}</span>
        {player.name}{isMe ? ' ★' : ''}
      </span>
      <strong>₹{player.balance.toLocaleString('en-IN')}</strong>
    </li>
  )
}

