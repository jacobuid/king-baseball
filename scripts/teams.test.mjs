import { createTeamTheme } from '../apps/web/src/teamTheme.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { DIVISIONS } from '../shared/divisions.ts'
import { handleTeamRequest as handleRequest, validateTeam } from '../services/api/src/teams.ts'
import { createLogoStorage } from '../services/api/src/logo-storage.ts'

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
    this.sqlite.exec(readFileSync(new URL('../services/api/migrations/0006_b2_team_logos.sql', import.meta.url), 'utf8'))
    this.sqlite.exec(readFileSync(new URL('../services/api/migrations/0007_team_primary_color.sql', import.meta.url), 'utf8'))
    this.objects = new Map()
    this.storage = { put: async (key, data) => { if (this.failUploads) throw new Error('B2 unavailable'); this.objects.set(key, data) }, url: async key => 'https://private-b2.example/' + key + '?signed=true', remove: async key => { this.objects.delete(key) } }
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
const handleTeamRequest = (request, db, userId) => handleRequest(request, db, userId, db.storage)
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
  assert.equal(saved.logoDataUrl, null)
  assert.match(saved.logoUrl, /^https:\/\/private-b2\.example\/team-logos\//)
  assert.equal([...db.objects.values()][0], logo)
  assert.deepEqual(await (await handleTeamRequest(request(), db, 'bob')).json(), { team: null })
  assert.equal((await handleTeamRequest(request(team(1)), db, 'alice')).status, 200)
  saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.logoDataUrl, null)
  assert.match(saved.logoUrl, /^https:\/\/private-b2\.example\/team-logos\//)
  for (const invalid of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,aGVsbG8=', 'https://example.com/logo.png', 'data:image/png;base64,' + 'A'.repeat(180000), 123]) {
    assert.equal((await handleTeamRequest(request({ ...team(2), logoDataUrl: invalid }), db, 'alice')).status, 400)
  }
  assert.equal((await handleTeamRequest(request({ ...team(2), logoDataUrl: null }), db, 'alice')).status, 200)
  saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.logoDataUrl, null)
  assert.equal(saved.logoUrl, null)
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

