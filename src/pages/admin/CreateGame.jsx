import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import { createGame } from '../../services/gameService'
import Button from '../../components/common/Button'
import Card from '../../components/common/Card'
import Input from '../../components/common/Input'
import RiskSelector from '../../components/game/RiskSelector'
import { RISK_OPTIONS } from '../../data/constants'

export default function CreateGame() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [allowed, setAllowed] = useState(RISK_OPTIONS)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  function toggle(option) {
    setAllowed((current) =>
      current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option],
    )
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (creating) return
    setError('')

    const formData = new FormData(event.currentTarget)
    const gameName = formData.get('gameName')?.toString().trim() || ''
    const balance = Number(formData.get('balance'))
    const timerValue = formData.get('timer')?.toString().trim()
    const timer = timerValue ? parseInt(timerValue, 10) : null

    if (!gameName) {
      setError('Please enter a game name.')
      return
    }

    if (isNaN(balance) || balance <= 0) {
      setError('Starting balance must be greater than 0.')
      return
    }

    if (allowed.length === 0) {
      setError('Select at least one multiplier.')
      return
    }

    if (timer !== null && (isNaN(timer) || timer <= 0)) {
      setError('Question timer must be a positive number.')
      return
    }

    if (!user?.id) {
      setError('Admin session not found. Please log in again.')
      return
    }

    setCreating(true)
    try {
      const game = await createGame({
        hostId: user.id,
        name: gameName,
        startingBalance: balance,
        allowedMultipliers: allowed,
        questionTimer: timer,
      })

      navigate(`/admin/game/${game.game_code}`)
    } catch (err) {
      setError(err.message || 'Failed to create game. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="narrow">
      <Button to="/admin" variant="quiet">
        ← Dashboard
      </Button>
      <h1>Create Game</h1>
      <Card>
        <form className="form-stack" onSubmit={handleSubmit}>
          <Input
            label="Game Name"
            name="gameName"
            placeholder="e.g. The Grand Line Quiz"
            maxLength={80}
            required
            disabled={creating}
          />
          <Input
            label="Starting Balance"
            name="balance"
            type="number"
            min="1"
            step="1"
            defaultValue="1000"
            hint="Virtual currency only, displayed in ₹."
            required
            disabled={creating}
          />
          <div className="field">
            <p className="field-label">Allowed multipliers</p>
            <RiskSelector value={allowed} onChange={toggle} multiple />
          </div>
          <Input
            label="Question timer (seconds, optional)"
            name="timer"
            type="number"
            min="5"
            step="1"
            placeholder="e.g. 30"
            disabled={creating}
          />
          <Button type="submit" disabled={creating}>
            {creating ? 'Creating game…' : 'Create Game'}
          </Button>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </form>
      </Card>
    </section>
  )
}
