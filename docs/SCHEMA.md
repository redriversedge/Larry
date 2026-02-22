# Larry — Data Schema v2

## localStorage Keys
| Key | Type | Description |
|-----|------|-------------|
| `larry_state` | JSON | Full app state object |
| `larry_chat` | JSON | Chat history array |
| `larry_cache` | JSON | Cached ESPN API responses with TTL |
| `larry_version` | string | Schema version for migration |

## State Object (`S`)
```
S = {
  // --- APP META ---
  version: "2.0.0",
  initialized: false,
  setupComplete: false,
  currentTab: 0,            // 0-4 (Roster, Matchup, Players, Larry, League)
  leagueSubPage: null,      // null or string key for League menu sub-pages
  lastActivity: ISO string,

  // --- ESPN CONNECTION ---
  espn: {
    leagueId: "",
    espnS2: "",
    swid: "",
    connected: false,
    lastSync: null,          // ISO string
    syncInterval: 15,        // minutes
    autoSync: true,
    syncLog: [],             // last 10 {timestamp, status, message}
    syncMethod: "proxy",     // "proxy" | "direct" | "manual"
  },

  // --- LEAGUE SETTINGS (auto-detected from ESPN) ---
  league: {
    name: "",
    seasonId: 2026,
    segmentId: 0,
    teamCount: 0,
    scoringType: "",         // "H2H_CATEGORY" | "H2H_POINTS" | etc
    categories: [],          // [{id, abbr, name, color, isPercent}]
    rosterSlots: [],         // [{slotId, name, count}] e.g. [{slotId:0, name:"PG", count:1}]
    startingSlots: 0,
    benchSlots: 0,
    irSlots: 0,
    acquisitionLimit: -1,    // per matchup, -1 = unlimited
    matchupPeriodLength: 7,  // days
    playoffTeams: 0,
    playoffStartMatchup: 0,
    playoffLength: 0,
    currentMatchupPeriod: 0,
    currentScoringPeriodId: 0,
    schedule: [],            // [{matchupPeriodId, home:{teamId,wins,losses}, away:{...}}]
  },

  // --- USER'S TEAM ---
  myTeam: {
    teamId: 0,
    name: "",
    abbrev: "",
    owner: "",
    record: { wins: 0, losses: 0, ties: 0 },
    pointsFor: 0,
    pointsAgainst: 0,
    playoffSeed: 0,
    waiverRank: 0,
    acquisitionsUsed: 0,     // this matchup period
    acquisitionsTotal: 0,    // season total
    players: [],             // Player objects (see below)
  },

  // --- ALL LEAGUE TEAMS ---
  teams: [],                 // [{teamId, name, abbrev, owner, record, players, ...}]

  // --- CURRENT MATCHUP ---
  matchup: {
    matchupPeriodId: 0,
    startDate: "",
    endDate: "",
    myTeamId: 0,
    opponentTeamId: 0,
    opponentName: "",
    myScores: {},            // {PTS: 342, REB: 180, ...} keyed by category abbr
    oppScores: {},
    myRecord: { wins: 0, losses: 0, ties: 0 },  // category W-L in this matchup
    daysRemaining: 0,
    myGamesRemaining: 0,
    oppGamesRemaining: 0,
  },

  // --- FREE AGENTS / PLAYER DB ---
  allPlayers: [],            // Full player pool from ESPN (200+)
  freeAgents: [],            // Subset: players not on any roster

  // --- WATCHLIST ---
  watchlist: [],             // array of ESPN player IDs

  // --- NOTIFICATIONS ---
  notifications: [],         // [{id, type, title, body, timestamp, read, playerId?}]
  notifBadgeCount: 0,

  // --- USER PREFERENCES ---
  prefs: {
    defaultStatView: "season",   // "season" | "last30" | "last7"
    chartTheme: "dark",
    collapsedSections: {},       // {sectionKey: true/false}
    claudeApiKey: "",            // stored locally, sent only to user's own proxy
  },

  // --- CHAT ---
  chatHistory: [],           // [{role, content, timestamp}]

  // --- ANALYSIS CACHE ---
  analysisCache: {
    zScores: null,           // computed z-scores, invalidated on data refresh
    projections: null,
    tradeTargets: null,
    puntAnalysis: null,
    lastComputed: null,
  },
}
```

## Player Object
```
{
  id: 0,                    // ESPN player ID
  name: "",
  firstName: "",
  lastName: "",
  positions: [],             // ["PG", "SG"]
  eligibleSlots: [],         // ESPN slot IDs
  defaultPositionId: 0,
  nbaTeamId: 0,
  nbaTeam: "",               // "LAL", "BOS", etc
  nbaTeamName: "",           // "Lakers", "Celtics"
  status: "ACTIVE",          // "ACTIVE" | "OUT" | "GTD" | "DTD" | "SUSPENDED" | "IR"
  injuryStatus: "",          // "HEALTHY" | "DAY_TO_DAY" | "OUT" | etc
  injuryNote: "",
  slot: "",                  // Current roster slot: "PG", "BE", "IR"
  slotId: 0,
  onTeamId: 0,               // which fantasy team owns (0 = free agent)
  ownership: 0,              // ESPN ownership %
  stats: {
    season: {},              // keyed by category abbr {PTS: 24.3, REB: 5.1, ...}
    last30: {},
    last15: {},
    last7: {},
    projectedSeason: {},
    projectedMatchup: {},
  },
  gamesPlayed: 0,
  minutesPerGame: 0,
  schedule: [],              // upcoming games [{date, opponent, home}]
  gamesRemaining: 0,         // in current matchup
  gamesRemainingROS: 0,      // rest of season
  gamesToday: false,
  gameToday: null,            // {opponent, time, home} or null
  zScores: {},               // {PTS: 1.2, REB: -0.3, ..., total: 2.4}
  trend: "",                 // "hot" | "cold" | "stable"
  notes: "",                 // user notes
}
```

## ESPN Category Mapping
```
ESPN Stat ID → Abbreviation
0: PTS, 1: BLK, 2: STL, 3: AST, 6: REB,
17: 3PM, 19: FG%, 20: FT%, 11: TO,
37: DD (double-double), 39: TD (triple-double),
40: OREB, 41: DREB, 16: FGM, 13: FTM
```

## ESPN Position Mapping
```
ESPN Slot → Position
0: PG, 1: SG, 2: SF, 3: PF, 4: C,
5: G (PG/SG), 6: F (SF/PF), 7: SG/SF,
8: G/F, 9: PF/C, 10: F/C,
11: UTIL, 12: BE (bench), 13: IR
```
