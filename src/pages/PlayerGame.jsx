import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { getPlayerForGame } from '../services/gameService'
import { watchGameDeadline, getLiveQuestion } from '../services/questionService'
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
  const [result, setResult] = useState(null) // null, pending receipt, or revealed result
  const [leaderboard, setLeaderboard] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitError, setSubmitError] = useState('')
  const [error, setError] = useState('')
  const channelRef = useRef(null)
  const gameRef = useRef(null) // stable ref for async callbacks
  const refreshRef = useRef(() => {})
  const [connectionError, setConnectionError] = useState('')

  const isTimeUp = timeLeft !== null && timeLeft <= 0

  // Countdown is display-only; the deadline RPC uses database time.
  useEffect(() => {
    if (!question?.question_started_at) { setTimeLeft(null); return }
    const deadline = Date.parse(question.question_started_at) + Number(question.time_limit_seconds) * 1000
    const tick = () => setTimeLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [question])

  useEffect(() => {
    const balance = Number(player?.balance || 0)
    setWager((previous) => Math.min(balance, previous || Math.min(balance, 200)))
  }, [player?.balance])

  useEffect(() => {
    let ignore = false
    let stopClock = () => {}
    let refreshTimer
    let questionVersion = 0
    let ownPlayerId
    let refreshing = false
    const supabase = getSupabase()

    async function refreshLeaderboard() {
      try {
        const rows = await getLeaderboard(gameRef.current.id)
        if (!ignore) setLeaderboard(rows)
      } catch { if (!ignore) setConnectionError('Could not refresh leaderboard.') }
    }

    async function applyGame(next) {
      if (ignore) return
      const previous = gameRef.current
      gameRef.current = next
      setGame(next)
      if (next.status !== 'active') {
        stopClock()
        navigate(`/${next.status === 'ended' ? 'results' : 'lobby'}/${gameCode}`, { replace: true })
        return
      }
      if (previous?.current_question_id === next.current_question_id &&
          previous?.question_started_at === next.question_started_at) {
        if (previous?.question_revealed_at !== next.question_revealed_at && next.question_revealed_at) {
          try {
            const revealed = await getMySubmission(next.current_question_id)
            if (ignore || gameRef.current?.current_question_id !== next.current_question_id) return
            setResult(revealed)
            setTimeLeft(0)
            if (revealed?.status === 'revealed') setPlayer((prev) => ({ ...prev, balance: revealed.new_balance }))
          } catch { if (!ignore) setConnectionError('Could not load result. Try again.') }
        }
        return
      }
      const version = ++questionVersion
      setQuestion(null)
      setResult(null)
      setAnswer(null)
      setTimeLeft(null)
      setRisk('No Risk')
      setSubmitError('')
      try {
        const q = await getLiveQuestion(gameCode)
        const sub = q ? await getMySubmission(q.id) : null
        if (ignore || version !== questionVersion) return
        setQuestion(q)
        setResult(sub)
        setAnswer(sub?.selected_option || null)
        if (sub?.status === 'revealed') setPlayer((prev) => ({ ...prev, balance: sub.new_balance }))
      } catch { if (!ignore) setConnectionError('Could not load question. Try again.') }
    }

    function startClock() {
      stopClock()
      if (gameRef.current?.status !== 'active') return
      stopClock = watchGameDeadline(gameRef.current.id, (state) => {
        applyGame({ ...gameRef.current, ...state })
      }, () => setConnectionError('Connection lost. Try again.'))
    }

    async function refresh() {
      if (ignore || refreshing) return
      refreshing = true
      try {
        const { game: next, player: me } = await getPlayerForGame(gameCode)
        if (ignore) return
        if (!next || !me) throw new Error('Game or player session not found.')
        ownPlayerId = me.id
        setPlayer(me)
        // Force a fresh question/submission snapshot after reconnect.
        gameRef.current = null
        await applyGame(next)
        if (ignore) return
        setConnectionError('')
        startClock()
        await refreshLeaderboard()
      } catch (err) { if (!ignore) setConnectionError(err.message || 'Could not reconnect.') }
      finally { refreshing = false }
    }
    refreshRef.current = refresh
    const resume = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', resume)

    async function load() {
      setLoading(true)
      try {
        const { game: next, player: me } = await getPlayerForGame(gameCode)
        if (ignore) return
        if (!next || !me) throw new Error('Game or player session not found.')
        ownPlayerId = me.id
        setPlayer(me)
        gameRef.current = null
        await applyGame(next)
        if (ignore || next.status !== 'active') return
        const channel = supabase.channel(`game:${next.id}`)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${next.id}` }, ({ new: state }) => {
            if (ignore) return
            const changed = state.current_question_id !== gameRef.current?.current_question_id || state.question_started_at !== gameRef.current?.question_started_at
            applyGame({ ...gameRef.current, ...state })
            if (changed) startClock()
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_players', filter: `game_id=eq.${next.id}` }, ({ new: row }) => {
            if (ignore) return
            if (row.id === ownPlayerId) setPlayer((prev) => ({ ...prev, balance: row.balance, score: row.score }))
            // Coalesce bursts of score updates into one leaderboard request.
            clearTimeout(refreshTimer)
            refreshTimer = setTimeout(refreshLeaderboard, 180)
          })
        channelRef.current = channel
        channel.subscribe((status) => {
          if (ignore) return
          if (status === 'SUBSCRIBED') refresh()
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnectionError('Connection lost. Reconnecting…')
        })
      } catch (err) { if (!ignore) setError(err.message || 'Could not load game.') }
      finally { if (!ignore) setLoading(false) }
    }
    load()
    return () => {
      ignore = true
      questionVersion++
      gameRef.current = null
      stopClock()
      clearTimeout(refreshTimer)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', resume)
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      channelRef.current = null
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
      if (gameRef.current?.current_question_id !== question.id) return
      setResult((current) => current?.status === 'revealed' ? current : res)
    } catch (err) {
      setSubmitError(err.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleExit() {
    if (window.confirm('Exit this game?')) navigate('/')
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
      {connectionError && <p role="alert" className="field-error">{connectionError} <Button variant="quiet" onClick={() => refreshRef.current()}>Retry</Button></p>}
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
        <div className="player-status">
          <span className="player-identity" title={player.nickname}>
            <span className="avatar">{getAvatarEmoji(player.avatar)}</span>
            <strong>{player.nickname}</strong>
          </span>
          <BalanceDisplay amount={Number(player.balance)} />
        </div>
      </div>

      {/* Question card */}
      {!question ? (
        <Card className="question-card">
          <div className="waiting-status">
            <span className="status-dot" />
            Waiting for the next question…
          </div>
        </Card>
      ) : (
        <Card key={question.id} className="question-card question-enter">
          <h2>{question.question_text}</h2>
          <div className="answers" role="group" aria-label="Choose your answer">
            {options.map(({ letter, text }) => (
              <AnswerOption
                key={letter}
                letter={letter}
                disabled={Boolean(result) || submitting || isTimeUp}
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

      {result?.status === 'pending' && <p role="status">Answer submitted</p>}

      {/* The server releases results only after the answer deadline. */}
      {result?.status === 'revealed' && (
        <Card className="result-card">
          <div className="section-heading">
            <Badge tone={result.is_correct ? 'gold' : 'neutral'}>
              {!result.selected_option ? "Time's up" : result.is_correct ? '✓ Correct' : '✗ Wrong'}
            </Badge>
            <span className="fine-print">
              Correct answer: {result.correct_option}
            </span>
          </div>
          <dl className="result-details">
            <div>
              <dt>Your answer</dt>
              <dd>{result.selected_option || 'Not answered'}</dd>
            </div>
            <div>
              <dt>Bet</dt>
              <dd>₹{Number(result.wager ?? 0).toLocaleString('en-IN')}</dd>
            </div>
            <div>
              <dt>Risk</dt>
              <dd>{result.risk_multiplier ? `${result.risk_multiplier}x` : '—'}</dd>
            </div>
            <div>
              <dt>Balance change</dt>
              <dd className={result.balance_change >= 0 ? '' : 'red-text'}>
                {result.balance_change > 0 ? '+' : result.balance_change < 0 ? '-' : ''}₹
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
              aria-label="Wager"
              type="range"
              className="wager-slider"
              min={player.balance < 10 ? 1 : 10}
              max={Math.max(1, Number(player.balance || 0))}
              step={player.balance < 10 ? 1 : 10}
              value={wager}
              disabled={isTimeUp || submitting || Number(player.balance) <= 0}
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
              disabled={isTimeUp || submitting || Number(player.balance) <= 0}
            />
          </div>

          <div className="submit-area">
            <Button
              className="full-width"
              disabled={!answer || submitting || isTimeUp || Number(player.balance) <= 0}
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
      <Button variant="quiet" className="exit-game" onClick={handleExit}>Exit Game</Button>
    </section>
  )
}
