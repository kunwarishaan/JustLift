import LocalGame from './LocalGame.jsx'
import './theme.css'
import './App.css'

export default function App() {
  return (
    <main className="app-shell">
      <header className="app-brand">
        <h1 className="app-brand__mark">Just Lift</h1>
        <p className="app-brand__tagline">Two-player push-ups with live form scoring on your device.</p>
      </header>
      <LocalGame />
    </main>
  )
}
