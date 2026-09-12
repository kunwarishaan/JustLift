import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAccountService } from './accountService.js'

const URL = 'https://example.supabase.co'
const KEY = 'sb_publishable_test_public_key'
const uid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const user = (number, name = `Person ${number}`) => ({ id: uid(number), email: `person${number}@example.com`, user_metadata: { display_name: name } })
const workout = (number = 1, changes = {}) => ({
  id: uid(1000 + number), date: '2026-09-12T12:00:00.000Z', exerciseId: 'push-ups',
  repCount: 7, goal: 10, load: { amount: null, unit: 'kg' }, score: 14, ...changes,
})
const rowFor = (record, owner) => ({
  id: record.id, user_id: owner.id, performed_at: record.date, exercise_id: record.exerciseId,
  rep_count: record.repCount, rep_goal: record.goal, weight_amount: record.load.amount,
  weight_unit: record.load.unit, score: record.score,
})
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function harness({ rows = new Map() } = {}) {
  const clients = []
  const people = new Map([user(1), user(2), user(3)].map((person) => [person.email, person]))
  const createClientImpl = vi.fn(() => {
    const client = { currentUser: null, callbacks: [], queries: [], authFailure: null, signOutFailure: null, queryFailure: null, beforeQuery: null, confirmation: false }
    client.emit = (event, person) => {
      client.currentUser = person
      client.callbacks.forEach((callback) => callback(event, person ? { user: person } : null))
    }
    client.auth = {
      onAuthStateChange: vi.fn((callback) => { client.callbacks.push(callback); return { data: { subscription: { unsubscribe: vi.fn() } } } }),
      signInWithPassword: vi.fn(async ({ email }) => {
        if (client.authFailure) return { data: null, error: client.authFailure }
        const person = people.get(email)
        client.emit('SIGNED_IN', person)
        return { data: { user: person, session: { user: person } }, error: null }
      }),
      signUp: vi.fn(async ({ email, options }) => {
        if (client.authFailure) return { data: null, error: client.authFailure }
        const person = { ...user(4), email, user_metadata: options.data }
        if (!client.confirmation) client.emit('SIGNED_IN', person)
        return { data: { user: person, session: client.confirmation ? null : { user: person } }, error: null }
      }),
      signOut: vi.fn(async () => {
        if (client.signOutFailure) return { error: client.signOutFailure }
        client.emit('SIGNED_OUT', null)
        return { error: null }
      }),
      dispose: vi.fn(),
    }
    client.from = vi.fn((table) => {
      const query = {
        table, action: 'select', filters: [], orders: [], bounds: null, single: false,
        select(columns) { this.columns = columns; return this },
        upsert(row, options) { this.action = 'upsert'; this.row = structuredClone(row); this.options = options; return this },
        eq(column, value) { this.filters.push([column, value]); return this },
        order(column, options) { this.orders.push([column, options]); return this },
        range(from, to) { this.bounds = [from, to]; return this },
        maybeSingle() { this.single = true; return this },
        then(resolve, reject) {
          return Promise.resolve().then(async () => {
            if (client.beforeQuery) await client.beforeQuery(query)
            if (client.queryFailure) return { data: null, error: client.queryFailure }
            if (query.action === 'upsert') {
              if (query.row.user_id !== client.currentUser?.id) return { error: { code: '42501' } }
              const key = `${query.row.user_id}:${query.row.id}`
              if (!rows.has(key)) rows.set(key, structuredClone(query.row))
              return { data: null, error: null }
            }
            let selected = [...rows.values()].filter((row) => query.filters.every(([key, value]) => row[key] === value))
            selected.sort((a, b) => b.performed_at.localeCompare(a.performed_at) || b.id.localeCompare(a.id))
            if (query.bounds) selected = selected.slice(query.bounds[0], query.bounds[1] + 1)
            return { data: query.single ? selected[0] ?? null : selected.map((row) => structuredClone(row)), error: null }
          }).then(resolve, reject)
        },
      }
      client.queries.push(query)
      return query
    })
    clients.push(client)
    return client
  })
  const service = createAccountService({ url: URL, key: KEY, createClientImpl })
  const signIn = (slot, number = slot + 1) => service.signIn(slot, { email: user(number).email, password: 'test password' })
  return { service, clients, createClientImpl, rows, people, signIn }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('account configuration and session isolation', () => {
  it('does no work without public backend settings and rejects secret/service-role keys', async () => {
    const jwt = (role) => `e30.${btoa(JSON.stringify({ role }))}.signature`
    const createClientImpl = vi.fn()
    for (const settings of [
      { url: '', key: '' }, { url: URL, key: 'sb_secret_do_not_use' },
      { url: URL, key: jwt('service_role') }, { url: 'http://untrusted.example', key: KEY },
      { url: 'https://user:password@example.com', key: KEY },
    ]) {
      const service = createAccountService({ ...settings, createClientImpl })
      expect(service.configured).toBe(false)
      expect(service.getAccount(0)).toBeNull()
      expect((await service.signIn(0, {})).error).toMatch(/not connected/i)
      expect((await service.listWorkouts(0)).workouts).toEqual([])
      expect((await service.saveWorkout(0, workout())).ok).toBe(false)
    }
    expect(createClientImpl).not.toHaveBeenCalled()
    const stub = () => ({ auth: { onAuthStateChange: vi.fn() } })
    expect(createAccountService({ url: URL, key: jwt('anon'), createClientImpl: stub }).configured).toBe(true)
  })

  it('creates two independent memory-only sessions and never accesses browser storage', async () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => { throw Error('No storage allowed') }), setItem: vi.fn(() => { throw Error('No storage allowed') }) })
    const { service, createClientImpl, clients, signIn } = harness()
    expect(service.configured).toBe(true)
    expect(createClientImpl).toHaveBeenCalledTimes(2)
    expect(createClientImpl.mock.calls.map(([, , options]) => options.auth)).toEqual([0, 1].map((slot) => ({
      storageKey: `just-lift:account:player-${slot + 1}`,
      persistSession: false, autoRefreshToken: true, detectSessionInUrl: false,
    })))
    await Promise.all([signIn(0), signIn(1)])
    expect(service.getAccount(0)).toEqual({ id: uid(1), name: 'Person 1', email: user(1).email })
    expect(service.getAccount(1)?.id).toBe(uid(2))
    expect(clients[0].currentUser.id).not.toBe(clients[1].currentUser.id)
    expect(localStorage.getItem).not.toHaveBeenCalled()
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })

  it('returns account snapshots and emits validated identity changes, including refresh and sign-out', async () => {
    const { service, clients, signIn } = harness()
    const listener = vi.fn()
    const unsubscribe = service.subscribe(0, listener)
    expect(listener).toHaveBeenLastCalledWith(null)
    await signIn(0)
    expect(listener).toHaveBeenCalledTimes(2)
    const copy = service.getAccount(0)
    copy.name = 'Mutated'
    expect(service.getAccount(0).name).toBe('Person 1')
    clients[0].emit('TOKEN_REFRESHED', user(1))
    expect(listener).toHaveBeenCalledTimes(2)
    clients[0].emit('USER_UPDATED', user(1, 'Updated'))
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Updated' }))
    unsubscribe()
    clients[0].emit('SIGNED_OUT', null)
    expect(service.getAccount(0)).toBeNull()
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('rejects the same user in both slots without exposing the rejected account or signing out the first player', async () => {
    const { service, clients, signIn } = harness()
    await signIn(0)
    const listener = vi.fn()
    service.subscribe(1, listener)
    const result = await signIn(1, 1)
    expect(result).toMatchObject({ account: null, error: 'This account is already signed in as Player 1. Use a different account.' })
    expect(listener.mock.calls).toEqual([[null]])
    expect(service.getAccount(0)?.id).toBe(uid(1))
    expect(service.getAccount(1)).toBeNull()
    expect(clients[1].auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(clients[0].auth.signOut).not.toHaveBeenCalled()
  })

  it('drops a rejected duplicate session even if the sign-out request fails', async () => {
    const { service, clients, signIn } = harness()
    await signIn(0)
    clients[1].signOutFailure = { message: 'Network unavailable' }
    const previousClient = clients[1]
    expect((await signIn(1, 1)).error).toMatch(/already signed in as Player 1/)
    expect(previousClient.auth.dispose).toHaveBeenCalledOnce()
    expect(service.getAccount(1)).toBeNull()
    previousClient.emit('TOKEN_REFRESHED', user(1))
    expect(service.getAccount(1)).toBeNull()
    expect(clients).toHaveLength(3)
  })

  it('does not let delayed duplicate-session cleanup sign out a newer valid login', async () => {
    vi.useFakeTimers()
    const { service, clients, signIn } = harness()
    await signIn(0)
    clients[1].emit('SIGNED_IN', user(1))
    expect(service.getAccount(1)).toBeNull()
    await signIn(1)
    await vi.runAllTimersAsync()
    expect(service.getAccount(1)?.id).toBe(uid(2))
    expect(clients[1].auth.signOut).not.toHaveBeenCalled()
  })

  it('serializes same-slot auth attempts while allowing the other player to sign in', async () => {
    const { service, clients, signIn } = harness()
    const pending = deferred()
    clients[0].auth.signInWithPassword.mockImplementation(() => pending.promise)
    const first = signIn(0)
    expect((await signIn(0, 3)).error).toMatch(/current account request/)
    expect((await signIn(1)).account.id).toBe(uid(2))
    pending.resolve({ data: { session: { user: user(1) } }, error: null })
    expect((await first).account.id).toBe(uid(1))
  })

  it('signs out only the selected session and preserves accounts when sign-out fails', async () => {
    const { service, clients, signIn } = harness()
    await signIn(0)
    await signIn(1)
    clients[0].signOutFailure = { message: 'offline' }
    expect((await service.signOut(0)).ok).toBe(false)
    expect(service.getAccount(0)?.id).toBe(uid(1))
    clients[0].signOutFailure = null
    expect(await service.signOut(0)).toEqual({ ok: true, error: '' })
    expect(service.getAccount(0)).toBeNull()
    expect(service.getAccount(1)?.id).toBe(uid(2))
    expect(clients[0].auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' })
  })
})

describe('registration and errors', () => {
  it('stores the trimmed display name in auth metadata and handles confirmation without treating the user as signed in', async () => {
    const { service, clients } = harness()
    clients[0].confirmation = true
    const credentials = { name: '  Ada  ', email: ' ada@example.com ', password: 'not persisted' }
    expect(await service.signUp(0, credentials)).toEqual({ account: null, needsConfirmation: true, error: '' })
    expect(clients[0].auth.signUp).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'not persisted', options: { data: { display_name: 'Ada' } } })
    expect(service.getAccount(0)).toBeNull()
    clients[0].confirmation = false
    expect((await service.signUp(0, credentials)).account).toEqual({ id: uid(4), name: 'Ada', email: 'ada@example.com' })
  })

  it('validates registration names and credentials before sending a request', async () => {
    const { service, clients } = harness()
    for (const name of ['', '   ', 'x'.repeat(41)]) {
      expect((await service.signUp(0, { name, email: 'a@example.com', password: 'pw' })).error).toMatch(/1 and 40/)
    }
    expect((await service.signIn(0, { email: ' ', password: 'pw' })).error).toMatch(/email and password/)
    expect((await service.signIn(2, {})).error).toMatch(/Player 1 or Player 2/)
    expect(clients[0].auth.signInWithPassword).not.toHaveBeenCalled()
    expect(clients[0].auth.signUp).not.toHaveBeenCalled()
  })

  it('reports expected auth failures without echoing arbitrary provider responses or thrown details', async () => {
    const { service, clients, signIn } = harness()
    clients[0].authFailure = { code: 'email_not_confirmed', message: 'private provider details' }
    expect((await signIn(0)).error).toBe('Confirm your email, then sign in.')
    clients[0].auth.signInWithPassword.mockRejectedValueOnce(Error('secret diagnostics'))
    expect((await signIn(0)).error).toMatch(/connection/)
    expect(service.getAccount(0)).toBeNull()
  })
})

