# Larry — Bug List & Priority Order

Work through these in order. Each phase unblocks the next.

## Phase 1: Global Blockers (fix these first — they affect everything)

- [x] **Scroll lockout** — Multiple pages can't scroll (Settings, Draft Center rankings, others). Audit ALL pages and sub-pages. Every content container needs `overflow-y: auto` and proper height constraints. This is likely a CSS issue with flex containers or fixed positioning eating available height.
- [x] **Auto-refresh** — App should sync ESPN data on initial load and every 2 minutes. Show subtle refresh indicator. Don't interrupt user's current view or scroll position.
- [x] **Stat column order** — Change to REB, AST, STL, BLK, PTS everywhere stats appear (Roster, Matchup Score/Projections/Recap, Players). Single global constant for column order.

## Phase 2: Critical UX (these make core features unusable)

- [x] **Players tab keyboard dismissal** — Keyboard disappears after each letter typed. The input element is re-rendering on every keystroke. Fix: debounce search with `oninput`, don't re-render the input element itself, only re-render the results list below it.
- [x] **Players tab search broken** — Search returns no results. Debug the filter logic.
- [x] **Player name click → popup not working** — Tapping player name should open detail popup (game log, trends, z-scores, DURANT rank). Was built in v2.2 Phase 1 but appears broken. Debug and fix.
- [x] **Stats filter → dropdown** — Both Roster and Players tabs: change stat view from clickable buttons to `<select>` dropdown.
- [x] **Playing On filter → dropdown** — Players tab: change from text input to date-picker dropdown (next 10 days).
- [x] **Player column header left-align** — Left-align the header text for the player name column.

## Phase 3: Engine Fixes (these produce wrong/missing data)

- [x] **Decision Hub recommendations broken** — Suggesting dropping KAT (elite player). The drop candidate logic must respect player value. Only suggest dropping players in the bottom 40% of roster by DURANT rank. All recommendations need specific reasoning with numbers.
- [x] **Monte Carlo / win probability broken** — Showing exactly 100% or 0% with no variance. Must project FORWARD using remaining games × per-game averages for both teams, then run Monte Carlo with realistic variance. If lineup isn't set for full matchup period, flag it. Should update when roster changes.
- [x] **Schedule Advantage section not working** — Matchup tab Score section. Should show games remaining for both teams, per-day breakdown, flag significant advantages.
- [x] **Schedule grid shows nothing** — League sub-page. Heat map and game density calendar are empty. NBA schedule data not flowing.
- [x] **ROS projections show 0 across the board** — Rest-of-season projections need to calculate (per-game avg × remaining games). Move ROS to Roster and Players tabs as a stat filter option alongside Season/L30/L15/L7.
- [x] **Biggest risers/fallers percentages over 100%** — Cap or fix the percentage calculation in Stats & Trends.

## Phase 4: New Features

- [x] **Date-scrollable roster view (ESPN-style)** — Major feature. Add date navigation with left/right arrows. Default: today. Past dates show historical lineup + actual stats. Future dates show current lineup + projections. This is the core roster experience.
- [x] **Move Dashboard to Roster tab** — Dashboard becomes first section on Roster (before Lineup and Decisions). Remove from League menu.
- [x] **Stats Key / Glossary** — Accessible help section explaining z-score, DURANT, and all custom metrics. Include examples using real player context. Place as a (?) icon in header that opens a modal.
- [x] **Trade Center targets empty** — Trade targets board shows nothing. Fix data flow.
- [x] **Trade Finder improvements** — Default: show trades 50%+ acceptance probability. Add: search for specific player to see trade options (any acceptance %). Keep pre-populated suggestions.
- [x] **Players tab defaults** — Default view: all unrostered (available) players sorted by DURANT ranking.
- [x] **Team of the Week → Matchup tab** — Move from Season Timeline to Matchup tab Score section, below Schedule Advantage. Rolling tracker of best-performing team during current matchup period.
- [x] **Draft Center filters** — Add tier filter and projected draft round filter. Fix scroll.

## Phase 5: Larry Chat

- [x] **Larry API error** — Shows "ANTHROPIC_API_KEY not configured." Verify `netlify/functions/larry-chat.js` has correct function signature, env var reference (`process.env.ANTHROPIC_API_KEY`), and request/response handling. Cliff will fix the Netlify env var.
