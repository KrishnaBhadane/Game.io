import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { getGameByCode, getPlayers, startGame, endGame } from '../../services/gameService'
import { publishQuestion } from '../../services/questionService'
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

    async function loadGame() {
      if (!gameCode) return
      setLoading(true)
      setError('')
      try {
        const data = await getGameByCode(gameCode)
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
                setGame((prev) => ({
                  ...prev,
                  ...(payload.new?.status && { status: payload.new.status }),
                  ...(payload.new?.current_question_id !== undefined && {
                    current_question_id: payload.new.current_question_id,
                  }),
                }))
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
              async () => {
                if (ignore) return
                setSubmissionCount((n) => n + 1)
                await loadLeaderboard(data.id)
              },
            )
            .subscribe()

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
      if (channelRef.current) {
        getSupabase().removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [gameCode])

  async function handleStart() {
    if (!game || starting) return
    setStarting(true)
    try {
      await startGame(game.id)
      setGame((prev) => ({ ...prev, status: 'active' }))
    } catch (err) {
      setError(err.message || 'Failed to start game.')
    } finally {
      setStarting(false)
    }
  }

  async function handlePublish(questionId) {
    if (!game || game.status !== 'active' || publishing) return
    setPublishing(true)
    try {
      await publishQuestion(game.id, questionId)
      setGame((prev) => ({ ...prev, current_question_id: questionId }))
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

  if (error || !game) {
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
    <section>
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
            {players.length}<span> / 200 target</span>
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