describe('account workout history', () => {
  it('requires an authenticated slot and rejects malformed records without database requests', async () => {
    const { service, clients, signIn } = harness()
    expect((await service.saveWorkout(0, workout())).error).toMatch(/Sign in/)
    expect((await service.listWorkouts(1)).error).toMatch(/Sign in/)
    await signIn(0)
    for (const changes of [
      { id: 'not-a-uuid' }, { date: 'invalid' }, { exerciseId: 'unknown' }, { repCount: -1 },
      { repCount: 1.5 }, { goal: 0 }, { goal: 1000 }, { score: -1 },
      { load: { amount: Infinity, unit: 'kg' } }, { load: { amount: 2001, unit: 'kg' } },
      { load: { amount: 1, unit: 'stone' } },
    ]) expect((await service.saveWorkout(0, workout(1, changes))).ok).toBe(false)
    expect(clients[0].from).not.toHaveBeenCalled()
  })

  it('saves actual reps, goal, exercise and load under the authenticated owner, ignoring supplied ownership', async () => {
    const { service, clients, rows, signIn } = harness()
    await signIn(0)
    const record = workout(1, { exerciseId: 'bench-press', load: { amount: 12.5, unit: 'lb' }, user_id: uid(2), profileId: 'octavio' })
    expect(await service.saveWorkout(0, record)).toEqual({ ok: true, error: '' })
    expect([...rows.values()]).toEqual([rowFor(record, user(1))])
    expect(clients[0].queries[0].options).toEqual({ onConflict: 'id,user_id', ignoreDuplicates: true })
    record.load.amount = 999
    expect((await service.listWorkouts(0)).workouts).toEqual([workout(1, { exerciseId: 'bench-press', load: { amount: 12.5, unit: 'lb' } })])
  })

  it('keeps retries idempotent, refuses conflicting payloads and supports separate owners with the same UUID', async () => {
    const { service, rows, signIn } = harness()
    await signIn(0)
    await signIn(1)
    const record = workout()
    expect((await service.saveWorkout(0, record)).ok).toBe(true)
    expect((await service.saveWorkout(0, structuredClone(record))).ok).toBe(true)
    expect(rows.size).toBe(1)
    expect((await service.saveWorkout(0, { ...record, repCount: 8 })).error).toMatch(/different workout/)
    expect(rows.size).toBe(1)
    expect((await service.saveWorkout(1, { ...record, repCount: 9 })).ok).toBe(true)
    expect(rows.size).toBe(2)
    expect((await service.listWorkouts(0)).workouts[0].repCount).toBe(7)
    expect((await service.listWorkouts(1)).workouts[0].repCount).toBe(9)
  })

  it('preserves zero completed reps, null weight and explicit zero weight as distinct values', async () => {
    const { service, signIn } = harness()
    await signIn(0)
    const first = workout(1, { repCount: 0, score: 0 })
    const second = workout(2, { load: { amount: 0, unit: 'lb' } })
    await service.saveWorkout(0, first)
    await service.saveWorkout(0, second)
    expect((await service.listWorkouts(0)).workouts).toEqual([second, first])
  })

  it('paginates all rows with deterministic ordering and keeps another account history separate', async () => {
    const { service, clients, rows, signIn } = harness()
    await signIn(0)
    await signIn(1)
    for (let index = 1; index <= 205; index++) {
      const record = workout(index)
      const row = rowFor(record, user(1))
      rows.set(`${row.user_id}:${row.id}`, row)
    }
    const other = rowFor(workout(900), user(2))
    rows.set(`${other.user_id}:${other.id}`, other)
    const result = await service.listWorkouts(0)
    expect(result.error).toBe('')
    expect(result.workouts).toHaveLength(205)
    expect(result.workouts[0].id).toBe(uid(1205))
    expect(result.workouts.at(-1).id).toBe(uid(1001))
    expect(clients[0].queries.map((query) => query.bounds)).toEqual([[0, 99], [100, 199], [200, 299]])
    expect(clients[0].queries.every((query) => query.filters.some(([column, value]) => column === 'user_id' && value === uid(1)))).toBe(true)
  })

  it('reads the same account history on a separate service instance and never imports local named games', async () => {
    const first = harness()
    await first.signIn(0)
    await first.service.saveWorkout(0, workout())
    const second = harness({ rows: first.rows })
    await second.signIn(1, 1)
    expect((await second.service.listWorkouts(1)).workouts).toEqual([workout()])
    expect(first.service.getAccount(1)).toBeNull()
  })

  it('ignores malformed provider rows with a notice and safely reports provider or network failures', async () => {
    const { service, clients, rows, signIn } = harness()
    await signIn(0)
    rows.set('bad', { ...rowFor(workout(), user(1)), exercise_id: 'missing-exercise' })
    expect(await service.listWorkouts(0)).toEqual({ workouts: [], error: expect.stringMatching(/could not be read/) })
    clients[0].queryFailure = { code: '42501', message: 'access denied' }
    expect((await service.saveWorkout(0, workout())).ok).toBe(false)
    expect((await service.listWorkouts(0)).error).toMatch(/could not be loaded/)
    clients[0].beforeQuery = () => { throw Error('offline') }
    expect((await service.listWorkouts(0)).error).toMatch(/connection/)
    expect((await service.saveWorkout(0, workout())).error).toMatch(/connection/)
  })

  it('discards delayed history and save responses after an account switches', async () => {
    const { service, clients, signIn } = harness()
    await signIn(0)
    const pending = deferred()
    clients[0].beforeQuery = () => pending.promise
    const history = service.listWorkouts(0)
    const save = service.saveWorkout(0, workout())
    await service.signOut(0)
    await signIn(0, 3)
    pending.resolve()
    expect(await history).toEqual({ workouts: [], error: expect.stringMatching(/account changed/) })
    expect((await save).error).toMatch(/account changed/)
    expect(service.getAccount(0)?.id).toBe(uid(3))
  })
})
