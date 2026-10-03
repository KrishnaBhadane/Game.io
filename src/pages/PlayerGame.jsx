import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { getPlayerForGame } from '../services/gameService'
import { getLiveQuestion } from '../services/questionService'
import {
  getLeaderboard,
  getMySubmission,
  submitAnswer,
} from '../services/submissionService'
import { getAvatarEmoji } from '../data/avatars'
import { getSupabase } from '../lib/supabase'
import Card from '../components/common/Card'
import Badge from '../components/common/Badge'
import AnswerOption from '../components/game/AnswerOption'
import BalanceDisplay from '../components/game/BalanceDisplay'
import RiskSelector from '../components/game/RiskSelector'
import Button from '../components/common/Button'
import Leaderboard from '../components/leaderboard/Leaderboard'

export default function PlayerGame() {
  const { gameCode } = useParams()
  const navigate = useNavigate()
  const [game, setGame] = useState(null)
  const [player, setPlayer] = useState(null)
  const [question, setQuestion] = useState(null)
  const [answer, setAnswer] = useState(null)
  const [risk, setRisk] = useState('No Risk')
  const [wager, setWager] = useState(10)
  const [timeLeft, setTimeLeft] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null) // { is_correct, correct_option, balance_change, new_balance, risk_label, wager }
  const [leaderboard, setLeaderboard] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitError, setSubmitError] = useState('')
  const [error, setError] = useState('')
  const channelRef = useRef(null)
  const gameRef = useRef(null) // stable ref for async callbacks

  const isTimeUp = timeLeft !== null && timeLeft <= 0

  async function loadLeaderboard(gameId) {
    try {
      const rows = await getLeaderboard(gameId)
      setLeaderboard(rows)
    } catch {
      // non-fatal
    }
  }

  async function loadQuestion(gCode, qId) {
    try {
      const q = await getLiveQuestion(gCode)
      setQuestion(q)
      // Check if player already submitted for this question
      if (qId) {
        const sub = await getMySubmission(qId)
        if (sub) {
          setResult(sub)
          setAnswer(sub.selected_option)
        } else {
          setResult(null)
          setAnswer(null)
          setRisk('No Risk')
          setSubmitError('')
        }
      }
    } catch {
      setQuestion(null)
    }
  }

  // Timer countdown hook
  useEffect(() => {
    if (!question || !question.question_started_at || result) {
      setTimeLeft(null)
      return
    }

    const limitSeconds = question.time_limit_seconds || 30
    const startedMs = new Date(question.question_started_at).getTime()

    function tick() {
      const elapsedSeconds = Math.floor((Date.now() - startedMs) / 1000)
      const remaining = Math.max(0, limitSeconds - elapsedSeconds)
      setTimeLeft(remaining)
    }

    tick()
    const timerId = setInterval(tick, 1000)
    return () => clearInterval(timerId)
  }, [question, result])

  // Adjust default wager when player balance loads/changes
  useEffect(() => {
    if (player?.balance !== undefined) {
      const bal = Number(player.balance)
      const defaultWager = bal >= 200 ? 200 : bal >= 10 ? Math.min(bal, 50) : Math.max(1, bal)
      setWager((prev) => (prev > bal || prev === 10 ? defaultWager : prev))
    }
  }, [player?.balance])

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
          if (!gameData) {
            setError('Game not found.')
            setLoading(false)
            return
          }
          if (!playerData) {
            setError('You have not joined this game.')
            setLoading(false)
            return
          }
          setGame(gameData)
          setPlayer(playerData)
          gameRef.current = gameData

          // Redirect based on current game status
          if (gameData.status === 'waiting') {
            navigate(`/lobby/${gameCode}`, { replace: true })
            return
          }
          if (gameData.status === 'ended') {
            navigate(`/results/${gameCode}`, { replace: true })
            return
          }

          // Fetch live question + existing submission
          if (gameData.current_question_id) {
            const q = await getLiveQuestion(gameCode)
            if (!ignore) {
              setQuestion(q)
              const sub = await getMySubmission(gameData.current_question_id)
              if (!ignore && sub) {
                setResult(sub)
                setAnswer(sub.selected_option)
              }
            }
          }

          // Fetch leaderboard
          await loadLeaderboard(gameData.id)

          // Subscribe to game updates and player balance changes
          if (channelRef.current) {
            getSupabase().removeChannel(channelRef.current)
            channelRef.current = null
          }
          const supabase = getSupabase()
          const channel = supabase.channel(`game:${gameData.id}`)

          // Game UPDATE — new question published
          channel.on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'games',
              filter: `id=eq.${gameData.id}`,
            },
            async (payload) => {
              if (ignore) return
              // Navigate to results when game ends
              if (payload.new?.status === 'ended') {
                navigate(`/results/${gameCode}`, { replace: true })
                return
              }
              const newQId = payload.new?.current_question_id
              const oldQId = payload.old?.current_question_id
              if (newQId !== oldQId) {
                setSubmitError('')
                if (newQId) {
                  await loadQuestion(gameCode, newQId)
                } else {
                  setQuestion(null)
                  setResult(null)
                  setAnswer(null)
                }
              }
            },
          )

          // game_players UPDATE — balance/score changed (own or others → refresh leaderboard)
          channel.on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'game_players',
              filter: `game_id=eq.${gameData.id}`,
            },
            async (payload) => {
              if (ignore) return
              // If this is the current player's row, update balance
              if (payload.new?.user_id === playerData.user_id) {
                setPlayer((prev) => ({
                  ...prev,
                  balance: payload.new.balance,
                  score: payload.new.score,
                }))
              }
              // Refresh leaderboard for everyone
              await loadLeaderboard(gameData.id)
            },
          )

          channel.subscribe()
          channelRef.current = channel
        }
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load game.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    load()

    return () => {
      ignore = true
      if (channelRef.current) {
        getSupabase().removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [gameCode, navigate])

  async function handleSubmit() {
    if (!question || !answer || submitting || result || isTimeUp) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await submitAnswer({
        questionId: question.id,
        selectedOption: answer,
        riskLabel: risk,
        wager: Number(wager),
      })
      setResult(res)
      // Update local balance immediately from result
      setPlayer((prev) => ({ ...prev, balance: res.new_balance }))
      // Refresh leaderboard
      if (game) await loadLeaderboard(game.id)
    } catch (err) {
      setSubmitError(err.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <p role="status" className="preview-note">
        Loading game…
      </p>
    )
  }

  if (error || !game || !player) {
    return (
      <section className="medium">
        <p role="alert" className="field-error">
          {error || 'Unable to load game.'}
        </p>
        <Button to="/join" variant="quiet">
          ← Join a Game
        </Button>
      </section>
    )
  }

  const options = question
    ? [
        { letter: 'A', text: question.option_a },
        { letter: 'B', text: question.option_b },
        { letter: 'C', text: question.option_c },
        { letter: 'D', text: question.option_d },
      ]
    : []

  const allowedRisks = game.allowed_multipliers || ['No Risk', '2x', '3x', '5x']

  return (
    <section className="game-page">
      <h1 className="sr-only">Live game</h1>
      <div className="game-top">
        <div>
          <p className="eyebrow">{game.name}</p>
          {question && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
              <p className="question-progress" style={{ margin: 0 }}>
                Question <strong>{question.order_number}</strong>
              </p>
              {timeLeft !== null && (
                <span
                  className={`timer-badge ${
                    isTimeUp ? 'timer-ended' : timeLeft <= 5 ? 'timer-warning' : ''
                  }`}
                >
                  ⏱ {isTimeUp ? "Time's up" : `${timeLeft}s`}
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="avatar" title={player.nickname}>
            {getAvatarEmoji(player.avatar)}
          </span>
          <BalanceDisplay amount={Number(player.balance)} />
        </div>
      </div>

      {/* Question card */}
      {!question ? (
        <Card className="question-card">
          <div className="waiting-status">
            <span className="status-dot" />
            Waiting for host to publish a question…
          </div>
        </Card>
      ) : (
        <Card className="question-card">
          <h2>{question.question_text}</h2>
          <div className="answers" role="group" aria-label="Choose your answer">
            {options.map(({ letter, text }) => (
              <AnswerOption
                key={letter}
                letter={letter}
                selected={answer === letter}
                onClick={() => {
                  if (result || submitting || isTimeUp) return
                  setAnswer(letter)
                }}
              >
                {text}
              </AnswerOption>
            ))}
          </div>
        </Card>
      )}

      {/* Result card — shown after submission */}
      {result && (
        <Card className="result-card">
          <div className="section-heading">
            <Badge tone={result.is_correct ? 'gold' : 'neutral'}>
              {result.is_correct ? '✓ Correct' : '✗ Wrong'}
            </Badge>
            <span className="fine-print">
              Correct answer: {result.correct_option}
            </span>
          </div>
          <dl className="result-details">
            <div>
              <dt>Bet</dt>
              <dd>₹{Number(result.wager || wager).toLocaleString('en-IN')}</dd>
            </div>
            <div>
              <dt>Risk</dt>
              <dd>{result.risk_label ?? `${result.risk_multiplier}x`}</dd>
            </div>
            <div>
              <dt>Balance change</dt>
              <dd className={result.balance_change >= 0 ? '' : 'red-text'}>
                {result.balance_change >= 0 ? '+' : ''}₹
                {Math.abs(Number(result.balance_change)).toLocaleString('en-IN')}
              </dd>
            </div>
            <div>
              <dt>New balance</dt>
              <dd>₹{Number(result.new_balance ?? player.balance).toLocaleString('en-IN')}</dd>
            </div>
          </dl>
          <p className="fine-print">Waiting for next question…</p>
        </Card>
      )}

      {/* Wager + Risk + Submit — only when question live and not yet submitted */}
      {question && !result && (
        <>
          <div className="wager-section">
            <div className="wager-header">
              <h2>Your Bet</h2>
              <span className="wager-amount">₹{Number(wager).toLocaleString('en-IN')}</span>
            </div>
            <input
              type="range"
              className="wager-slider"
              min={player.balance < 10 ? 1 : 10}
              max={Math.max(1, Number(player.balance || 0))}
              step={player.balance < 10 ? 1 : 10}
              value={wager}
              disabled={isTimeUp || submitting}
              onChange={(e) => setWager(Number(e.target.value))}
            />
            <div className="wager-labels">
              <span>Min: ₹{player.balance < 10 ? 1 : 10}</span>
              <span>Max: ₹{Number(player.balance || 0).toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div className="risk-section">
            <div className="section-heading">
              <h2>Choose your risk</h2>
            </div>
            <RiskSelector
              value={risk}
              onChange={setRisk}
              options={allowedRisks}
              disabled={isTimeUp || submitting}
            />
          </div>

          <div className="submit-area">
            <Button
              className="full-width"
              disabled={!answer || submitting || isTimeUp}
              onClick={handleSubmit}
            >
              {isTimeUp ? "Time's up" : submitting ? 'Submitting…' : 'Submit Answer'}
            </Button>
            {isTimeUp && (
              <p role="alert" className="field-error" style={{ textAlign: 'center' }}>
                Time's up! Waiting for next question…
              </p>
            )}
            {submitError && (
              <p role="alert" className="field-error">
                {submitError}
              </p>
            )}
          </div>
        </>
      )}

      {/* Live leaderboard */}
      {leaderboard.length > 0 && (
        <>
          <div className="section-heading">
            <h2>The most wanted</h2>
            <Badge>{leaderboard.length}</Badge>
          </div>
          <Card className="leaderboard-card">
            <Leaderboard players={leaderboard} myNickname={player.nickname} />
          </Card>
        </>
      )}
    </section>
  )
}
