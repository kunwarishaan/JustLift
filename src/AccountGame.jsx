import { useCallback, useEffect, useRef, useState } from 'react'
import { createAccountService } from './accountService.js'
import AccountSignIn from './AccountSignIn.jsx'
import AccountWorkoutSetup from './AccountWorkoutSetup.jsx'
import GameScreen from './GameScreen.jsx'
import WorkoutProgress from './WorkoutProgress.jsx'
import { DEFAULT_EXERCISE_ID, getExercise } from './exerciseCatalogue.js'
import './CompanionScreens.css'
import './Accounts.css'

let defaultService
const emptyHistory = () => ({ workouts: [], loading: false, error: '' })

export default function AccountGame({ service: providedService }) {
  const [service] = useState(() => providedService ?? (defaultService ??= createAccountService()))
  const [accounts, setAccounts] = useState([null, null])
  const [histories, setHistories] = useState([emptyHistory(), emptyHistory()])
  const [view, setView] = useState('workout')
  const [progressSlot, setProgressSlot] = useState(0)
  const [exerciseId, setExerciseId] = useState(DEFAULT_EXERCISE_ID)
  const [round, setRound] = useState(null)
  const [setupVersion, setSetupVersion] = useState(0)
  const [status, setStatus] = useState({ phase: 'ready', currentPlayer: 0 })
  const [saves, setSaves] = useState([])
  const [accountError, setAccountError] = useState('')
  const historyRequests = useRef([0, 0])
  const accountsRef = useRef([null, null])
  const savingIds = useRef(new Set())
  const mounted = useRef(true)

  const refreshHistory = useCallback(async (slot) => {
    const account = service.getAccount(slot)
    if (!account) return
    const request = ++historyRequests.current[slot]
    setHistories(current => current.map((history, index) => index === slot ? { ...history, loading: true, error: '' } : history))
    let result
    try { result = await service.listWorkouts(slot) }
    catch { result = { workouts: [], error: 'Workout history could not be loaded. Please try again.' } }
    if (!mounted.current || request !== historyRequests.current[slot] || service.getAccount(slot)?.id !== account.id) return
    setHistories(current => current.map((history, index) => index === slot ? {
      // History is immutable. Merge so a refresh already in flight cannot erase
      // a workout that finished saving while that request was running.
      workouts: [...new Map([...result.workouts, ...history.workouts].map(workout => [workout.id, workout])).values()],
      loading: false, error: result.error,
    } : history))
  }, [service])

  useEffect(() => {
    mounted.current = true
    accountsRef.current = [null, null]
    const subscriptions = [0, 1].map(slot => service.subscribe(slot, account => {
      const previous = accountsRef.current[slot]
      accountsRef.current = accountsRef.current.map((entry, index) => index === slot ? account : entry)
      setAccounts([...accountsRef.current])
      if (previous?.id === account?.id) return
      historyRequests.current[slot] += 1
      setHistories(current => current.map((history, index) => index === slot ? { ...emptyHistory(), loading: Boolean(account) } : history))
      setRound(null)
      setStatus({ phase: 'ready', currentPlayer: 0 })
      setView('workout')
      setSaves(current => current.map(save => save.slot === slot && save.state === 'saving'
        ? { ...save, state: 'error', error: 'Sign in to this account again, then retry saving this workout.' } : save))
      if (account) void refreshHistory(slot)
    }))
    return () => {
      mounted.current = false
      historyRequests.current = historyRequests.current.map(request => request + 1)
      subscriptions.forEach(unsubscribe => unsubscribe())
    }
  }, [service, refreshHistory])

  const saveWorkout = useCallback(async (entry) => {
    if (savingIds.current.has(entry.record.id) || service.getAccount(entry.slot)?.id !== entry.ownerId) return
    savingIds.current.add(entry.record.id)
    setSaves(current => current.map(save => save.record.id === entry.record.id ? { ...save, state: 'saving', error: '' } : save))
    let result
    try { result = await service.saveWorkout(entry.slot, entry.record) }
    catch { result = { ok: false, error: 'Workout could not be saved. Please retry.' } }
    savingIds.current.delete(entry.record.id)
    if (!mounted.current || service.getAccount(entry.slot)?.id !== entry.ownerId) return
    setSaves(current => current.map(save => save.record.id === entry.record.id ? { ...save, state: result.ok ? 'saved' : 'error', error: result.error } : save))
    if (result.ok) setHistories(current => current.map((history, slot) => slot === entry.slot ? {
      ...history, workouts: [entry.record, ...history.workouts.filter(workout => workout.id !== entry.record.id)],
    } : history))
  }, [service])

  const handleTurnComplete = useCallback((player, slot) => {
    if (!round) return
    const owner = round.accounts[slot]
    const entry = {
      ownerId: owner.id, name: owner.name, slot, state: 'saving', error: '',
      record: { id: crypto.randomUUID(), date: new Date().toISOString(), exerciseId: round.exerciseId,
        repCount: player.repCount, goal: player.goal, score: player.score, load: { ...round.loads[slot] } },
    }
    setSaves(current => [...current, entry])
    void saveWorkout(entry)
  }, [round, saveWorkout])

  function resetSetup() {
    setRound(null)
    setSetupVersion(current => current + 1)
    setStatus({ phase: 'ready', currentPlayer: 0 })
    setView('workout')
  }

  function changeExercise(id) {
    setExerciseId(getExercise(id).id)
    resetSetup()
  }

  function beginRound(goals, loads) {
    if (!accounts.every(Boolean)) return
    setRound({ accounts: accounts.map(account => ({ ...account })), exerciseId, goals, loads })
    setStatus({ phase: 'ready', currentPlayer: 0 })
    setView('workout')
  }

  async function signOut(slot) {
    const result = await service.signOut(slot)
    setAccountError(result.error)
  }

  const neededSlot = accounts[0] ? accounts[1] ? null : 1 : 0
  const active = Boolean(round && status.phase === 'active')
  const accountsLocked = Boolean(round && (active || (status.phase === 'ready' && status.currentPlayer === 1)))
  const visibleSaves = saves.filter(save => accounts[save.slot]?.id === save.ownerId)
  const hasPendingSaves = visibleSaves.some(save => save.state !== 'saved')
  const selectedProgressSlot = accounts[progressSlot] ? progressSlot : accounts[0] ? 0 : 1
  const progressAccount = accounts[selectedProgressSlot]
  const historyLoading = histories.some((history, slot) => accounts[slot] && history.loading)

  return <>
    {accounts.some(Boolean) && <nav className="account-bar" aria-label="Account navigation">
      <div className="account-bar__tabs">
        <button className="button button--quiet" type="button" aria-current={view === 'workout' ? 'page' : undefined} disabled={active} onClick={() => setView('workout')}>Workout</button>
        <button className="button button--quiet" type="button" aria-current={view === 'progress' ? 'page' : undefined} disabled={active} onClick={() => setView('progress')}>Progress</button>
      </div>
      <div className="account-bar__players">{accounts.map((account, slot) => account && <div className="account-bar__player" key={slot}>
        <span title={account.email}>P{slot + 1} · {account.name}</span>
        <button type="button" aria-label={`Sign out Player ${slot + 1}`} disabled={accountsLocked || hasPendingSaves} onClick={() => signOut(slot)}>Sign out</button>
      </div>)}</div>
    </nav>}
    {accountError && <p className="account-notice account-sync" role="alert">{accountError}</p>}
    {visibleSaves.length > 0 && <div className="account-sync" aria-label="Workout saves">
      {visibleSaves.map(entry => <p className="account-notice" role={entry.state === 'error' ? 'alert' : 'status'} key={entry.record.id}>
        {entry.name}: {entry.state === 'saved' ? `${getExercise(entry.record.exerciseId).name} saved to your account.` : entry.state === 'saving' ? 'Saving workout…' : entry.error}
        {entry.state === 'error' && <><button type="button" className="button" onClick={() => saveWorkout(entry)}>Retry save</button><span>Keep this page open until the save succeeds.</span></>}
      </p>)}
    </div>}
    <div hidden={view !== 'workout'}>
      {neededSlot !== null ? <AccountSignIn key={neededSlot} slot={neededSlot} configured={service.configured}
        otherAccount={accounts[1 - neededSlot]} onProgress={() => setView('progress')}
        onSignIn={credentials => service.signIn(neededSlot, credentials)} onCreateAccount={credentials => service.signUp(neededSlot, credentials)} /> : <>
        {!round && histories.map((history, slot) => history.error && <p className="account-notice account-sync" role="alert" key={slot}>
          {accounts[slot].name}: {history.error} Fields without loaded history stay blank.
          <button className="button button--quiet" type="button" onClick={() => refreshHistory(slot)}>Retry history</button>
        </p>)}
        {round ? <GameScreen playerNames={round.accounts.map(account => account.name)} playerGoals={round.goals} playerLoads={round.loads}
          exerciseId={round.exerciseId} onExerciseChange={changeExercise} onTurnComplete={handleTurnComplete} onStatusChange={setStatus}
          onEditPlayers={resetSetup} onReplay={resetSetup} onShowStats={() => setView('progress')} />
          : hasPendingSaves ? <p className="account-loading" role="status">{visibleSaves.some(save => save.state === 'error') ? 'Retry the unsaved workouts above before choosing your next goals.' : 'Saving your last workout before filling your next goals…'}</p>
            : historyLoading ? <p className="account-loading" role="status">Loading your workout history…</p>
            : <AccountWorkoutSetup key={`${exerciseId}:${setupVersion}:${accounts.map(account => account.id).join(':')}`} accounts={accounts}
              workouts={histories.map(history => history.workouts)} exerciseId={exerciseId} onExerciseChange={changeExercise} onContinue={beginRound} />}
      </>}
    </div>
    {view === 'progress' && progressAccount && <>
      <div className="account-progress-controls"><label>Account<select aria-label="Progress account" value={selectedProgressSlot} onChange={event => setProgressSlot(Number(event.target.value))}>
        {accounts.map((account, slot) => account && <option key={slot} value={slot}>{account.name} · Player {slot + 1}</option>)}
      </select></label><button className="button button--quiet" type="button" disabled={histories[selectedProgressSlot].loading} onClick={() => refreshHistory(selectedProgressSlot)}>Refresh history</button></div>
      {histories[selectedProgressSlot].error && <p className="account-notice account-sync" role="alert">{histories[selectedProgressSlot].error}</p>}
      {histories[selectedProgressSlot].loading && <p className="account-notice account-sync" role="status">Refreshing workout history…</p>}
      <WorkoutProgress key={progressAccount.id} workouts={histories[selectedProgressSlot].workouts} initialExerciseId={exerciseId} accountName={progressAccount.name} onBack={() => setView('workout')} />
    </>}
  </>
}
