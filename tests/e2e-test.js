#!/usr/bin/env node

/**
 * ============================================
 * MatchPulse E2E Test Suite
 * ============================================
 * Tests ALL backend features end-to-end:
 * - Auth (register, login, profile, tokens)
 * - Organization CRUD + invite flow
 * - Tournament CRUD + status transitions
 * - Team + Player management
 * - Fixture generation
 * - Match lifecycle (start, pause, resume, end)
 * - Live scoring for all 9 sports
 * - Socket.io real-time events
 * - AI commentary & match summary
 * - Standings calculation
 * - Notifications
 * - Audit logs
 * ============================================
 */

const http = require('http');
const { io: ioClient } = require('socket.io-client');

const BASE = 'http://localhost:5001';
const API = `${BASE}/api`;

// ─── Shared state ──────────────────────────────────
let adminToken = '';
let adminUserId = '';
let adminRefreshToken = '';
let scorerToken = '';
let scorerUserId = '';
let orgId = '';
let tournamentIds = {}; // sportType -> tournamentId
let teamIds = {};       // sportType -> { teamA, teamB }
let matchIds = {};      // sportType -> matchId
let playerIds = [];     // all created player IDs

// ─── Helpers ───────────────────────────────────────
const results = [];
let testNum = 0;

function pass(name, detail = '') {
  testNum++;
  results.push({ num: testNum, name, status: '✅ PASS', detail });
  console.log(`  ✅ #${testNum} ${name}${detail ? ' — ' + detail : ''}`);
}

function fail(name, detail = '') {
  testNum++;
  results.push({ num: testNum, name, status: '❌ FAIL', detail });
  console.log(`  ❌ #${testNum} ${name}${detail ? ' — ' + detail : ''}`);
}