test('legacy inline logos remain readable and migrate to B2 only after a successful save', () => withDb(async db => {
  await handleTeamRequest(request(team()), db, 'alice')
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='
  db.sqlite.prepare('UPDATE teams SET logo_data_url = ?').run(logo)
  assert.equal((await (await handleTeamRequest(request(), db, 'alice')).json()).team.logoDataUrl, logo)
  db.failUploads = true
  assert.equal((await handleTeamRequest(request(team(1)), db, 'alice')).status, 502)
  assert.equal(db.sqlite.prepare('SELECT logo_data_url FROM teams').get().logo_data_url, logo)
  assert.equal(db.sqlite.prepare('SELECT version FROM teams').get().version, 1)
  db.failUploads = false
  assert.equal((await handleTeamRequest(request(team(1)), db, 'alice')).status, 200)
  const row = db.sqlite.prepare('SELECT logo_data_url,logo_key FROM teams').get()
  assert.equal(row.logo_data_url, null)
  assert.ok(db.objects.has(row.logo_key))
}))
test('B2 uploads are cleaned up when the database save fails', () => withDb(async db => {
  await handleTeamRequest(request(team()), db, 'alice')
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='
  db.sqlite.exec("CREATE TRIGGER reject_logo BEFORE UPDATE ON teams BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  await assert.rejects(handleTeamRequest(request({ ...team(1), logoDataUrl: logo }), db, 'alice'))
  assert.equal(db.objects.size, 0)
  assert.equal(db.sqlite.prepare('SELECT logo_key FROM teams').get().logo_key, null)
}))

test('failed replacement uploads preserve the previous logo and team version', () => withDb(async db => {
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='
  await handleTeamRequest(request({ ...team(), logoDataUrl: logo }), db, 'alice')
  const original = db.sqlite.prepare('SELECT logo_key,version FROM teams').get()
  db.failUploads = true
  assert.equal((await handleTeamRequest(request({ ...team(1), logoDataUrl: logo }), db, 'alice')).status, 502)
  assert.deepEqual(db.sqlite.prepare('SELECT logo_key,version FROM teams').get(), original)
  assert.equal(db.objects.size, 1)
}))
test('concurrent logo saves clean only their own unused upload', () => withDb(async db => {
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='
  await handleTeamRequest(request({ ...team(), logoDataUrl: logo }), db, 'alice')
  const originalKey = db.sqlite.prepare('SELECT logo_key FROM teams').get().logo_key
  const batch = db.batch.bind(db)
  db.batch = async statements => {
    db.sqlite.exec("UPDATE teams SET version = 2,mutation_id = 'another-save'")
    return batch(statements)
  }
  assert.equal((await handleTeamRequest(request({ ...team(1), logoDataUrl: logo }), db, 'alice')).status, 409)
  assert.deepEqual([...db.objects.keys()], [originalKey])
}))
test('B2 adapter signs private URLs and uploads image bytes, not base64 text', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async (input, options) => {
    const req = new Request(input, options)
    calls.push({ method: req.method, url: req.url, type: req.headers.get('Content-Type'), signed: !!req.headers.get('Authorization'), body: new Uint8Array(await req.arrayBuffer()) })
    return new Response(null, { status: 200 })
  }
  const storage = createLogoStorage({ B2_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com', B2_BUCKET: 'king-sports', B2_LOGO_KEY_ID: 'test-key', B2_LOGO_APPLICATION_KEY: 'test-secret' })
  const key = 'team-logos/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png'
  await storage.put(key, 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(calls[0].method, 'PUT')
  assert.equal(calls[0].type, 'image/png')
  assert.equal(calls[0].signed, true)
  assert.deepEqual([...calls[0].body], [137, 80, 78, 71, 13, 10, 26, 10])
  const signed = new URL(await storage.url(key))
  assert.equal(signed.searchParams.get('X-Amz-Expires'), '3600')
  assert.ok(signed.searchParams.get('X-Amz-Signature'))
  await storage.remove(key)
  assert.equal(calls[1].method, 'DELETE')
  await assert.rejects(storage.url('movies/other.png'))
})

test('team primary color saves, reloads, updates, and survives older clients', () => withDb(async db => {
  assert.equal((await handleTeamRequest(request({ ...team(), primaryColor: '#AB1234' }), db, 'alice')).status, 201)
  let saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.primaryColor, '#ab1234')
  assert.equal((await handleTeamRequest(request(team(1)), db, 'alice')).status, 200)
  saved = (await (await handleTeamRequest(request(), db, 'alice')).json()).team
  assert.equal(saved.primaryColor, '#ab1234')
  for (const invalid of ['red', '#fff', '#12345678', 'var(--color)', null, 123]) {
    assert.equal((await handleTeamRequest(request({ ...team(2), primaryColor: invalid }), db, 'alice')).status, 400)
  }
  assert.equal((await handleTeamRequest(request({ ...team(2), primaryColor: '#000000' }), db, 'alice')).status, 200)
  assert.equal((await (await handleTeamRequest(request(), db, 'alice')).json()).team.primaryColor, '#000000')
  await handleTeamRequest(request(team()), db, 'bob')
  assert.equal((await (await handleTeamRequest(request(), db, 'bob')).json()).team.primaryColor, '#041c36')
}))
test('team theme handles extreme colors and rejects invalid CSS input', () => {
  for (const color of ['#000000', '#ffffff', '#ff0000']) {
    const theme = createTeamTheme(color)
    assert.equal(theme['--team-color'], color)
    assert.notEqual(theme['--team-panel'], '#ffffff')
    assert.notEqual(theme['--team-accent'], '#000000')
    for (const value of Object.values(theme)) assert.match(value, /^#[a-f0-9]{6}([a-f0-9]{2})?$/)
  }
  assert.equal(createTeamTheme('invalid')['--team-color'], '#041c36')
})

test('primary color migration preserves a populated existing team table', () => {
  const db = new DatabaseSync(':memory:')
  try {
    for (const migration of ['0001_initial.sql', '0002_teams.sql', '0003_player_jersey_numbers.sql', '0004_team_logos.sql', '0005_team_division.sql', '0006_b2_team_logos.sql']) db.exec(readFileSync(new URL('../services/api/migrations/' + migration, import.meta.url), 'utf8'))
    db.prepare('INSERT INTO teams(id,owner_user_id,name,mutation_id) VALUES(?,?,?,?)').run('existing-team', 'existing-user', 'Existing Team', 'original-mutation')
    db.exec(readFileSync(new URL('../services/api/migrations/0007_team_primary_color.sql', import.meta.url), 'utf8'))
    const row = db.prepare('SELECT name,primary_color,version FROM teams').get()
    assert.equal(row.name, 'Existing Team')
    assert.equal(row.primary_color, '#16845b')
    assert.equal(row.version, 1)
  } finally { db.close() }
})
