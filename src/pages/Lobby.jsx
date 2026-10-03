import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { getPlayerForGame, getPlayers } from '../services/gameService'
import { getSupabase } from '../lib/supabase'
import { getAvatarEmoji } from '../data/avatars'
import Card from '../components/common/Card'
import Badge from '../components/common/Badge'
import Button from '../components/common/Button'
import BalanceDisplay from '../components/game/BalanceDisplay'

export default function Lobby() {
  const { gameCode } = useParams()
  const navigate = useNavigate()
  const [game, setGame] = useState(null)
  const [player, setPlayer] = useState(null)
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const channelRef = useRef(null)

  useEffect(() => {
    let ignore = false

    async function loadLobby() {
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
            setError('You have not joined this game yet.')
            setLoading(false)
            return
          }

          // If game already active (e.g. refresh after start) go straight to game
          if (gameData.status === 'active') {
            navigate(`/game/${gameCode}`, { replace: true })
            return
          }
          // If game already ended go straight to results
          if (gameData.status === 'ended') {
            navigate(`/results/${gameCode}`, { replace: true })
            return
          }

          setGame(gameData)
          setPlayer(playerData)

          // Fetch existing players
          const list = await getPlayers(gameData.id)
          if (!ignore) setPlayers(list)

          // Subscribe: one channel for this game
          if (channelRef.current) {
            getSupabase().removeChannel(channelRef.current)
            channelRef.current = null
          }
          const supabase = getSupabase()
          const channel = supabase.channel(`game:${gameData.id}`)

          channel
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'game_players',
                filter: `game_id=eq.${gameData.id}`,
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
                filter: `id=eq.${gameData.id}`,
              },
              (payload) => {
                if (payload.new?.status === 'active') {
                  navigate(`/game/${gameCode}`, { replace: true })
                } else if (payload.new?.status === 'ended') {
                  navigate(`/results/${gameCode}`, { replace: true })
                }
              },
            )
            .subscribe()

          channelRef.current = channel
        }
      } catch (err) {
        if (!ignore) {
          setError(err.message || 'Failed to load lobby.')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadLobby()

    return () => {
      ignore = true
      if (channelRef.current) {
        getSupabase().removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [gameCode, navigate])

  if (loading) {
    return (
      <p role="status" className="preview-note">
        Loading lobby…
      </p>
    )
  }

  if (error || !game || !player) {
    return (
      <section className="medium">
        <p role="alert" className="field-error">
          {error || 'Unable to load lobby.'}
        </p>
        <Button to="/join" variant="quiet">
          ← Join a Game
        </Button>
      </section>
    )
  }

  return (
    <section className="medium">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{game.name}</p>
          <h1>You're in the lobby.</h1>
        </div>
        <Badge tone="gold">
          {game.status === 'waiting' ? 'Waiting' : game.status}
        </Badge>
      </div>
      <p className="page-description">
        Welcome, {player.nickname} {getAvatarEmoji(player.avatar)}. Settle in. Your host takes it from here.
      </p>
      <Card className="lobby-banner">
        <div>
          <p className="eyebrow">Game code</p>
          <p className="game-code">{game.game_code}</p>
        </div>
        <div className="waiting-status">
          <span className="status-dot" />
          Waiting for host to start…
        </div>
      </Card>
      <BalanceDisplay amount={Number(player.balance)} label="Current balance" />
      <div className="section-heading">
        <h2>Players joined</h2>
        <Badge>{players.length}</Badge>
      </div>
      <ul className="crew-list">
        {players.map((p) => (
          <li key={p.id}>
            <span className="avatar">{getAvatarEmoji(p.avatar)}</span>
            <span>{p.nickname}</span>
            <span className="muted">Ready</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

