import { createClient } from '@supabase/supabase-js'
import { EXERCISES } from './exerciseCatalogue.js'

const TABLE = 'just_lift_workouts'
const COLUMNS = 'id,user_id,exercise_id,performed_at,rep_count,rep_goal,weight_amount,weight_unit,score'
const PAGE_SIZE = 100
const exerciseIds = new Set(EXERCISES.map(({ id }) => id))
const validSlot = (slot) => slot === 0 || slot === 1
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const integer = (value) => Number.isInteger(value) && value >= 0 && value <= 2147483647
const copyAccount = (account) => account ? { ...account } : null
const failure = (error) => ({ ok: false, error })
const changedAccount = 'The signed-in account changed. Please try again for the current player.'

// Only keys designed for public clients belong in a Vite bundle. Decoding an
// old anon JWT here is a configuration check, not a substitute for server RLS.
function publicKey(key) {
  if (typeof key !== 'string') return false
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true
  try {
    const segments = key.split('.')
    if (segments.length !== 3) return false
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(globalThis.atob(payload)).role === 'anon'
  } catch {
    return false
  }
}

function validUrl(value) {
  try {
    const url = new URL(value)
    return !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  } catch {
    return false
  }
}

function accountFromUser(user) {
  if (!uuid(user?.id) || typeof user.email !== 'string') return null
  const name = typeof user.user_metadata?.display_name === 'string'
    ? user.user_metadata.display_name.trim().slice(0, 40).trim() : ''
  return { id: user.id, name: name || 'Player', email: user.email }
}

function validWorkout(record) {
  return uuid(record?.id) && typeof record.date === 'string' && Number.isFinite(Date.parse(record.date))
    && exerciseIds.has(record.exerciseId) && integer(record.repCount)
    && Number.isInteger(record.goal) && record.goal >= 1 && record.goal <= 999
    && integer(record.score) && record.load
    && (record.load.amount === null || (typeof record.load.amount === 'number'
      && Number.isFinite(record.load.amount) && record.load.amount >= 0 && record.load.amount <= 2000))
    && ['kg', 'lb'].includes(record.load.unit)
}

function toRow(record, userId) {
  return {
    id: record.id.toLowerCase(), user_id: userId, exercise_id: record.exerciseId,
    performed_at: new Date(record.date).toISOString(), rep_count: record.repCount,
    rep_goal: record.goal, weight_amount: record.load.amount,
    weight_unit: record.load.unit, score: record.score,
  }
}

function fromRow(row, userId) {
  if (row?.user_id !== userId) return null
  const record = {
    id: row.id, date: row.performed_at, exerciseId: row.exercise_id,
    repCount: row.rep_count, goal: row.rep_goal,
    load: { amount: row.weight_amount, unit: row.weight_unit }, score: row.score,
  }
  return validWorkout(record) ? { ...record, date: new Date(record.date).toISOString() } : null
}

function authError(error, fallback) {
  const messages = {
    invalid_credentials: 'The email or password is incorrect.',
    email_not_confirmed: 'Confirm your email, then sign in.',
    user_already_exists: 'This email is already registered. Sign in instead.',
    weak_password: 'Choose a stronger password for this account.',
    over_email_send_rate_limit: 'Too many confirmation emails. Please wait before trying again.',
    over_request_rate_limit: 'Too many requests. Please wait before trying again.',
    signup_disabled: 'New account registration is disabled for this project.',
  }
  return messages[error?.code] || fallback
}

/**
 * Two independent, memory-only Supabase sessions. Slots are 0 and 1.
 * Auth methods return {account,error}; signUp also returns needsConfirmation.
 * listWorkouts returns {workouts,error}, newest first. saveWorkout/signOut return
 * {ok,error}. Workout: {id,date,exerciseId,repCount,goal,load:{amount,unit},score}.
 * getAccount is synchronous; subscribe immediately emits account|null and
 * returns an unsubscribe function. No passwords, sessions, or histories are
 * written to browser storage, and no local game history is imported.
 */
