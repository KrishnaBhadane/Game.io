import { useState } from 'react'
import { useNavigate } from 'react-router'
import { joinGame } from '../services/gameService'
import { AVATARS } from '../data/avatars'
import Input from '../components/common/Input'
import Button from '../components/common/Button'
import Card from '../components/common/Card'

export default function JoinGame() {
  const navigate = useNavigate()
  const [selectedAvatar, setSelectedAvatar] = useState('straw-hat')
  const [errors, setErrors] = useState({})
  const [generalError, setGeneralError] = useState('')
  const [joining, setJoining] = useState(false)

  async function join(event) {
    event.preventDefault()
    if (joining) return

    setGeneralError('')
    const data = new FormData(event.currentTarget)
    const code = data.get('code')?.toString().trim().toUpperCase() || ''
    const nickname = data.get('nickname')?.toString().trim() || ''
    const next = {}

    if (!code) {
      next.code = 'Enter a game code from your host.'
    } else if (!/^[A-Z0-9]{1,12}$/.test(code)) {
      next.code = 'Use up to 12 letters or numbers.'
    }

    if (!nickname) {
      next.nickname = 'Please enter a nickname.'
    } else if (nickname.length < 2 || nickname.length > 20) {
      next.nickname = 'Use a nickname between 2 and 20 characters.'
    }

    if (!selectedAvatar) {
      next.avatar = 'Please choose an avatar.'
    }

    setErrors(next)
    if (Object.keys(next).length > 0) return

    setJoining(true)
    try {
      const result = await joinGame({ gameCode: code, nickname, avatar: selectedAvatar })
      navigate(`/lobby/${encodeURIComponent(code)}`, {
        state: { nickname: result.player.nickname },
      })
    } catch (err) {
      setGeneralError(err.message || 'Unable to join game. Please try again.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <section className="narrow join-page">
      <h1>Join Game</h1>
      <Card>
        <form noValidate onSubmit={join} className="form-stack">
          <Input
            label="Game Code"
            name="code"
            placeholder="e.g. 842159"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={12}
            required
            disabled={joining}
            error={errors.code}
          />
          <Input
            label="Nickname"
            name="nickname"
            placeholder="Nickname"
            autoComplete="nickname"
            minLength={2}
            maxLength={20}
            required
            disabled={joining}
            error={errors.nickname}
          />

          <div className="field">
            <label id="avatar-label">Choose your Avatar</label>
            <div
              className="avatar-picker"
              role="radiogroup"
              aria-labelledby="avatar-label"
            >
              {AVATARS.map((av) => (
                <button
                  key={av.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedAvatar === av.id}
                  className={`avatar-tile ${selectedAvatar === av.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedAvatar(av.id)}
                  disabled={joining}
                >
                  <span aria-hidden="true">{av.emoji}</span>
                  <span className="avatar-tile-label">{av.name}</span>
                </button>
              ))}
            </div>
            {errors.avatar && (
              <p role="alert" className="field-error">
                {errors.avatar}
              </p>
            )}
          </div>

          <Button type="submit" disabled={joining}>
            {joining ? 'Joining…' : <>Join Game <span aria-hidden="true">→</span></>}
          </Button>
          {generalError && (
            <p role="alert" className="field-error">
              {generalError}
            </p>
          )}
        </form>
      </Card>
    </section>
  )
}


