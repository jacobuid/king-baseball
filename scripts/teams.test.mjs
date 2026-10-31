import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { DIVISIONS } from '../shared/divisions.ts'
import { handleTeamRequest, validateTeam } from '../services/api/src/teams.ts'

// Exercise the real SQL against SQLite, matching D1's prepared statements and atomic batch behavior.
class Database {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:')
    this.sqlite.exec('PRAGMA foreign_keys = ON')
    this.sqlite.exec(readFileSync(new URL('../services/api/migrations/0001_initial.sql', import.meta.url), 'utf8'))
    this.sqlite.exec(readFileSync(new URL('../services/api/migrations/0002_teams.sql', import.meta.url), 'utf8'))
    this.sqlite.exec(readFileSync(new URL('../services/api/migrations/0003_player_jersey_numbers.sql', import.meta.url), 'utf8'))
    this.sqlite.exec(readFileSync(new URL('../services/api/migrations/0004_team_logos.sql', import.meta.url), 'utf8'))
    this.sqlite.exec(readFileSync(new URL('../services/api/migrations/0005_team_division.sql', import.meta.url), 'utf8'))
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
  assert.deepEqual(created.players, [{ id: first, name: 'Alex Smith', jerseyNumber: null, rosterOrder: 0 }, { id: second, name: 'Jordan', jerseyNumber: null, rosterOrder: 1 }])
  const saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.id, created.id)
  assert.deepEqual(saved.players, created.players)
  assert.deepEqual(await (await handleTeamRequest(request(), db, 'someone-else')).json(), { team: null })
  const columns = db.sqlite.prepare('PRAGMA table_info(players)').all().map(row => row.name)
  assert.deepEqual(columns, ['team_id', 'id', 'name', 'roster_order', 'jersey_number'])
}))
test('update name, remove and reorder players without changing the team ID', () => withDb(async db => {
  const original = (await (await handleTeamRequest(request(team()), db, 'alice')).json()).team
  const response = await handleTeamRequest(request({ name: 'New Name', version: 1, players: [{ id: second, name: 'Jordan Updated' }] }), db, 'alice')
  assert.equal(response.status, 200)
  const saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.id, original.id)
  assert.equal(saved.name, 'New Name')
  assert.equal(saved.version, 2)
  assert.deepEqual(saved.players, [{ id: second, name: 'Jordan Updated', jerseyNumber: null, rosterOrder: 0 }])
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
  assert.equal((await handleTeamRequest(request({ ...team(), excess: 'x'.repeat(262144) }), db, 'alice')).status, 413)
  assert.equal((await handleTeamRequest(new Request('https://api.example/api/team', { method: 'PUT', body: '{}' }), db, 'alice')).status, 415)
  assert.equal((await handleTeamRequest(request(undefined, 'DELETE'), db, 'alice')).status, 405)
  assert.deepEqual(await (await handleTeamRequest(request(), db, 'alice')).json(), { team: null })
}))

test('jersey numbers preserve leading zeroes, accept boundaries, clear, and reject invalid values', () => withDb(async db => {
  const body = team()
  body.players[0].jerseyNumber = '00'
  body.players[1].jerseyNumber = '99'
  assert.equal((await handleTeamRequest(request(body), db, 'alice')).status, 201)
  let saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.deepEqual(saved.players.map(p => p.jerseyNumber), ['00', '99'])
  for (const invalid of ['0', '100', '-1', '1.5', 5, '', 'AA']) {
    assert.equal((await handleTeamRequest(request({ ...team(1), players: [{ id: first, name: 'Alex', jerseyNumber: invalid }] }), db, 'alice')).status, 400)
  }
  assert.equal((await handleTeamRequest(request({ ...team(1), players: [{ id: first, name: 'Alex', jerseyNumber: '07' }] }), db, 'alice')).status, 200)
  saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.players[0].jerseyNumber, '07')
  assert.equal((await handleTeamRequest(request({ ...team(2), players: [{ id: first, name: 'Alex', jerseyNumber: null }] }), db, 'alice')).status, 200)
  saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.players[0].jerseyNumber, null)
}))

test('team logo saves, reloads, survives older clients, and can be removed', () => withDb(async db => {
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='
  assert.equal((await handleTeamRequest(request({ ...team(), logoDataUrl: logo }), db, 'alice')).status, 201)
  let saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.logoDataUrl, logo)
  assert.deepEqual(await (await handleTeamRequest(request(), db, 'bob')).json(), { team: null })
  assert.equal((await handleTeamRequest(request(team(1)), db, 'alice')).status, 200)
  saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.logoDataUrl, logo)
  for (const invalid of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,aGVsbG8=', 'https://example.com/logo.png', 'data:image/png;base64,' + 'A'.repeat(180000), 123]) {
    assert.equal((await handleTeamRequest(request({ ...team(2), logoDataUrl: invalid }), db, 'alice')).status, 400)
  }
  assert.equal((await handleTeamRequest(request({ ...team(2), logoDataUrl: null }), db, 'alice')).status, 200)
  saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.logoDataUrl, null)
}))

test('all division choices validate and division persists, updates, and clears', () => withDb(async db => {
  for (const division of DIVISIONS) assert.equal(validateTeam({ ...team(), division }).division, division)
  assert.equal((await handleTeamRequest(request({ ...team(), division: 'T-Ball' }), db, 'alice')).status, 201)
  let saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.division, 'T-Ball')
  assert.equal((await handleTeamRequest(request(team(1)), db, 'alice')).status, 200)
  saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.division, 'T-Ball')
  assert.equal((await handleTeamRequest(request({ ...team(2), division: 'Junior Varsity' }), db, 'alice')).status, 200)
  assert.equal((await handleTeamRequest(request({ ...team(3), division: 'Invalid Division' }), db, 'alice')).status, 400)
  assert.equal((await handleTeamRequest(request({ ...team(3), division: 12 }), db, 'alice')).status, 400)
  saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.division, 'Junior Varsity')
  assert.equal((await handleTeamRequest(request({ ...team(3), division: null }), db, 'alice')).status, 200)
  saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.division, null)
}))