export function createAccountService({
  url = import.meta.env?.VITE_SUPABASE_URL,
  key = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env?.VITE_SUPABASE_ANON_KEY,
  createClientImpl = createClient,
} = {}) {
  const accounts = [null, null]
  const epochs = [0, 0]
  const busy = [false, false]
  const listeners = [new Set(), new Set()]
  const clients = []
  let configurationError = ''

  function setAccount(slot, account) {
    const previous = accounts[slot]
    if (previous?.id !== account?.id) epochs[slot] += 1
    accounts[slot] = account
    if (JSON.stringify(previous) === JSON.stringify(account)) return
    for (const listener of listeners[slot]) {
      try { listener(copyAccount(account)) } catch { /* A view cannot break auth. */ }
    }
  }

  function makeClient(slot) {
    const client = createClientImpl(url, key, { auth: {
      storageKey: `just-lift:account:player-${slot + 1}`,
      persistSession: false, autoRefreshToken: true, detectSessionInUrl: false,
    } })
    clients[slot] = client
    client.auth.onAuthStateChange((_event, session) => {
      // Auth calls validate both slots before exposing their result. Never
      // await another Supabase method inside this synchronous SDK callback.
      if (busy[slot] || clients[slot] !== client) return
      const account = accountFromUser(session?.user)
      if (account && accounts[1 - slot]?.id === account.id) {
        setAccount(slot, null)
        setTimeout(async () => {
          // A different login may have started after this SDK event. Its
          // session must never be revoked by an older duplicate cleanup.
          if (busy[slot] || accounts[slot] || clients[slot] !== client) return
          busy[slot] = true
          try { await discardSession(slot, client) } finally { busy[slot] = false }
        }, 0)
        return
      }
      setAccount(slot, account)
    })
  }

  async function discardSession(slot, client) {
    try {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (!error) return
    } catch { /* A failed revoke must not leave a rejected login usable. */ }
    if (clients[slot] === client) {
      client.auth.dispose?.()
      makeClient(slot)
    }
  }

  if (!validUrl(url) || !publicKey(key)) {
    configurationError = 'Accounts are not connected yet. Add the Supabase project URL and public publishable key.'
  } else {
    try {
      for (const slot of [0, 1]) makeClient(slot)
    } catch {
      clients.forEach((client) => client.auth.dispose?.())
      clients.length = 0
      configurationError = 'The account connection could not be initialized. Check the Supabase public settings.'
    }
  }

  const configured = !configurationError
  const errorForSlot = (slot) => !validSlot(slot) ? 'Choose Player 1 or Player 2.' : configurationError

  async function authenticate(slot, credentials, isSignup) {
    const error = errorForSlot(slot)
    if (error) return { account: null, needsConfirmation: false, error }
    if (busy[slot]) return { account: null, needsConfirmation: false, error: 'Finish the current account request before trying again.' }
    const email = typeof credentials?.email === 'string' ? credentials.email.trim() : ''
    const password = credentials?.password
    const name = typeof credentials?.name === 'string' ? credentials.name.trim() : ''
    if (!email || typeof password !== 'string' || !password) {
      return { account: null, needsConfirmation: false, error: 'Enter an email and password.' }
    }
    if (isSignup && (!name || name.length > 40)) {
      return { account: null, needsConfirmation: false, error: 'Enter a name between 1 and 40 characters.' }
    }
    busy[slot] = true
    try {
      const { data, error: authFailure } = isSignup
        ? await clients[slot].auth.signUp({ email, password, options: { data: { display_name: name } } })
        : await clients[slot].auth.signInWithPassword({ email, password })
      if (authFailure) return { account: null, needsConfirmation: false, error: authError(authFailure, 'Unable to sign in. Check your connection and try again.') }
      const account = data?.session ? accountFromUser(data.session.user ?? data.user) : null
      if (account && accounts[1 - slot]?.id === account.id) {
        // Local scope leaves that same person's other device sessions intact.
        setAccount(slot, null)
        await discardSession(slot, clients[slot])
        return { account: null, needsConfirmation: false, error: `This account is already signed in as Player ${2 - slot}. Use a different account.` }
      }
      if (!account && !isSignup) return { account: null, needsConfirmation: false, error: 'Sign-in did not create a session. Please try again.' }
      setAccount(slot, account)
      return { account: copyAccount(account), needsConfirmation: isSignup && !data?.session, error: '' }
    } catch {
      return { account: null, needsConfirmation: false, error: 'Unable to reach the account service. Check your connection and try again.' }
    } finally {
      busy[slot] = false
    }
  }

  async function signOut(slot) {
    const error = errorForSlot(slot)
    if (error) return failure(error)
    if (busy[slot]) return failure('Finish the current account request before signing out.')
    busy[slot] = true
    try {
      const { error: signOutError } = await clients[slot].auth.signOut({ scope: 'local' })
      if (signOutError) return failure('Sign-out could not be completed. Please try again.')
      setAccount(slot, null)
      return { ok: true, error: '' }
    } catch {
      return failure('Sign-out could not be completed. Please try again.')
    } finally {
      busy[slot] = false
    }
  }

  function currentRequest(slot) {
    const error = errorForSlot(slot)
    if (error) return { error }
    if (busy[slot]) return { error: 'Finish signing in before loading or saving workouts.' }
    const account = accounts[slot]
    if (!account) return { error: 'Sign in to this player account first.' }
    const epoch = epochs[slot]
    return { account, client: clients[slot], isCurrent: () => epoch === epochs[slot] && accounts[slot]?.id === account.id }
  }

  async function listWorkouts(slot) {
    const request = currentRequest(slot)
    if (request.error) return { workouts: [], error: request.error }
    const { client, account, isCurrent } = request
    const workouts = new Map()
    let unreadable = 0
    try {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await client.from(TABLE).select(COLUMNS)
          .eq('user_id', account.id).order('performed_at', { ascending: false })
          .order('id', { ascending: false }).range(offset, offset + PAGE_SIZE - 1)
        if (!isCurrent()) return { workouts: [], error: changedAccount }
        if (error || !Array.isArray(data)) return { workouts: [], error: 'Workout history could not be loaded. Please try again.' }
        for (const row of data) {
          const workout = fromRow(row, account.id)
          if (workout) workouts.set(workout.id, workout)
          else unreadable += 1
        }
        if (data.length < PAGE_SIZE) break
      }
      return {
        workouts: [...workouts.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
        error: unreadable ? 'Some workout records could not be read.' : '',
      }
    } catch {
      return { workouts: [], error: 'Workout history could not be loaded. Check your connection and try again.' }
    }
  }

  async function saveWorkout(slot, record) {
    const request = currentRequest(slot)
    if (request.error) return failure(request.error)
    if (!validWorkout(record)) return failure('This workout has invalid results and could not be saved.')
    const { client, account, isCurrent } = request
    // The owner always comes from this slot's authenticated session, never the
    // caller's name, calibration profile, or a supplied user_id.
    const row = toRow(record, account.id)
    try {
      const { error } = await client.from(TABLE).upsert(row, { onConflict: 'id,user_id', ignoreDuplicates: true })
      if (!isCurrent()) return failure(changedAccount)
      if (error) return failure('This workout could not be saved. Please try again.')
      // DO NOTHING makes retries safe. Read back to distinguish an identical
      // retry from accidentally reusing a workout ID for different results.
      const { data, error: readError } = await client.from(TABLE).select(COLUMNS)
        .eq('user_id', account.id).eq('id', row.id).maybeSingle()
      if (!isCurrent()) return failure(changedAccount)
      if (readError || !data) return failure('The workout save could not be confirmed. Retry with the same workout ID.')
      const saved = fromRow(data, account.id)
      if (!saved || JSON.stringify(toRow(saved, account.id)) !== JSON.stringify(row)) {
        return failure('A different workout already uses this workout ID.')
      }
      return { ok: true, error: '' }
    } catch {
      return failure('This workout could not be saved. Check your connection and try again.')
    }
  }

  return {
    configured, configurationError,
    signIn: (slot, credentials) => authenticate(slot, credentials, false),
    signUp: (slot, credentials) => authenticate(slot, credentials, true),
    signOut, listWorkouts, saveWorkout,
    getAccount: (slot) => validSlot(slot) ? copyAccount(accounts[slot]) : null,
    subscribe(slot, callback) {
      if (!validSlot(slot) || typeof callback !== 'function') return () => {}
      listeners[slot].add(callback)
      callback(copyAccount(accounts[slot]))
      return () => listeners[slot].delete(callback)
    },
  }
}
