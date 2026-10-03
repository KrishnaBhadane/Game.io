import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import Button from '../../components/common/Button'
import Input from '../../components/common/Input'
import Card from '../../components/common/Card'

export default function AdminLogin() {
  const { signIn, error } = useAuth()
  const [signingIn, setSigningIn] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (signingIn) return
    const values = new FormData(event.currentTarget)
    setSigningIn(true)
    try {
      await signIn(values.get('email').trim(), values.get('password'))
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <section className="narrow">
      <h1>Admin Login</h1>
      <Card>
        <form className="form-stack" onSubmit={submit}>
          <Input
            label="Email"
            type="email"
            name="email"
            required
            disabled={signingIn}
            autoComplete="username"
            placeholder="captain@example.com"
          />
          <Input
            label="Password"
            type="password"
            name="password"
            required
            disabled={signingIn}
            autoComplete="current-password"
            placeholder="Enter your password"
          />
          <Button type="submit" disabled={signingIn}>
            {signingIn ? 'Signing in…' : 'Log in'}
          </Button>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </form>
      </Card>
      <Button to="/" variant="quiet">
        ← Back to player mode
      </Button>
    </section>
  )
}
