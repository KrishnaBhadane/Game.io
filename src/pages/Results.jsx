import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { getPlayerForGame } from '../services/gameService'
import { getLeaderboard, getMyGameSummary } from '../services/submissionService'
import Card from '../components/common/Card'
import Badge from '../components/common/Badge'
import Button from '../components/common/Button'
import BalanceDisplay from '../components/game/BalanceDisplay'
import Leaderboard from '../components/leaderboard/Leaderboard'
import { getAvatarEmoji } from '../data/avatars'

export default function Results() {
  const { gameCode } = useParams()
  const navigate = useNavigate()
  const [game, setGame] = useState(null)
  const [player, setPlayer] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [summary, setSummary] = useState([])
  const [myRank, setMyRank] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false

    async function load() {
      if (!gameCode) return
      setLoading(true)
      setError('')
      try {
        const { game: gameData, player: playerData } =
          await getPlayerForGame(gameCode)

        if (!ignore) {
          if (!gameData || !playerData) {
            setError('Game not found.')
            setLoading(false)
            return
          }

          // If game is not yet ended, redirect to the appropriate live stage
          if (gameData.status === 'waiting') {
            navigate(`/lobby/${gameCode}`, { replace: true })
            return
          }
          if (gameData.status === 'active') {
            navigate(`/game/${gameCode}`, { replace: true })
            return
          }

          setGame(gameData)
          setPlayer(playerData)

          const [rows, personalSummary] = await Promise.all([
            getLeaderboard(gameData.id),
            playerData ? getMyGameSummary(gameData.id) : Promise.resolve([]),
          ])
          if (!ignore) {
            setLeaderboard(rows)
            setSummary(personalSummary)
            const mine = rows.find((r) => r.isMe)
            setMyRank(mine?.rank ?? null)
          }
        }
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load results.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    load()
    return () => { ignore = true }
  }, [gameCode, navigate])

  if (loading) {
    return (
      <p role="status" className="preview-note">
        Loading results…
      </p>
    )
  }

  if (error) {
    return (
      <section className="medium">
        <p role="alert" className="field-error">{error}</p>
        <Button to="/" variant="quiet">← Home</Button>
      </section>
    )
  }

  const isWinner = myRank === 1
  const totals = summary.reduce(
    (current, item) => ({
      correct: current.correct + (item.result === 'correct' ? 1 : 0),
      gained: current.gained + Number(item.gained || 0),
      deducted: current.deducted + Number(item.deducted || 0),
      net: current.net + Number(item.balance_change || 0),
    }),
    { correct: 0, gained: 0, deducted: 0, net: 0 },
  )

  return (
    <section className="medium results-page">
      <div className="centered">
        <Badge tone={isWinner ? 'gold' : 'neutral'}>
          {isWinner ? `🏆 ${getAvatarEmoji(player?.avatar)} Winner` : 'Final results'}
        </Badge>
        <h1>{game?.name ?? 'Game over'}</h1>
        {myRank && (
          <p className="page-description">
            You finished rank <strong>#{myRank}</strong>
            {leaderboard.filter((r) => r.rank === 1).length > 1 &&
              myRank === 1
              ? ' — shared first place!'
              : ''}
          </p>
        )}
      </div>

      {player && (
        <Card className="result-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span className="avatar">{getAvatarEmoji(player.avatar)}</span>
            <strong>{player.nickname}</strong>
          </div>
          <BalanceDisplay amount={Number(player.balance)} label="Final bounty" />
          <dl className="result-details">
            <div>
              <dt>Questions correct</dt>
              <dd>{player.score ?? 0}</dd>
            </div>
            {myRank && (
              <div>
                <dt>Final rank</dt>
                <dd>#{myRank}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      {summary.length > 0 && (
        <section className="money-summary" aria-label="Your game summary">
          <div className="section-heading"><h2>Your game</h2></div>
          <div className="summary-totals">
            <span>Correct <strong>{totals.correct}</strong></span>
            <span>Gained <strong>+₹{totals.gained.toLocaleString('en-IN')}</strong></span>
            <span>Deducted <strong>-₹{totals.deducted.toLocaleString('en-IN')}</strong></span>
            <span>Net <strong className={totals.net < 0 ? 'red-text' : ''}>{totals.net >= 0 ? '+' : '-'}₹{Math.abs(totals.net).toLocaleString('en-IN')}</strong></span>
          </div>
          <ol className="summary-list">
            {summary.map((item) => (
              <li key={item.question_number}>
                <div>
                  <strong>Q{item.question_number}</strong>
                  <p>{item.question_text}</p>
                  {item.selected_option && <p className="summary-answer">Your answer: {item.selected_option} · {item.selected_answer}</p>}
                </div>
                <div className={item.result === 'wrong' ? 'red-text' : ''}>
                  <strong>{item.result}</strong>
                  <span>Bet ₹{Number(item.wager).toLocaleString('en-IN')}{item.risk_multiplier != null ? ` · ${Number(item.risk_multiplier)}x` : ''}</span>
                  <span>Gained ₹{Number(item.gained).toLocaleString('en-IN')} · Deducted ₹{Number(item.deducted).toLocaleString('en-IN')}</span>
                  <strong>{Number(item.balance_change) > 0 ? '+' : Number(item.balance_change) < 0 ? '-' : ''}₹{Math.abs(Number(item.balance_change)).toLocaleString('en-IN')}</strong>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {leaderboard.length > 0 && (
        <>
          <div className="section-heading">
            <h2>The most wanted</h2>
            <Badge>{leaderboard.length}</Badge>
          </div>
          <Card className="leaderboard-card">
            <Leaderboard players={leaderboard} myNickname={player?.nickname} />
          </Card>
        </>
      )}

      <Button to="/" variant="quiet" className="full-width">
        ← Back to home
      </Button>
    </section>
  )
}
