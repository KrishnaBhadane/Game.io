import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { getGameByCode, getPlayers, startGame, endGame } from '../../services/gameService'
import { watchGameDeadline, publishQuestion } from '../../services/questionService'
import { getLeaderboard } from '../../services/submissionService'
import { getSupabase } from '../../lib/supabase'
import Button from '../../components/common/Button'
import Card from '../../components/common/Card'
import Badge from '../../components/common/Badge'
import QuestionBank from '../../components/game/QuestionBank'
import Leaderboard from '../../components/leaderboard/Leaderboard'
import { getAvatarEmoji } from '../../data/avatars'

export default function GameControl() {
  const { gameCode } = useParams()
  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [ending, setEnding] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [leaderboard, setLeaderboard] = useState([])
  const [submissionCount, setSubmissionCount] = useState(0)
  const channelRef = useRef(null)
  const [reconnect, setReconnect] = useState(0)
  const [connectionError, setConnectionError] = useState('')
  const gameRef = useRef(null)
  gameRef.current = game

  async function loadLeaderboard(gameId) {
    try {
      const rows = await getLeaderboard(gameId)
      setLeaderboard(rows)
    } catch {
      // non-fatal
    }
  }

  async function loadSubmissionCount(gameId, questionId) {
    if (!questionId) {
      setSubmissionCount(0)
      return
    }
    try {
      const { count, error: countErr } = await getSupabase()
        .from('submissions')
        .select('*', { count: 'exact', head: true })
        .eq('game_id', gameId)
        .eq('question_id', questionId)
      if (!countErr && typeof count === 'number') {
        setSubmissionCount(count)
      }
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    let ignore = false
    let leaderboardTimer
    let reconnecting = false

    async function loadGame() {
      if (!gameCode) return
      setLoading(true)
      setError('')
      try {
        let data = await getGameByCode(gameCode)
        if (!ignore) {
          if (!data) {
            setError('Game not found.')
            setLoading(false)
            return
          }
          setGame(data)

          // Fetch existing players and initial leaderboard
          const list = await getPlayers(data.id)
          if (!ignore) {
            setPlayers(list)
            await loadLeaderboard(data.id)
            if (data.current_question_id) {
              await loadSubmissionCount(data.id, data.current_question_id)
            }
          }

          if (ignore) return
          // Clean up any existing channel before subscribing
          if (channelRef.current) {
            getSupabase().removeChannel(channelRef.current)
            channelRef.current = null
          }

          // One channel per game for admin
          const supabase = getSupabase()
          const channel = supabase.channel(`admin:${data.id}`)

          channel
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'game_players',
                filter: `game_id=eq.${data.id}`,
              },
              (payload) => {
                if (ignore) return
                clearTimeout(leaderboardTimer)
                leaderboardTimer = setTimeout(() => loadLeaderboard(data.id), 180)
                if (payload.eventType === 'INSERT') {
                  setPlayers((prev) => {
                    if (prev.some((p) => p.id === payload.new.id)) return prev
                    return [...prev, payload.new]
                  })
                } else if (payload.eventType === 'UPDATE') {
                  setPlayers((prev) =>
                    prev.map((p) =>
                      p.id === payload.new.id ? { ...p, ...payload.new } : p,
                    ),
                  )
                } else if (payload.eventType === 'DELETE') {
                  setPlayers((prev) =>
                    prev.filter((p) => p.id !== payload.old.id),
                  )
                }
              },
            )
            .on(
              'postgres_changes',
              {
                event: 'UPDATE',
                schema: 'public',
                table: 'games',
                filter: `id=eq.${data.id}`,
              },
              (payload) => {
                if (ignore) return
                setGame((prev) => ({ ...prev, ...payload.new }))
                // Update submission count when question changes
                if (
                  payload.new?.current_question_id !==
                  payload.old?.current_question_id
                ) {
                  loadSubmissionCount(data.id, payload.new?.current_question_id)
                }
              },
            )
            .on(
              'postgres_changes',
              {
                event: 'INSERT',
                schema: 'public',
                table: 'submissions',
                filter: `game_id=eq.${data.id}`,
              },
              (payload) => {
                if (ignore) return
                if (payload.new.question_id === gameRef.current?.current_question_id) setSubmissionCount((n) => n + 1)
              },
            )
            .subscribe(async (status) => {
              if (ignore) return
              if (status === 'SUBSCRIBED' && !reconnecting) {
                reconnecting = true
                try {
                  const [fresh, crew] = await Promise.all([getGameByCode(gameCode), getPlayers(data.id)])
                  if (ignore) return
                  if (!fresh) throw new Error('Game not found.')
                  setGame(fresh)
                  setPlayers(crew)
                  setReconnect((n) => n + 1)
                  setConnectionError('')
                  await Promise.all([loadLeaderboard(data.id), loadSubmissionCount(data.id, fresh.current_question_id)])
                } catch { if (!ignore) setConnectionError('Could not reconnect. Refresh to retry.') }
                finally { reconnecting = false }
              } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                setConnectionError('Connection lost. Reconnecting…')
              }
            })

          channelRef.current = channel
        }
      } catch (err) {
        if (!ignore) {
          setError(err.message || 'Failed to load game.')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadGame()
    return () => {
      ignore = true
      clearTimeout(leaderboardTimer)
      if (channelRef.current) {
        getSupabase().removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [gameCode])

  useEffect(() => {
    if (!game?.id || game.status !== 'active') return
    return watchGameDeadline(game.id, (state) => {
      setGame((prev) => ({ ...prev, ...state }))
    }, () => setConnectionError('Could not advance. Refresh to retry.'))
  }, [game?.id, game?.status, game?.current_question_id, game?.question_started_at, reconnect])

  async function handleStart() {
    if (!game || starting) return
    setError('')
    setStarting(true)
    try {
      const startedGame = await startGame(game.id)
      setGame((prev) => ({ ...prev, ...startedGame }))
    } catch (err) {
      setError(err.message || 'Failed to start game.')
    } finally {
      setStarting(false)
    }
  }

  async function handlePublish(questionId) {
    if (!game || game.status !== 'active' || publishing) return
    setError('')
    setPublishing(true)
    try {
      await publishQuestion(game.id, questionId)
      setGame(await getGameByCode(gameCode))
      await loadSubmissionCount(game.id, questionId)
    } catch (err) {
      setError(err.message || 'Failed to publish question.')
    } finally {
      setPublishing(false)
    }
  }

  async function handleEnd() {
    if (!game || game.status !== 'active' || ending) return
    if (!window.confirm('End the game? Players will see final results.')) return
    setEnding(true)
    try {
      await endGame(game.id)
      setGame((prev) => ({ ...prev, status: 'ended' }))
      await loadLeaderboard(game.id)
    } catch (err) {
      setError(err.message || 'Failed to end game.')
    } finally {
      setEnding(false)
    }
  }

  if (loading) {
    return (
      <p role="status" className="preview-note">
        Loading game…
      </p>
    )
  }

  if (!game) {
    return (
      <section>
        <Button to="/admin" variant="quiet">
          ← Dashboard
        </Button>
        <p role="alert" className="field-error">
          {error || 'Game not found.'}
        </p>
      </section>
    )
  }

  return (
    <section className="control-page">
      {(error || connectionError) && <p role="alert" className="field-error">{error || connectionError}</p>}
      <Button to="/admin" variant="quiet">
        ← Dashboard
      </Button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Host control room</p>
          <h1>{game.name}</h1>
        </div>
        <Badge tone={game.status === 'waiting' ? 'gold' : 'neutral'}>
          {game.status}
        </Badge>
      </div>
      <div className="control-summary">
        <Card>
          <p className="eyebrow">Game code</p>
          <p className="game-code">{game.game_code}</p>
        </Card>
        <Card>
          <p className="eyebrow">Players joined</p>
          <p className="stat-number">
            {players.length}
          </p>
        </Card>
        <Card>
          <p className="eyebrow">Game status</p>
          <p className="stat-label">
            {game.status === 'waiting' ? 'Waiting to begin' : game.status}
          </p>
          {game.status === 'waiting' && (
            <Button onClick={handleStart} disabled={starting}>
              {starting ? 'Starting…' : 'Start Game'}
            </Button>
          )}
          {game.status === 'active' && (
            <Button variant="quiet" onClick={handleEnd} disabled={ending}>
              {ending ? 'Ending…' : 'End Game'}
            </Button>
          )}
        </Card>
        {game.status === 'active' && (
          <Card>
            <p className="eyebrow">Submissions</p>
            <p className="stat-number">
              {submissionCount}<span> / {players.length}</span>
            </p>
          </Card>
        )}
      </div>
      <div className="control-layout">
        <Card>
          <QuestionBank
            gameId={game.id}
            refreshKey={reconnect}
            currentQuestionId={game.current_question_id}
            onPublish={game.status === 'active' ? handlePublish : undefined}
          />
        </Card>
        <Card>
          <div className="section-heading">
            <h2>The crew</h2>
            <Badge>{players.length}</Badge>
          </div>
          <ul className="crew-list">
            {players.length === 0 && (
              <li>
                <span className="muted">No players yet.</span>
              </li>
            )}
            {players.map((p) => (
              <li key={p.id}>
                <span className="avatar">{getAvatarEmoji(p.avatar)}</span>
                <span>{p.nickname}</span>
                <span className="muted">₹{Number(p.balance).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {leaderboard.length > 0 && (
        <>
          <div className="section-heading">
            <h2>Leaderboard</h2>
            <Badge>{leaderboard.length}</Badge>
          </div>
          <Card className="leaderboard-card">
            <Leaderboard players={leaderboard} />
          </Card>
        </>
      )}
    </section>
  )
}