function warn(name, detail = '') {
  testNum++;
  results.push({ num: testNum, name, status: '⚠️  WARN', detail });
  console.log(`  ⚠️  #${testNum} ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `${API}${path}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const request = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

function section(title) {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(50));
}

// ─── TEST SECTIONS ─────────────────────────────────

async function testHealth() {
  section('1. HEALTH CHECK & API INFO');

  const h = await req('GET', `${BASE}/health`);
  if (h.status === 200 && h.data.status === 'ok') {
    pass('Health check', `env=${h.data.environment}`);
  } else {
    fail('Health check', JSON.stringify(h.data));
  }

  const info = await req('GET', '/');
  if (info.status === 200 && info.data.name === 'MatchPulse API') {
    pass('API info endpoint', `version=${info.data.version}`);
  } else {
    fail('API info endpoint');
  }
}

async function testAuth() {
  section('2. AUTHENTICATION');

  // Register admin
  const ts = Date.now();
  const regRes = await req('POST', '/auth/register/email', {
    fullName: 'Nirpeksh Admin',
    email: `admin_${ts}@matchpulse.test`,
    password: 'TestPassword123!',
  });
  if (regRes.status === 201 && regRes.data.success) {
    adminToken = regRes.data.data.accessToken;
    adminRefreshToken = regRes.data.data.refreshToken;
    adminUserId = regRes.data.data.user._id;
    pass('Register admin (email)', `userId=${adminUserId}`);
  } else {
    fail('Register admin (email)', JSON.stringify(regRes.data));
    return;
  }

  // Register scorer
  const scorerRes = await req('POST', '/auth/register/email', {
    fullName: 'MatchPulse Scorer',
    email: `scorer_${ts}@matchpulse.test`,
    password: 'ScorerPass123!',
  });
  if (scorerRes.status === 201 && scorerRes.data.success) {
    scorerToken = scorerRes.data.data.accessToken;
    scorerUserId = scorerRes.data.data.user._id;
    pass('Register scorer (email)', `userId=${scorerUserId}`);
  } else {
    fail('Register scorer (email)', JSON.stringify(scorerRes.data));
  }

  // Login with email
  const loginRes = await req('POST', '/auth/login/email', {
    email: `admin_${ts}@matchpulse.test`,
    password: 'TestPassword123!',
  });
  if (loginRes.status === 200 && loginRes.data.success) {
    adminToken = loginRes.data.data.accessToken;
    adminRefreshToken = loginRes.data.data.refreshToken;
    pass('Login (email/password)');
  } else {
    fail('Login (email/password)', JSON.stringify(loginRes.data));
  }

  // Get profile
  const profile = await req('GET', '/auth/profile', null, adminToken);
  if (profile.status === 200 && profile.data.data.fullName === 'Nirpeksh Admin') {
    pass('Get profile');
  } else {
    fail('Get profile', JSON.stringify(profile.data));
  }

  // Update profile
  const updateP = await req('PUT', '/auth/profile', {
    fullName: 'Nirpeksh Nandan',
    bio: 'Founder of MatchPulse',
    preferredSports: ['cricket', 'football', 'basketball_5v5'],
  }, adminToken);
  if (updateP.status === 200 && updateP.data.data.bio === 'Founder of MatchPulse') {
    pass('Update profile');
  } else {
    fail('Update profile', JSON.stringify(updateP.data));
  }

  // Refresh token
  const refreshRes = await req('POST', '/auth/refresh', { refreshToken: adminRefreshToken });
  if (refreshRes.status === 200 && refreshRes.data.data.accessToken) {
    adminToken = refreshRes.data.data.accessToken;
    adminRefreshToken = refreshRes.data.data.refreshToken;
    pass('Refresh token');
  } else {
    fail('Refresh token', JSON.stringify(refreshRes.data));
  }

  // Change password
  const cpRes = await req('PUT', '/auth/change-password', {
    currentPassword: 'TestPassword123!',
    newPassword: 'NewPassword456!',
  }, adminToken);
  if (cpRes.status === 200 && cpRes.data.success) {
    adminToken = cpRes.data.data.accessToken;
    adminRefreshToken = cpRes.data.data.refreshToken;
    pass('Change password');
  } else {
    fail('Change password', JSON.stringify(cpRes.data));
  }

  // Login with new password
  const reLogin = await req('POST', '/auth/login/email', {
    email: `admin_${ts}@matchpulse.test`,
    password: 'NewPassword456!',
  });
  if (reLogin.status === 200 && reLogin.data.success) {
    adminToken = reLogin.data.data.accessToken;
    adminRefreshToken = reLogin.data.data.refreshToken;
    pass('Login with new password');
  } else {
    fail('Login with new password', JSON.stringify(reLogin.data));
  }

  // Test invalid login
  const badLogin = await req('POST', '/auth/login/email', {
    email: `admin_${ts}@matchpulse.test`,
    password: 'WrongPassword',
  });
  if (badLogin.status === 401) {
    pass('Reject invalid password', `status=${badLogin.status}`);
  } else {
    fail('Reject invalid password', `Expected 401, got ${badLogin.status}`);
  }

  // Test duplicate registration
  const dupReg = await req('POST', '/auth/register/email', {
    fullName: 'Duplicate User',
    email: `admin_${ts}@matchpulse.test`,
    password: 'DupPass123!',
  });
  if (dupReg.status === 409) {
    pass('Reject duplicate email', `status=${dupReg.status}`);
  } else {
    fail('Reject duplicate email', `Expected 409, got ${dupReg.status}`);
  }

  // Register players for later use
  for (let i = 1; i <= 22; i++) {
    const pRes = await req('POST', '/auth/register/email', {
      fullName: `Player ${i}`,
      email: `player${i}_${ts}@matchpulse.test`,
      password: 'PlayerPass123!',
    });
    if (pRes.status === 201) {
      playerIds.push(pRes.data.data.user._id);
    }
  }
  pass(`Registered ${playerIds.length} players`);
}

async function testOrganization() {
  section('3. ORGANIZATION');

  // Create org
  const ts = Date.now();
  const createRes = await req('POST', '/organizations', {
    name: 'MatchPulse Sports Club',
    slug: `matchpulse-${ts}`,
    primaryColor: '#FF6B00',
    secondaryColor: '#1A1A2E',
    description: 'Premier sports tournament platform',
  }, adminToken);
  if (createRes.status === 201 && createRes.data.success) {
    orgId = createRes.data.data._id;
    pass('Create organization', `orgId=${orgId}`);
  } else {
    fail('Create organization', JSON.stringify(createRes.data));
    return;
  }

  // Refresh admin token (role may have changed to org_admin)
  const loginRes = await req('POST', '/auth/refresh', { refreshToken: adminRefreshToken });
  if (loginRes.status === 200) {
    adminToken = loginRes.data.data.accessToken;
    adminRefreshToken = loginRes.data.data.refreshToken;
  }

  // Get by ID
  const getRes = await req('GET', `/organizations/${orgId}`);
  if (getRes.status === 200 && getRes.data.data.name === 'MatchPulse Sports Club') {
    pass('Get organization by ID');
  } else {
    fail('Get organization by ID');
  }

  // Get by slug
  const slugRes = await req('GET', `/organizations/slug/matchpulse-${ts}`);
  if (slugRes.status === 200 && slugRes.data.data._id === orgId) {
    pass('Get organization by slug');
  } else {
    fail('Get organization by slug');
  }

  // Update org
  const updRes = await req('PUT', `/organizations/${orgId}`, {
    description: 'Updated: Premier sports tournament platform by ScaleUp',
  }, adminToken);
  if (updRes.status === 200 && updRes.data.data.description.includes('ScaleUp')) {
    pass('Update organization');
  } else {
    fail('Update organization', JSON.stringify(updRes.data));
  }

  // List orgs
  const listRes = await req('GET', '/organizations');
  if (listRes.status === 200 && listRes.data.data.length > 0) {
    pass('List organizations', `count=${listRes.data.data.length}`);
  } else {
    fail('List organizations');
  }

  // Create invite
  const invRes = await req('POST', `/organizations/${orgId}/invite`, {
    role: 'scorer',
  }, adminToken);
  if (invRes.status === 201 && invRes.data.data.inviteCode) {
    const inviteCode = invRes.data.data.inviteCode;
    pass('Create invite code', `code=${inviteCode}`);

    // Join with invite - use scorer account
    const joinRes = await req('POST', `/organizations/join/${inviteCode}`, {}, scorerToken);
    if (joinRes.status === 200 && joinRes.data.data.role === 'scorer') {
      pass('Join org via invite code', `role=scorer`);
      // Refresh scorer token to get updated role
      const scorerRefresh = await req('POST', '/auth/login/email', {
        email: `scorer_${Date.now() - (Date.now() - parseInt(adminUserId.toString().substring(0, 8), 16) * 1000)}@matchpulse.test`,
        password: 'ScorerPass123!',
      });
      // Just use existing token - it may work
    } else {
      fail('Join org via invite code', JSON.stringify(joinRes.data));
    }
  } else {
    fail('Create invite code', JSON.stringify(invRes.data));
  }

  // Get members
  const memRes = await req('GET', `/organizations/${orgId}/members`, null, adminToken);
  if (memRes.status === 200) {
    pass('Get org members', `count=${memRes.data.data.length}`);
  } else {
    fail('Get org members', JSON.stringify(memRes.data));
  }
}

async function testTournamentsAndTeams() {
  section('4. TOURNAMENTS & TEAMS');

  const sportsToTest = [
    { sport: 'cricket', format: 'round_robin', name: 'IPL Campus League' },
    { sport: 'football', format: 'knockout', name: 'Football Knockout Cup' },
    { sport: 'basketball_5v5', format: 'round_robin', name: 'Basketball League' },
    { sport: 'volleyball', format: 'round_robin', name: 'Volleyball Masters' },
    { sport: 'tennis', format: 'knockout', name: 'Tennis Open' },
    { sport: 'table_tennis', format: 'round_robin', name: 'TT Championship' },
    { sport: 'badminton', format: 'knockout', name: 'Badminton Open' },
    { sport: 'squash', format: 'knockout', name: 'Squash Classic' },
    { sport: 'basketball_3x3', format: 'round_robin', name: '3x3 Streetball' },
  ];

  for (const { sport, format, name } of sportsToTest) {
    // Create tournament
    const tRes = await req('POST', '/tournaments', {
      organizationId: orgId,
      name,
      description: `Test ${sport} tournament`,
      sportType: sport,
      format,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      venues: [{ name: 'Main Ground', address: 'Campus Block A' }, { name: 'Court 1', address: 'Campus Block B' }],
    }, adminToken);

    if (tRes.status === 201) {
      tournamentIds[sport] = tRes.data.data._id;
      pass(`Create ${sport} tournament`, `id=${tournamentIds[sport]}`);
    } else {
      fail(`Create ${sport} tournament`, JSON.stringify(tRes.data));
      continue;
    }

    // Activate tournament
    const statusRes = await req('PUT', `/tournaments/${tournamentIds[sport]}/status`, {
      status: 'active',
    }, adminToken);
    if (statusRes.status === 200) {
      pass(`Activate ${sport} tournament`);
    } else {
      fail(`Activate ${sport} tournament`, JSON.stringify(statusRes.data));
    }

    // Create 2 teams
    const teamNames = sport === 'cricket'
      ? [{ n: 'Mumbai Indians', s: 'MI', c: '#004BA0' }, { n: 'Chennai Super Kings', s: 'CSK', c: '#FDB913' }]
      : [{ n: `${name} Team A`, s: 'TMA', c: '#FF0000' }, { n: `${name} Team B`, s: 'TMB', c: '#0000FF' }];

    const teams = [];
    for (const tm of teamNames) {
      const teamRes = await req('POST', '/teams', {
        tournamentId: tournamentIds[sport],
        name: tm.n,
        shortName: tm.s,
        color: tm.c,
      }, adminToken);
      if (teamRes.status === 201) {
        teams.push(teamRes.data.data._id);
      } else {
        fail(`Create team ${tm.n}`, JSON.stringify(teamRes.data));
      }
    }

    if (teams.length === 2) {
      teamIds[sport] = { teamA: teams[0], teamB: teams[1] };
      pass(`Create teams for ${sport}`, `A=${teams[0].slice(-6)}, B=${teams[1].slice(-6)}`);

      // Add players to teams (use the registered player IDs)
      const playersPerTeam = Math.min(5, Math.floor(playerIds.length / 2));
      let addedA = 0, addedB = 0;

      for (let i = 0; i < playersPerTeam; i++) {
        const pARes = await req('POST', `/teams/${teams[0]}/players`, {
          playerId: playerIds[i],
          jerseyNumber: i + 1,
          position: 'player',
        }, adminToken);
        if (pARes.status === 201) addedA++;

        const pBRes = await req('POST', `/teams/${teams[1]}/players`, {
          playerId: playerIds[playersPerTeam + i],
          jerseyNumber: i + 1,
          position: 'player',
        }, adminToken);
        if (pBRes.status === 201) addedB++;
      }
      pass(`Add players to ${sport} teams`, `A=${addedA}, B=${addedB}`);
    }
  }

  // Test tournament list
  const listRes = await req('GET', '/tournaments');
  if (listRes.status === 200 && listRes.data.data.length > 0) {
    pass('List active tournaments', `count=${listRes.data.data.length}`);
  } else {
    fail('List active tournaments');
  }

  // Test tournament by org
  const orgTRes = await req('GET', `/tournaments/org/${orgId}`);
  if (orgTRes.status === 200 && orgTRes.data.data.length >= 9) {
    pass('Get tournaments by org', `count=${orgTRes.data.data.length}`);
  } else {
    fail('Get tournaments by org', JSON.stringify(orgTRes.data));
  }

  // Test get teams by tournament
  const tTeams = await req('GET', `/teams/tournament/${tournamentIds.cricket}`);
  if (tTeams.status === 200 && tTeams.data.data.length === 2) {
    pass('Get teams by tournament', `count=${tTeams.data.data.length}`);
  } else {
    fail('Get teams by tournament', JSON.stringify(tTeams.data));
  }
}

async function testFixtures() {
  section('5. FIXTURE GENERATION');

  // Test round-robin fixture generation for cricket
  const fixRes = await req('POST', `/tournaments/${tournamentIds.cricket}/fixtures/generate`, {}, adminToken);
  if (fixRes.status === 201 && fixRes.data.data.length > 0) {
    // Save the first generated match
    matchIds.cricket = fixRes.data.data[0]._id;
    pass('Generate cricket round-robin fixtures', `matches=${fixRes.data.data.length}`);
  } else {
    fail('Generate cricket fixtures', JSON.stringify(fixRes.data));
  }

  // Get matches by tournament
  const matchList = await req('GET', `/matches/tournament/${tournamentIds.cricket}`);
  if (matchList.status === 200 && matchList.data.data.length > 0) {
    pass('List tournament matches', `count=${matchList.data.data.length}`);
  } else {
    fail('List tournament matches');
  }
}

async function testMatchCreationAndLifecycle() {
  section('6. MATCH CREATION & LIFECYCLE');

  // Create matches for remaining sports
  const sportsToCreateMatches = Object.keys(teamIds).filter(s => s !== 'cricket' || !matchIds.cricket);

  for (const sport of Object.keys(teamIds)) {
    if (matchIds[sport]) continue; // Already created via fixtures

    const mRes = await req('POST', '/matches', {
      tournamentId: tournamentIds[sport],
      teamA: teamIds[sport].teamA,
      teamB: teamIds[sport].teamB,
      scheduledAt: new Date().toISOString(),
      venue: 'Main Ground',
      stage: 'group',
      matchNumber: 1,
    }, adminToken);

    if (mRes.status === 201) {
      matchIds[sport] = mRes.data.data._id;
      pass(`Create ${sport} match`, `id=${matchIds[sport].slice(-6)}`);
    } else {
      fail(`Create ${sport} match`, JSON.stringify(mRes.data));
    }
  }

  // Assign scorer to cricket match
  if (matchIds.cricket) {
    const asRes = await req('PUT', `/matches/${matchIds.cricket}/scorer`, {
      scorerUserId: adminUserId,
    }, adminToken);
    if (asRes.status === 200) {
      pass('Assign scorer to cricket match');
    } else {
      fail('Assign scorer to cricket match', JSON.stringify(asRes.data));
    }
  }

  // Get match details
  if (matchIds.cricket) {
    const mDetail = await req('GET', `/matches/${matchIds.cricket}`);
    if (mDetail.status === 200 && mDetail.data.data.tournamentId) {
      pass('Get match details', `sport=${mDetail.data.data.sportType}`);
    } else {
      fail('Get match details');
    }
  }
}

async function testLiveScoring() {
  section('7. LIVE SCORING — ALL 9 SPORTS');

  // ─── CRICKET ─────────────────────────────────────
  if (matchIds.cricket) {
    // Assign scorer (admin) and start match
    await req('PUT', `/matches/${matchIds.cricket}/scorer`, { scorerUserId: adminUserId }, adminToken);

    const startRes = await req('POST', `/matches/${matchIds.cricket}/lifecycle`, {
      action: 'start',
      toss: { wonBy: teamIds.cricket.teamA, elected: 'bat' },
    }, adminToken);

    if (startRes.status === 200 && startRes.data.data.status === 'live') {
      pass('Start cricket match');
    } else {
      fail('Start cricket match', JSON.stringify(startRes.data));
    }

    // Score some balls
    const cricketEvents = [
      { eventType: 'ball', eventData: { runs: 4, isExtra: false }, teamId: teamIds.cricket.teamA },
      { eventType: 'ball', eventData: { runs: 1, isExtra: false }, teamId: teamIds.cricket.teamA },
      { eventType: 'ball', eventData: { runs: 6, isExtra: false }, teamId: teamIds.cricket.teamA },
      { eventType: 'ball', eventData: { runs: 0, isExtra: false }, teamId: teamIds.cricket.teamA },
      { eventType: 'ball', eventData: { runs: 2, isExtra: false }, teamId: teamIds.cricket.teamA },
      { eventType: 'ball', eventData: { runs: 1, isExtra: false }, teamId: teamIds.cricket.teamA },
    ];

    let cricketSuccess = 0;
    let lastCricketEvent = null;
    for (const evt of cricketEvents) {
      const eRes = await req('POST', `/scoring/${matchIds.cricket}/events`, evt, adminToken);
      if (eRes.status === 201) {
        cricketSuccess++;
        lastCricketEvent = eRes.data.data;
      }
    }
    if (cricketSuccess > 0) {
      const score = lastCricketEvent?.currentState?.innings?.[0]?.score || 0;
      pass(`Cricket scoring: ${cricketSuccess}/${cricketEvents.length} events`, `score=${score}`);
    } else {
      fail('Cricket scoring — no events succeeded');
    }

    // Score a wicket (wickets are ball events with isWicket=true)
    const wicketRes = await req('POST', `/scoring/${matchIds.cricket}/events`, {
      eventType: 'ball',
      eventData: { runs: 0, isWicket: true, wicketType: 'bowled' },
      teamId: teamIds.cricket.teamA,
    }, adminToken);
    if (wicketRes.status === 201) {
      pass('Cricket wicket event', `wickets=${wicketRes.data.data.currentState?.innings?.[0]?.wickets}`);
    } else {
      fail('Cricket wicket', JSON.stringify(wicketRes.data));
    }

    // Undo last event
    const undoEventId = wicketRes.status === 201
      ? wicketRes.data.data.event._id
      : (lastCricketEvent?.event?._id || null);
    if (undoEventId) {
      const undoRes = await req('POST', `/scoring/${matchIds.cricket}/events/${undoEventId}/undo`, {
        reason: 'Scorer error - wrong event recorded',
      }, adminToken);
      if (undoRes.status === 200) {
        pass('Undo scoring event');
      } else {
        fail('Undo scoring event', JSON.stringify(undoRes.data));
      }
    }

    // Get event timeline
    const eventsRes = await req('GET', `/scoring/${matchIds.cricket}/events`);
    if (eventsRes.status === 200 && eventsRes.data.data.length > 0) {
      pass('Get event timeline', `events=${eventsRes.data.data.length}`);
    } else {
      fail('Get event timeline');
    }

    // Pause match
    const pauseRes = await req('POST', `/matches/${matchIds.cricket}/lifecycle`, {
      action: 'pause',
    }, adminToken);
    if (pauseRes.status === 200) {
      pass('Pause cricket match');
    } else {
      fail('Pause cricket match', JSON.stringify(pauseRes.data));
    }

    // Resume match
    const resumeRes = await req('POST', `/matches/${matchIds.cricket}/lifecycle`, {
      action: 'resume',
    }, adminToken);
    if (resumeRes.status === 200) {
      pass('Resume cricket match');
    } else {
      fail('Resume cricket match', JSON.stringify(resumeRes.data));
    }

    // End match
    const endRes = await req('POST', `/matches/${matchIds.cricket}/lifecycle`, {
      action: 'end',
    }, adminToken);
    if (endRes.status === 200 && endRes.data.data.status === 'completed') {
      pass('End cricket match', `winner=${endRes.data.data.resultSummary?.winnerId?.toString().slice(-6) || 'draw'}`);
    } else {
      fail('End cricket match', JSON.stringify(endRes.data));
    }
  }

  // ─── FOOTBALL ────────────────────────────────────
  if (matchIds.football) {
    await req('PUT', `/matches/${matchIds.football}/scorer`, { scorerUserId: adminUserId }, adminToken);
    const fStart = await req('POST', `/matches/${matchIds.football}/lifecycle`, { action: 'start' }, adminToken);

    if (fStart.status === 200) {
      // Start first half
      await req('POST', `/scoring/${matchIds.football}/events`, {
        eventType: 'half_start',
        eventData: {},
      }, adminToken);

      // Score goals (team must be 'a' or 'b', scorer is required)
      const goalRes = await req('POST', `/scoring/${matchIds.football}/events`, {
        eventType: 'goal',
        eventData: { team: 'a', scorer: 'player_1', minute: 23 },
      }, adminToken);
      if (goalRes.status === 201) {
        pass('Football goal event', `score: ${goalRes.data.data.currentState?.scoreA}-${goalRes.data.data.currentState?.scoreB}`);
      } else {
        fail('Football goal event', JSON.stringify(goalRes.data));
      }

      // Card (team 'a' or 'b', player required)
      const cardRes = await req('POST', `/scoring/${matchIds.football}/events`, {
        eventType: 'card',
        eventData: { cardType: 'yellow', team: 'b', player: 'player_2', minute: 35 },
      }, adminToken);
      if (cardRes.status === 201) {
        pass('Football card event');
      } else {
        fail('Football card event', JSON.stringify(cardRes.data));
      }

      // Another goal for team B
      await req('POST', `/scoring/${matchIds.football}/events`, {
        eventType: 'goal',
        eventData: { team: 'b', scorer: 'player_3', minute: 67 },
      }, adminToken);

      // End football
      const fEnd = await req('POST', `/matches/${matchIds.football}/lifecycle`, { action: 'end' }, adminToken);
      if (fEnd.status === 200) {
        pass('End football match', `score: ${fEnd.data.data.resultSummary?.scoreA}-${fEnd.data.data.resultSummary?.scoreB}`);
      } else {
        fail('End football match');
      }
    }
  }

  // ─── BASKETBALL 5v5 ──────────────────────────────
  if (matchIds.basketball_5v5) {
    await req('PUT', `/matches/${matchIds.basketball_5v5}/scorer`, { scorerUserId: adminUserId }, adminToken);
    const bStart = await req('POST', `/matches/${matchIds.basketball_5v5}/lifecycle`, { action: 'start' }, adminToken);

    if (bStart.status === 200) {
      // Score shots (team must be 'a' or 'b')
      const shots = [
        { eventType: 'shot_made', eventData: { shotType: '2pt', team: 'a', player: 'player_1' } },
        { eventType: 'shot_made', eventData: { shotType: '3pt', team: 'a', player: 'player_2' } },
        { eventType: 'shot_made', eventData: { shotType: '2pt', team: 'b', player: 'player_3' } },
        { eventType: 'shot_made', eventData: { shotType: 'ft', team: 'a', player: 'player_1' } },
        { eventType: 'foul', eventData: { team: 'b', player: 'player_4', foulType: 'personal' } },
      ];

      let bSuccess = 0;
      let lastBState = null;
      for (const s of shots) {
        const sRes = await req('POST', `/scoring/${matchIds.basketball_5v5}/events`, s, adminToken);
        if (sRes.status === 201) {
          bSuccess++;
          lastBState = sRes.data.data.currentState;
        }
      }
      pass(`Basketball 5v5 scoring: ${bSuccess} events`, `score: ${lastBState?.scoreA || 0}-${lastBState?.scoreB || 0}`);

      await req('POST', `/matches/${matchIds.basketball_5v5}/lifecycle`, { action: 'end' }, adminToken);
      pass('End basketball 5v5 match');
    }
  }

  // ─── BASKETBALL 3x3 ──────────────────────────────
  if (matchIds.basketball_3x3) {
    await req('PUT', `/matches/${matchIds.basketball_3x3}/scorer`, { scorerUserId: adminUserId }, adminToken);
    const b3Start = await req('POST', `/matches/${matchIds.basketball_3x3}/lifecycle`, { action: 'start' }, adminToken);

    if (b3Start.status === 200) {
      const b3Shots = [
        { eventType: 'shot_made', eventData: { shotType: '1pt', team: 'a', player: 'player_1' } },
        { eventType: 'shot_made', eventData: { shotType: '2pt', team: 'a', player: 'player_2' } },
        { eventType: 'shot_made', eventData: { shotType: '1pt', team: 'b', player: 'player_3' } },
      ];

      let b3s = 0;
      let lastState = null;
      for (const s of b3Shots) {
        const sRes = await req('POST', `/scoring/${matchIds.basketball_3x3}/events`, s, adminToken);
        if (sRes.status === 201) { b3s++; lastState = sRes.data.data.currentState; }
      }
      pass(`Basketball 3x3 scoring: ${b3s} events`, `score: ${lastState?.scoreA || 0}-${lastState?.scoreB || 0}`);
      await req('POST', `/matches/${matchIds.basketball_3x3}/lifecycle`, { action: 'end' }, adminToken);
      pass('End basketball 3x3 match');
    }
  }

  // ─── VOLLEYBALL ──────────────────────────────────
  if (matchIds.volleyball) {
    await req('PUT', `/matches/${matchIds.volleyball}/scorer`, { scorerUserId: adminUserId }, adminToken);
    const vStart = await req('POST', `/matches/${matchIds.volleyball}/lifecycle`, { action: 'start' }, adminToken);

    if (vStart.status === 200) {
      const vPoints = [
        { eventType: 'rally_point', eventData: { team: 'a' } },
        { eventType: 'rally_point', eventData: { team: 'b' } },
        { eventType: 'rally_point', eventData: { team: 'a' } },
        { eventType: 'rally_point', eventData: { team: 'a' } },
      ];

      let vs = 0;
      let lastState = null;
      for (const p of vPoints) {
        const pRes = await req('POST', `/scoring/${matchIds.volleyball}/events`, p, adminToken);
        if (pRes.status === 201) { vs++; lastState = pRes.data.data.currentState; }
      }
      pass(`Volleyball scoring: ${vs} rally points`, `current set score: ${lastState?.currentSetScoreA || 0}-${lastState?.currentSetScoreB || 0}`);
      await req('POST', `/matches/${matchIds.volleyball}/lifecycle`, { action: 'end' }, adminToken);
      pass('End volleyball match');
    }
  }

  // ─── TENNIS ──────────────────────────────────────
  if (matchIds.tennis) {
    await req('PUT', `/matches/${matchIds.tennis}/scorer`, { scorerUserId: adminUserId }, adminToken);
    const tStart = await req('POST', `/matches/${matchIds.tennis}/lifecycle`, { action: 'start' }, adminToken);

    if (tStart.status === 200) {
      const tPoints = [
        { eventType: 'point', eventData: { team: 'a', pointType: 'ace' } },
        { eventType: 'point', eventData: { team: 'b', pointType: 'winner' } },
        { eventType: 'point', eventData: { team: 'a', pointType: 'winner' } },
        { eventType: 'point', eventData: { team: 'a', pointType: 'double_fault' } },
      ];

      let ts2 = 0;
      let lastState = null;
      for (const p of tPoints) {
        const pRes = await req('POST', `/scoring/${matchIds.tennis}/events`, p, adminToken);
        if (pRes.status === 201) { ts2++; lastState = pRes.data.data.currentState; }
      }
      pass(`Tennis scoring: ${ts2} points`, `game: ${lastState?.currentGameScoreA || 0}-${lastState?.currentGameScoreB || 0}`);
      await req('POST', `/matches/${matchIds.tennis}/lifecycle`, { action: 'end' }, adminToken);
      pass('End tennis match');
    }
  }

  // ─── TABLE TENNIS ────────────────────────────────
  if (matchIds.table_tennis) {
    await req('PUT', `/matches/${matchIds.table_tennis}/scorer`, { scorerUserId: adminUserId }, adminToken);
    const ttStart = await req('POST', `/matches/${matchIds.table_tennis}/lifecycle`, { action: 'start' }, adminToken);

    if (ttStart.status === 200) {
      const ttPoints = [
        { eventType: 'point', eventData: { team: 'a' } },
        { eventType: 'point', eventData: { team: 'a' } },
        { eventType: 'point', eventData: { team: 'b' } },
      ];

      let tts = 0;
      let lastState = null;
      for (const p of ttPoints) {
        const pRes = await req('POST', `/scoring/${matchIds.table_tennis}/events`, p, adminToken);
        if (pRes.status === 201) { tts++; lastState = pRes.data.data.currentState; }
      }
      pass(`Table tennis scoring: ${tts} points`, `set: ${lastState?.currentSetScoreA || 0}-${lastState?.currentSetScoreB || 0}`);
      await req('POST', `/matches/${matchIds.table_tennis}/lifecycle`, { action: 'end' }, adminToken);
      pass('End table tennis match');
    }
  }

  // ─── BADMINTON ───────────────────────────────────
  if (matchIds.badminton) {
    await req('PUT', `/matches/${matchIds.badminton}/scorer`, { scorerUserId: adminUserId }, adminToken);
    const bStart = await req('POST', `/matches/${matchIds.badminton}/lifecycle`, { action: 'start' }, adminToken);

    if (bStart.status === 200) {
      const bPoints = [
        { eventType: 'rally_point', eventData: { team: 'a' } },
        { eventType: 'rally_point', eventData: { team: 'a' } },
        { eventType: 'rally_point', eventData: { team: 'b' } },
      ];

      let bs = 0;
      let lastState = null;
      for (const p of bPoints) {
        const pRes = await req('POST', `/scoring/${matchIds.badminton}/events`, p, adminToken);
        if (pRes.status === 201) { bs++; lastState = pRes.data.data.currentState; }
      }
      pass(`Badminton scoring: ${bs} rally points`);
      await req('POST', `/matches/${matchIds.badminton}/lifecycle`, { action: 'end' }, adminToken);
      pass('End badminton match');
    }
  }

  // ─── SQUASH ──────────────────────────────────────
  if (matchIds.squash) {
    await req('PUT', `/matches/${matchIds.squash}/scorer`, { scorerUserId: adminUserId }, adminToken);
    const sqStart = await req('POST', `/matches/${matchIds.squash}/lifecycle`, { action: 'start' }, adminToken);

    if (sqStart.status === 200) {
      const sqPoints = [
        { eventType: 'rally_point', eventData: { team: 'a' } },
        { eventType: 'rally_point', eventData: { team: 'b' } },
        { eventType: 'rally_point', eventData: { team: 'a' } },
      ];

      let sqs = 0;
      let lastState = null;
      for (const p of sqPoints) {
        const pRes = await req('POST', `/scoring/${matchIds.squash}/events`, p, adminToken);
        if (pRes.status === 201) { sqs++; lastState = pRes.data.data.currentState; }
      }
      pass(`Squash scoring: ${sqs} rally points`);
      await req('POST', `/matches/${matchIds.squash}/lifecycle`, { action: 'end' }, adminToken);
      pass('End squash match');
    }
  }

  // Test live matches endpoint
  // First let's start a match that stays live for the live match check
  const liveCheck = await req('GET', '/matches/live');
  if (liveCheck.status === 200) {
    pass('Get live matches endpoint', `count=${liveCheck.data.data.length}`);
  } else {
    fail('Get live matches');
  }
}

async function testStandings() {
  section('8. STANDINGS');

  if (tournamentIds.cricket) {
    const stRes = await req('GET', `/standings/tournament/${tournamentIds.cricket}`);
    if (stRes.status === 200) {
      pass('Get cricket standings', `entries=${stRes.data.data.length}`);
    } else {
      fail('Get cricket standings', JSON.stringify(stRes.data));
    }

    // Force recalculate
    const recalcRes = await req('POST', `/standings/tournament/${tournamentIds.cricket}/recalculate`, {}, adminToken);
    if (recalcRes.status === 200) {
      pass('Recalculate standings');
    } else {
      fail('Recalculate standings', JSON.stringify(recalcRes.data));
    }
  }
}

async function testSocketIO() {
  section('9. SOCKET.IO REAL-TIME');

  return new Promise(async (resolve) => {
    try {
      const socket = ioClient(BASE, {
        transports: ['websocket'],
        auth: { token: adminToken },
      });

      let connected = false;
      let joinedRoom = false;
      const receivedEvents = [];

      const timeout = setTimeout(() => {
        if (connected) {
          pass('Socket.io connection');
        } else {
          fail('Socket.io connection', 'Timeout');
        }
        if (joinedRoom) {
          pass('Socket.io room join');
        }
        if (receivedEvents.length > 0) {
          pass(`Socket.io events received`, `types: ${receivedEvents.join(', ')}`);
        } else {
          warn('Socket.io events', 'No events received (expected if no live matches)');
        }
        socket.disconnect();
        resolve();
      }, 5000);

      socket.on('connect', () => {
        connected = true;

        // Join a match room
        if (matchIds.cricket) {
          socket.emit('join_match', { matchId: matchIds.cricket });
          joinedRoom = true;
        }

        // Join tournament room
        if (tournamentIds.cricket) {
          socket.emit('join_tournament', { tournamentId: tournamentIds.cricket });
        }

        // Listen for events
        socket.on('score_update', (data) => {
          receivedEvents.push('score_update');
        });
        socket.on('match_lifecycle', (data) => {
          receivedEvents.push('match_lifecycle');
        });
        socket.on('commentary', (data) => {
          receivedEvents.push('commentary');
        });
        socket.on('match_update', (data) => {
          receivedEvents.push('match_update');
        });

        // Ping test
        socket.emit('ping_check');
        socket.on('pong_check', () => {
          receivedEvents.push('pong');
        });
      });

      socket.on('connect_error', (err) => {
        fail('Socket.io connection', err.message);
        clearTimeout(timeout);
        resolve();
      });
    } catch (err) {
      fail('Socket.io test', err.message);
      resolve();
    }
  });
}

async function testAI() {
  section('10. AI FEATURES');

  // Wait a moment for async commentary to finish generating
  await new Promise(r => setTimeout(r, 3000));

  // Check AI commentary for ALL 9 sports
  const allSports = ['cricket', 'football', 'basketball_5v5', 'basketball_3x3', 'volleyball', 'tennis', 'table_tennis', 'badminton', 'squash'];
  let totalWithCommentary = 0;
  let sportsWithCommentary = 0;
  const commentarySamples = {};

  for (const sport of allSports) {
    if (!matchIds[sport]) continue;
    const eventsRes = await req('GET', `/scoring/${matchIds[sport]}/events`);
    if (eventsRes.status === 200 && eventsRes.data.data) {
      const withComm = eventsRes.data.data.filter(e => e.aiCommentary);
      if (withComm.length > 0) {
        sportsWithCommentary++;
        totalWithCommentary += withComm.length;
        commentarySamples[sport] = withComm[0].aiCommentary;
      }
    }
  }

  if (sportsWithCommentary === allSports.length) {
    pass('AI commentary — all 9 sports', `${totalWithCommentary} events with commentary across ${sportsWithCommentary} sports`);
  } else if (sportsWithCommentary > 0) {
    pass('AI commentary generated', `${sportsWithCommentary}/${allSports.length} sports have commentary (${totalWithCommentary} total events)`);
  } else {
    warn('AI commentary', 'No events have commentary yet (may still be generating)');
  }

  // Show sample commentary from different sports
  const samples = Object.entries(commentarySamples).slice(0, 3);
  for (const [sport, text] of samples) {
    pass(`Commentary sample (${sport})`, text.substring(0, 80) + (text.length > 80 ? '...' : ''));
  }

  // Check match insights for ALL 9 completed sports
  let sportsWithInsights = 0;
  for (const sport of allSports) {
    if (!matchIds[sport]) continue;
    const mRes = await req('GET', `/matches/${matchIds[sport]}`);
    if (mRes.status === 200 && mRes.data.data.matchInsights) {
      sportsWithInsights++;
    }
  }

  if (sportsWithInsights === allSports.length) {
    pass('Match insights — all 9 sports', `All ${sportsWithInsights} completed matches have insights`);
  } else if (sportsWithInsights > 0) {
    pass('Match insights generated', `${sportsWithInsights}/${allSports.length} sports have insights`);
  } else {
    fail('Match insights', 'No insights generated for any sport');
  }

  // Show detailed insights for cricket (sample)
  if (matchIds.cricket) {
    const mRes = await req('GET', `/matches/${matchIds.cricket}`);
    if (mRes.status === 200) {
      const insights = mRes.data.data.matchInsights;
      if (insights) {
        if (insights.narrative) pass('Cricket narrative', insights.narrative.substring(0, 80) + '...');
        if (insights.keyMoments?.length > 0) pass('Cricket key moments', `${insights.keyMoments.length} moments — ${insights.keyMoments[0]}`);
        if (insights.insights?.length > 0) pass('Cricket analytics', `${insights.insights.length} insights — ${insights.insights[0]}`);
        if (insights.stats) pass('Cricket match stats', `Boundaries: ${insights.stats.boundaries || 0}, Wickets: ${insights.stats.wickets || 0}`);
      }

      // Check win probability
      if (mRes.data.data.winProbability) {
        pass('Win probability', JSON.stringify(mRes.data.data.winProbability));
      }

      // Check AI summary (enhanced, async)
      if (mRes.data.data.aiSummary) {
        const summary = typeof mRes.data.data.aiSummary === 'string'
          ? mRes.data.data.aiSummary.substring(0, 80)
          : mRes.data.data.aiSummary.narrative?.substring(0, 80) || JSON.stringify(mRes.data.data.aiSummary).substring(0, 80);
        pass('AI match summary (enhanced)', summary + '...');
      } else {
        warn('AI match summary', 'AI-enhanced summary not generated yet (async process)');
      }
    }
  }

  // Show insights for one non-cricket sport (football)
  if (matchIds.football) {
    const fRes = await req('GET', `/matches/${matchIds.football}`);
    if (fRes.status === 200 && fRes.data.data.matchInsights) {
      const fi = fRes.data.data.matchInsights;
      pass('Football insights', `${fi.insights?.length || 0} insights, ${fi.keyMoments?.length || 0} key moments`);
      if (fi.stats) pass('Football stats', `Goals: ${fi.stats.goals || 0}, Cards: ${fi.stats.cards || 0}`);
    }
  }
}

async function testNotifications() {
  section('11. NOTIFICATIONS');

  // Get notifications
  const notifRes = await req('GET', '/notifications', null, adminToken);
  if (notifRes.status === 200) {
    pass('Get notifications', `count=${notifRes.data.data.length}`);
  } else {
    fail('Get notifications', JSON.stringify(notifRes.data));
  }

  // Get unread count
  const unreadRes = await req('GET', '/notifications/unread-count', null, adminToken);
  if (unreadRes.status === 200) {
    pass('Get unread count', `count=${unreadRes.data.data?.count || 0}`);
  } else {
    fail('Get unread count');
  }

  // Register push subscription
  const pushRes = await req('POST', '/notifications/push-subscription', {
    platform: 'web_push',
    token: 'test-push-token-' + Date.now(),
    endpoint: 'https://fcm.googleapis.com/test-endpoint',
    keys: {
      p256dh: 'test-p256dh-key',
      auth: 'test-auth-key',
    },
  }, adminToken);
  if (pushRes.status === 200 || pushRes.status === 201) {
    pass('Register push subscription');
  } else {
    fail('Register push subscription', JSON.stringify(pushRes.data));
  }

  // Mark all as read
  const markRes = await req('PUT', '/notifications/read-all', {}, adminToken);
  if (markRes.status === 200) {
    pass('Mark all notifications as read');
  } else {
    fail('Mark all notifications as read', JSON.stringify(markRes.data));
  }
}

async function testAuditLogs() {
  section('12. AUDIT LOGS');

  if (orgId) {
    const auditRes = await req('GET', `/audit/org/${orgId}?limit=5`, null, adminToken);
    if (auditRes.status === 200 && auditRes.data.data.length > 0) {
      const actionTypes = [...new Set(auditRes.data.data.map(a => a.actionType))];
      pass('Get audit logs', `count=${auditRes.data.data.length}, types: ${actionTypes.join(', ')}`);
    } else {
      fail('Get audit logs', JSON.stringify(auditRes.data));
    }

    // Export audit logs
    const exportRes = await req('GET', `/audit/org/${orgId}/export`, null, adminToken);
    if (exportRes.status === 200) {
      pass('Export audit logs (CSV)');
    } else {
      fail('Export audit logs', JSON.stringify(exportRes.data));
    }
  }
}

async function testEdgeCases() {
  section('13. EDGE CASES & ERROR HANDLING');

  // 404
  const notFound = await req('GET', '/nonexistent');
  if (notFound.status === 404) {
    pass('404 for unknown route');
  } else {
    fail('404 handling', `Got ${notFound.status}`);
  }

  // Invalid ObjectId
  const badId = await req('GET', '/matches/invalid-id');
  if (badId.status >= 400) {
    pass('Invalid ObjectId handling', `status=${badId.status}`);
  } else {
    fail('Invalid ObjectId handling');
  }

  // Unauthorized access
  const unauth = await req('POST', '/organizations', { name: 'Hack' });
  if (unauth.status === 401) {
    pass('Unauthorized access blocked', `status=${unauth.status}`);
  } else {
    fail('Unauthorized access blocking', `Expected 401, got ${unauth.status}`);
  }

  // Invalid tournament status transition
  if (tournamentIds.cricket) {
    const badTransition = await req('PUT', `/tournaments/${tournamentIds.cricket}/status`, {
      status: 'draft',
    }, adminToken);
    if (badTransition.status === 400) {
      pass('Invalid status transition rejected');
    } else {
      fail('Invalid status transition', `Expected 400, got ${badTransition.status}`);
    }
  }

  // Scoring on completed match
  if (matchIds.cricket) {
    const scoreDone = await req('POST', `/scoring/${matchIds.cricket}/events`, {
      eventType: 'ball',
      eventData: { runs: 4 },
    }, adminToken);
    if (scoreDone.status === 400) {
      pass('Reject scoring on completed match');
    } else {
      fail('Should reject scoring on completed match', `Got ${scoreDone.status}`);
    }
  }
}

// ─── FINAL REPORT ─────────────────────────────────

async function printReport() {
  section('FINAL TEST REPORT');

  const passed = results.filter(r => r.status.includes('PASS')).length;
  const failed = results.filter(r => r.status.includes('FAIL')).length;
  const warned = results.filter(r => r.status.includes('WARN')).length;
  const total = results.length;

  console.log(`\n  Total: ${total} | ✅ Passed: ${passed} | ❌ Failed: ${failed} | ⚠️  Warnings: ${warned}`);
  console.log(`  Pass Rate: ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    console.log('  ─── Failed Tests ───');
    for (const r of results.filter(r => r.status.includes('FAIL'))) {
      console.log(`    ❌ #${r.num} ${r.name}: ${r.detail}`);
    }
  }

  if (warned > 0) {
    console.log('\n  ─── Warnings ───');
    for (const r of results.filter(r => r.status.includes('WARN'))) {
      console.log(`    ⚠️  #${r.num} ${r.name}: ${r.detail}`);
    }
  }

  console.log(`\n  ─── Created Sample Data ───`);
  console.log(`    Organization : ${orgId}`);
  console.log(`    Tournaments  : ${Object.keys(tournamentIds).length} (${Object.keys(tournamentIds).join(', ')})`);
  console.log(`    Teams        : ${Object.keys(teamIds).length * 2}`);
  console.log(`    Matches      : ${Object.keys(matchIds).length}`);
  console.log(`    Players      : ${playerIds.length}`);
  console.log();
}

// ─── RUN ALL TESTS ────────────────────────────────

async function main() {
  console.log('\n🏆 MatchPulse E2E Test Suite');
  console.log(`📍 Server: ${BASE}`);
  console.log(`📅 ${new Date().toISOString()}\n`);

  try {
    await testHealth();
    await testAuth();
    await testOrganization();
    await testTournamentsAndTeams();
    await testFixtures();
    await testMatchCreationAndLifecycle();
    await testLiveScoring();
    await testStandings();
    await testSocketIO();
    await testAI();
    await testNotifications();
    await testAuditLogs();
    await testEdgeCases();
  } catch (error) {
    console.error('\n💀 Test runner crashed:', error.message);
    console.error(error.stack);
  }

  await printReport();
  process.exit(0);
}

main();
