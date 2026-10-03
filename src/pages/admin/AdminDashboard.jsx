import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { deleteGame, getGamesByHost } from '../../services/gameService'
import Button from '../../components/common/Button'
import Card from '../../components/common/Card'
import Badge from '../../components/common/Badge'

export default function AdminDashboard() {
  const { user, logout, error: authError } = useAuth()
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [deletingId, setDeletingId] = useState('')

  useEffect(() => {
    let ignore = false

    async function loadGames() {
      if (!user?.id) return
      setLoading(true)
      setFetchError('')
      try {
        const data = await getGamesByHost(user.id)
        if (!ignore) {
          setGames(data)
        }
      } catch (err) {
        if (!ignore) {
          setFetchError(err.message || 'Failed to load games.')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    loadGames()
    return () => {
      ignore = true
    }
  }, [user?.id])

  async function handleLogout() {
    setSigningOut(true)
    try {
      await logout()
    } finally {
      setSigningOut(false)
    }
  }

  async function handleDelete(game) {
    if (!window.confirm(`Delete ${game.name}?`)) return
    setDeletingId(game.id)
    setFetchError('')
    try {
      await deleteGame(game.id)
      setGames((current) => current.filter((item) => item.id !== game.id))
    } catch (err) {
      setFetchError(err.message || 'Could not delete game.')
    } finally {
      setDeletingId('')
    }
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Welcome back.</h1>
        </div>
        <Button to="/admin/create">Create Game</Button>
      </div>
      <Button variant="quiet" onClick={handleLogout} disabled={signingOut}>
        {signingOut ? 'Logging out…' : 'Logout'}
      </Button>
      {authError && (
        <p role="alert" className="field-error">
          {authError}
        </p>
      )}
      <div className="section-heading">
        <h2>Recent games</h2>
      </div>
      {loading && (
        <p role="status" className="preview-note">
          Loading games…
        </p>
      )}
      {fetchError && (
        <p role="alert" className="field-error">
          {fetchError}
        </p>
      )}
      {!loading && games.length === 0 && (
        <p className="muted">No games created yet.</p>
      )}
      {!loading && games.length > 0 && (
        <div className="recent-grid">
          {games.map((game) => (
            <Card key={game.id}>
              <div className="section-heading">
                <Badge tone={game.status === 'waiting' ? 'gold' : 'neutral'}>
                  {game.status}
                </Badge>
                <span className="fine-print">#{game.game_code}</span>
              </div>
              <h3>{game.name}</h3>
              <p className="muted">
                {new Date(game.created_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
              <Button variant="quiet" to={`/admin/game/${game.game_code}`}>
                Control game →
              </Button>
              {game.status !== 'active' && (
                <Button
                  variant="danger"
                  onClick={() => handleDelete(game)}
                  disabled={deletingId === game.id}
                >
                  {deletingId === game.id ? 'Deleting…' : 'Delete Game'}
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
