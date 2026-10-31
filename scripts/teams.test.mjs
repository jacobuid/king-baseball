import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handleTeamRequest } from '../services/api/src/teams.ts'

// Exercise the real SQL against SQLite, matching D1's prepared statements and atomic batch behavior.
class Database {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:')
    this.sqlite.exec('PRAGMA foreign_keys = ON')
    this.sqlite.exec(readFileSync(new URL('../services/api/migrations/0001_initial.sql', import.meta.url), 'utf8'))
    this.sqlite.exec(readFileSync(new URL('../services/api/migrations/0002_teams.sql', import.meta.url), 'utf8'))
  }
  prepare(sql) {
    const db = this.sqlite
    let args = []
    return {
      bind(...values) { args = values; return this },
      async first() { return db.prepare(sql).get(...args) || null },
      execute() {
        const results = db.prepare(sql).all(...args)
        return { results, meta: { changes: db.prepare('SELECT changes() AS count').get().count } }
      },
    }
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN')
    try {
      const result = statements.map(s => s.execute())
      this.sqlite.exec('COMMIT')
      return result
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error }
  }
  close() { this.sqlite.close() }
}
const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const team = (version = 0) => ({ name: '  King  Sluggers ', version, players: [{ id: first, name: ' Alex  Smith ' }, { id: second, name: 'Jordan' }] })
const request = (body, method = body === undefined ? 'GET' : 'PUT') => new Request('https://api.example/api/team', { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
async function withDb(run) { const db = new Database(); try { await run(db) } finally { db.close() } }

test('create and reload a team with stable player IDs and roster order; music excluded', () => withDb(async db => {
  assert.deepEqual(await (await handleTeamRequest(request(), db, 'alice')).json(), { team: null })
  const body = team()
  body.owner_user_id = 'someone-else'
  body.players[0].song = { title: 'Not stored', file: 'not stored' }
  const response = await handleTeamRequest(request(body), db, 'alice')
  assert.equal(response.status, 201)
  const created = (await response.json()).team
  assert.equal(created.name, 'King Sluggers')
  assert.equal(created.version, 1)
  assert.deepEqual(created.players, [{ id: first, name: 'Alex Smith', rosterOrder: 0 }, { id: second, name: 'Jordan', rosterOrder: 1 }])
  const saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.id, created.id)
  assert.deepEqual(saved.players, created.players)
  assert.deepEqual(await (await handleTeamRequest(request(), db, 'someone-else')).json(), { team: null })
  const columns = db.sqlite.prepare('PRAGMA table_info(players)').all().map(row => row.name)
  assert.deepEqual(columns, ['team_id', 'id', 'name', 'roster_order'])
}))
test('update name, remove and reorder players without changing the team ID', () => withDb(async db => {
  const original = (await (await handleTeamRequest(request(team()), db, 'alice')).json()).team
  const response = await handleTeamRequest(request({ name: 'New Name', version: 1, players: [{ id: second, name: 'Jordan Updated' }] }), db, 'alice')
  assert.equal(response.status, 200)
  const saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.id, original.id)
  assert.equal(saved.name, 'New Name')
  assert.equal(saved.version, 2)
  assert.deepEqual(saved.players, [{ id: second, name: 'Jordan Updated', rosterOrder: 0 }])
}))
test('account isolation and stale versions cannot replace a saved roster', () => withDb(async db => {
  await handleTeamRequest(request(team()), db, 'alice')
  await handleTeamRequest(request({ ...team(), name: 'Other Team' }), db, 'bob')
  assert.equal((await handleTeamRequest(request(team(0)), db, 'alice')).status, 409)
  assert.equal((await handleTeamRequest(request(team(2)), db, 'alice')).status, 409)
  assert.equal((await (await handleTeamRequest(request(), db, 'alice')).json()).team.name, 'King Sluggers')
  assert.equal((await (await handleTeamRequest(request(), db, 'bob')).json()).team.name, 'Other Team')
}))
test('a competing save between the read and batch cannot change the winning roster', () => withDb(async db => {
  await handleTeamRequest(request(team()), db, 'alice')
  const batch = db.batch.bind(db)
  let intercepted = false
  db.batch = async statements => {
    if (!intercepted) {
      intercepted = true
      db.sqlite.exec("UPDATE teams SET version = 2,mutation_id = 'winner',name = 'Winning Save' WHERE owner_user_id = 'alice'")
    }
    return batch(statements)
  }
  assert.equal((await handleTeamRequest(request({ ...team(1), players: [{ id: second, name: 'Loser' }] }), db, 'alice')).status, 409)
  const saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.name, 'Winning Save')
  assert.equal(saved.players.length, 2)
  assert.equal(saved.players[0].name, 'Alex Smith')
}))
test('failed roster writes roll back team changes and deletions', () => withDb(async db => {
  await handleTeamRequest(request(team()), db, 'alice')
  db.sqlite.exec("CREATE TRIGGER reject_update BEFORE INSERT ON players WHEN NEW.name = 'Reject' BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  await assert.rejects(handleTeamRequest(request({ ...team(1), name: 'Not committed', players: [{ id: second, name: 'Reject' }] }), db, 'alice'))
  const saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.name, 'King Sluggers')
  assert.equal(saved.version, 1)
  assert.equal(saved.players.length, 2)
}))
test('invalid team and player inputs do not create records', () => withDb(async db => {
  for (const body of [null, [], { ...team(), name: '' }, { ...team(), version: -1 }, { ...team(), players: [] }, { ...team(), players: [{ id: 'invalid', name: 'Alex' }] }, { ...team(), players: [{ id: first, name: 'Alex' }, { id: second, name: ' alex ' }] }, { ...team(), players: Array.from({ length: 101 }, () => ({ id: crypto.randomUUID(), name: 'Player' })) }]) {
    assert.equal((await handleTeamRequest(request(body), db, 'alice')).status, 400)
  }
  const invalidJson = new Request('https://api.example/api/team', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' })
  assert.equal((await handleTeamRequest(invalidJson, db, 'alice')).status, 400)
  assert.equal((await handleTeamRequest(request({ ...team(), excess: 'x'.repeat(65536) }), db, 'alice')).status, 413)
  assert.equal((await handleTeamRequest(new Request('https://api.example/api/team', { method: 'PUT', body: '{}' }), db, 'alice')).status, 415)
  assert.equal((await handleTeamRequest(request(undefined, 'DELETE'), db, 'alice')).status, 405)
  assert.deepEqual(await (await handleTeamRequest(request(), db, 'alice')).json(), { team: null })
}))
