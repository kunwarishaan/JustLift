import AccountGame from './AccountGame.jsx'
import './Tempo.css'

export default function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <h1 className="app-brand">
          <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M2 7h6v14H2zm9-5h6v24h-6zm9 5h6v14h-6z" fill="currentColor" /></svg>
          Just Lift<span className="brand-edition">TEMPO</span>
        </h1>
        <p className="eyebrow app-header__note">One camera. Your pace.</p>
      </header>
      <AccountGame />
    </main>
  )
}
