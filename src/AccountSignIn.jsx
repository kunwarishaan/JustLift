import { useState } from 'react'

export default function AccountSignIn({ slot, onSignIn, onCreateAccount, configured, otherAccount, onProgress }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function changeMode() {
    setCreating(!creating)
    setPassword('')
    setError('')
    setMessage('')
  }

  async function submit(event) {
    event.preventDefault()
    if (busy || !configured) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await (creating ? onCreateAccount({ name: name.trim(), email: email.trim(), password }) : onSignIn({ email: email.trim(), password }))
      setPassword('')
      if (result.error) setError(result.error)
      else if (result.needsConfirmation) {
        setCreating(false)
        setMessage('Check your email to confirm your account, then sign in here.')
      }
    } catch {
      setPassword('')
      setError('We could not connect. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <section className={`account-auth player-theme-${slot + 1}`} aria-label={`Player ${slot + 1} account`}>
    <div className="account-auth__intro">
      <p className="eyebrow">Your progress starts here</p>
      <h2 className="wide-type">Every rep.<br /><span>All yours.</span></h2>
      <p>Pick up where you left off. Your exercises, your goals, your progress—saved to your account.</p>
      <div className="account-auth__steps"><span>01 / Sign in</span><span>02 / Set your goal</span><span>03 / Make it count</span></div>
      {otherAccount && <p className="account-auth__signed-in">{otherAccount.name} is signed in and ready.<button type="button" className="button button--quiet" onClick={onProgress}>View progress</button></p>}
    </div>
    <form className="account-auth__form" onSubmit={submit}>
      <p className="eyebrow">Player {slot + 1} / 02</p>
      <h3 className="wide-type">{creating ? 'Create account.' : 'Welcome back.'}</h3>
      <p>{creating ? 'A name. An email. A new personal best.' : 'Sign in to your own workout history.'}</p>
      {!configured && <p className="account-notice" role="status">Account service is not connected yet. Sign-in will be available once setup is complete.</p>}
      <fieldset disabled={busy || !configured}>
        {creating && <label>Name<input name="name" autoComplete="name" type="text" maxLength="40" required value={name} onChange={event => setName(event.target.value)} /></label>}
        <label>Email<input name="email" autoComplete="username" type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<input name="password" autoComplete={creating ? 'new-password' : 'current-password'} type="password" required minLength={creating ? 8 : undefined} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {creating && <small>Use at least 8 characters.</small>}
        <button className="button button--primary" type="submit">{busy ? 'Connecting…' : creating ? 'Create account' : 'Sign in'}</button>
      </fieldset>
      {error && <p className="account-notice" role="alert">{error}</p>}
      {message && <p className="account-notice" role="status">{message}</p>}
      <button className="button button--quiet account-auth__switch" type="button" disabled={busy} onClick={changeMode}>{creating ? 'Already have an account? Sign in' : 'Create account'}</button>
    </form>
  </section>
}
