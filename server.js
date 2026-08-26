const express = require("express");
const Database = require("better-sqlite3");
const cors = require("cors");
const path = require("path");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" },
}));

// ── Auth middleware ─────────────────────────────────────────
const PUBLIC_EXTENSIONS = /\.(css|js|svg|png|ico|woff2?)$/i;
// Pages accessible without login (guest access)
const GUEST_PAGES = ["/login.html"];
// API endpoints accessible without login
const GUEST_API = ["/api/me", "/api/login"];

app.use((req, res, next) => {
  if (req.session.authenticated) return next();
  if (PUBLIC_EXTENSIONS.test(req.path)) return next();
  // Always allow guest pages
  if (GUEST_PAGES.includes(req.path)) return next();
  // Always allow login endpoint (POST)
  if (req.path === "/api/login") return next();
  // Allow guest read API
  if (req.method === "GET") {
    if (req.path === "/api/me") return next();
    if (req.path === "/api/players" || req.path.startsWith("/api/players/")) return next();
    if (req.path === "/api/tournaments" || req.path.startsWith("/api/tournaments/")) return next();
    if (req.path.startsWith("/api/tournament-state/")) return next();
  }
  // Block API mutations
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
  // Redirect all other pages to login
  return res.redirect("/login.html");
});

app.use(express.static(path.join(__dirname, "public")));

// ── Auth endpoints ──────────────────────────────────────────
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Invalid credentials" });
});

app.get("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ role: req.session.authenticated ? "admin" : "guest" });
});

// ── Database ────────────────────────────────────────────────
const db = new Database(process.env.DATABASE_PATH || path.join(__dirname, "data.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tournament_state (
    tournament_id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
`);

// ── Computed/public-facing player fields ───────────────────
// Same date format used across the admin app: "ДД.ММ.ГГГГ"
function ageFromBirth(birth) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((birth || "").trim());
  if (!m) return null;
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  const md = (now.getMonth() + 1) - mo || (now.getDate() - d);
  if (md < 0) age--;
  return age >= 0 && age < 130 ? age : null;
}

// Computes live rank for every player: rated players ordered by rating desc
// (ties broken by original join order), unrated players placed after them,
// in join order. Mirrors public/player.html's ratingRank(), extended to
// rank unrated players too (needed for the public Rating table).
// `rows` must be [{ id, data }] as read from the players table, in rowid order.
function computeRanks(rows) {
  const parsed = rows.map((r) => ({ id: r.id, p: JSON.parse(r.data) }));
  const rated = parsed.filter((x) => x.p.rating != null)
    .sort((a, b) => b.p.rating - a.p.rating);
  const unrated = parsed.filter((x) => x.p.rating == null); // rows already in join order
  const ordered = rated.concat(unrated);
  const rankById = {};
  ordered.forEach((x, i) => { rankById[x.id] = i + 1; });
  return rankById;
}

// Rating trend arrow is only shown for 7 days after the rating actually
// changed; after that the plain rating number stands alone.
const TREND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Adds public-facing computed fields to a player object without removing the
// original admin fields (forehand/backhand/trend/etc. stay untouched so the
// admin UI keeps working exactly as before).
// opts.ungated skips the 7-day trend expiry — used ONLY by the admin app's own
// internal views (via ?ungated=1). Default (public-facing) keeps the gate, so
// TTCB public's proxy sees trend arrows expire after 7 days exactly as before.
function enrichPlayer(p, rankById, opts = {}) {
  const matches = (p.won || 0) + (p.lost || 0);
  const winRate = matches > 0 ? (p.won / matches) * 100 : null;
  const rank = rankById ? (rankById[p.id] || null) : null;
  const rankChange = (rank != null && p.rankBefore != null) ? (p.rankBefore - rank) : null;
  // Only surface a trend if the rating changed within the last 7 days. Missing
  // ratingChangedAt (legacy data) counts as expired, so no arrow shows until
  // the rating next changes. Null trend → frontend renders no arrow. When
  // ungated, the stored direction is always shown (admin's own view).
  const trendFresh = opts.ungated === true || (p.ratingChangedAt != null &&
    (Date.now() - p.ratingChangedAt) < TREND_WINDOW_MS);
  return Object.assign({}, p, {
    age: ageFromBirth(p.birth),
    matches: matches,
    winRate: winRate,
    rightRubber: p.forehand || "",
    leftRubber: p.backhand || "",
    rank: rank,
    rankChange: rankChange, // positive = moved up, negative = moved down, null = no prior data
    trend: trendFresh ? (p.trend || null) : null,
  });
}

// Reads every player row in join (rowid) order — the shape computeRanks expects.
function readPlayerRows() {
  return db.prepare("SELECT rowid, id, data FROM players ORDER BY rowid").all();
}

// Runs a player mutation, then refreshes the rank-change baseline (rankBefore)
// so that ONLY the meaningful movers show a rank-delta arrow — never the whole
// cascade of players who merely shifted one slot.
//
// opts.movers  – ids whose rating actually changed (the direct cause). Each
//   shows its real before/after delta. A created player (no prior rank) or a
//   deleted player produces no mover arrow.
// opts.boundaryNeighbour (default true) – for a SINGLE-mover event also mark the
//   one player the mover displaced by exactly one slot: on an up-move, whoever
//   now sits directly below the mover's new rank (delta -1); on a down-move,
//   whoever rose into the slot the mover vacated (delta +1). Batch events set
//   this false: with many overlapping shift-ranges a single neighbour isn't
//   well-defined, so only the rating-changers show a delta.
//
// Everyone else whose rank shifted is rebased to their CURRENT rank (delta 0 →
// no arrow) so a stale baseline can't manufacture a phantom -1. Un-shifted
// players are left untouched, preserving any prior pending delta.
function applyRankDiff(mutate, opts = {}) {
  const movers = opts.movers || [];
  const withNeighbour = opts.boundaryNeighbour !== false;
  const getStmt = db.prepare("SELECT data FROM players WHERE id = ?");
  // UPDATE (not INSERT OR REPLACE) so rewriting rankBefore never churns the
  // rowid — computeRanks uses rowid as its join-order tiebreak / unrated order.
  const saveStmt = db.prepare("UPDATE players SET data = ? WHERE id = ?");
  db.transaction(() => {
    const before = computeRanks(readPlayerRows());
    mutate();
    const after = computeRanks(readPlayerRows());

    const afterByRank = {}; // after-rank → id, for locating the boundary neighbour
    for (const id of Object.keys(after)) afterByRank[after[id]] = id;

    // baseline[id] = the rankBefore we deliberately want for a mover/neighbour.
    const baseline = {};
    const markNeighbour = (nid) => {
      if (nid != null && before[nid] != null) baseline[nid] = before[nid]; // yields ±1
    };
    for (const moverId of movers) {
      const o = before[moverId]; // undefined for a freshly created player
      const n = after[moverId];  // undefined for a deleted player
      if (o != null && n != null) {
        baseline[moverId] = o; // mover shows its real delta o - n
        if (withNeighbour && n !== o) {
          markNeighbour(n < o ? afterByRank[n + 1] : afterByRank[o]);
        }
      } else if (withNeighbour && o == null && n != null) {
        markNeighbour(afterByRank[n + 1]); // created at n → displaces one player down (-1)
      } else if (withNeighbour && n == null && o != null) {
        markNeighbour(afterByRank[o]);     // deleted from o → one player rises into it (+1)
      }
    }

    const marked = new Set(Object.keys(baseline));
    const ids = new Set([...Object.keys(after), ...movers]);
    for (const id of ids) {
      let value;
      if (marked.has(id)) {
        value = baseline[id];
      } else if (before[id] != null && after[id] != null && after[id] !== before[id]) {
        value = after[id]; // cascade bystander → suppress to current rank (no arrow)
      } else {
        continue; // un-shifted, created (no prior rank), or deleted → leave as-is
      }
      const row = getStmt.get(id);
      if (!row) continue;
      const p = JSON.parse(row.data);
      p.rankBefore = value;
      saveStmt.run(JSON.stringify(p), id);
    }
  })();
}

// Stamps trend + ratingChangedAt server-side whenever the rating changed
// numerically. Centralising this covers manual edits, new-player creation, and
// tournament finishes identically, and keeps the 7-day arrow window honest.
// Mutates `next`; returns true iff the rating actually changed.
function stampRatingChange(prev, next, opts = {}) {
  const prevRating = opts.ratingBefore != null
    ? Number(opts.ratingBefore)
    : (prev && prev.rating != null ? Number(prev.rating) : null);
  const nextRating = next.rating != null ? Number(next.rating) : null;
  if (nextRating != null && nextRating !== prevRating) {
    next.trend = prevRating != null && nextRating < prevRating ? "down" : "up";
    next.ratingChangedAt = Date.now();
    return true;
  }
  return false;
}

// Returns a random unique 6-digit clubId (100000–999999)
function generateClubId() {
  const existing = new Set(
    db.prepare("SELECT data FROM players").all()
      .map(r => JSON.parse(r.data).clubId)
      .filter(Boolean)
  );
  let id;
  do { id = Math.floor(100000 + Math.random() * 900000); } while (existing.has(id));
  return id;
}

// Seed default players if table is empty
const count = db.prepare("SELECT COUNT(*) as n FROM players").get();
if (count.n === 0) {
  const SEED = [
    { id:"p01", lastName:"Виноградов", firstName:"Дмитрий",  gender:"m", birth:"07.04.2002", country:"Россия", city:"Санкт-Петербург",  hand:"left",  rating:2048, trend:"up",   tournaments:29, won:87,  lost:62, blade:"Butterfly Mizutani Jun ZLC",      forehand:"Butterfly Tenergy 05",   backhand:"Butterfly Tenergy 05" },
    { id:"p02", lastName:"Казанцев",   firstName:"Артём",    gender:"m", birth:"15.09.1998", country:"Россия", city:"Москва",           hand:"right", rating:1976, trend:"up",   tournaments:34, won:101, lost:70, blade:"Stiga Cybershape Carbon",         forehand:"Butterfly Dignics 09c",  backhand:"Butterfly Tenergy 64" },
    { id:"p03", lastName:"Лосев",      firstName:"Павел",    gender:"m", birth:"22.12.1995", country:"Россия", city:"Казань",           hand:"right", rating:1840, trend:"down", tournaments:41, won:120, lost:98, blade:"Donic Waldner Senso",             forehand:"Donic Bluefire M1",      backhand:"Donic Bluefire M2" },
    { id:"p04", lastName:"Бочаров",    firstName:"Андрей",   gender:"m", birth:"03.06.2001", country:"Россия", city:"Новосибирск",      hand:"right", rating:1795, trend:"up",   tournaments:22, won:64,  lost:51, blade:"Butterfly Viscaria",              forehand:"Butterfly Tenergy 05",   backhand:"Butterfly Rozena" },
    { id:"p05", lastName:"Назаренко",  firstName:"Егор",     gender:"m", birth:"11.02.1999", country:"Россия", city:"Екатеринбург",     hand:"left",  rating:1712, trend:"down", tournaments:27, won:73,  lost:69, blade:"Tibhar Stratus PowerWood",        forehand:"Tibhar Evolution MX-P",  backhand:"Tibhar Evolution EL-P" },
    { id:"p06", lastName:"Счастливый", firstName:"Виктор",   gender:"m", birth:"30.08.2003", country:"Россия", city:"Самара",           hand:"right", rating:1664, trend:"up",   tournaments:18, won:49,  lost:40, blade:"Yasaka Ma Lin Extra Offensive",   forehand:"Yasaka Rakza 7",         backhand:"Yasaka Rakza 7 Soft" },
    { id:"p07", lastName:"Балабан",    firstName:"Глеб",     gender:"m", birth:"19.05.1997", country:"Россия", city:"Нижний Новгород",  hand:"right", rating:1590, trend:"down", tournaments:31, won:88,  lost:84, blade:"Butterfly Timo Boll ALC",         forehand:"Butterfly Tenergy 80",   backhand:"Butterfly Tenergy 05" },
    { id:"p08", lastName:"Муравейник", firstName:"Григорий", gender:"m", birth:"08.11.2000", country:"Россия", city:"Челябинск",        hand:"left",  rating:1521, trend:"up",   tournaments:15, won:38,  lost:33, blade:"Stiga Infinity VPS V",            forehand:"Stiga DNA Pro M",        backhand:"Stiga DNA Pro H" },
    { id:"p09", lastName:"Бранд",      firstName:"Сергей",   gender:"m", birth:"25.03.1994", country:"Россия", city:"Ростов-на-Дону",   hand:"right", rating:1487, trend:"down", tournaments:38, won:99,  lost:104,blade:"Andro Treiber Q",                 forehand:"Andro Rasanter R47",     backhand:"Andro Rasanter R42" },
    { id:"p10", lastName:"Орлов",      firstName:"Михаил",   gender:"m", birth:"14.07.2004", country:"Россия", city:"Уфа",              hand:"right", rating:1402, trend:"up",   tournaments:9,  won:24,  lost:19, blade:"Cornilleau Hinotec Off",          forehand:"Cornilleau Target Pro GT-H47", backhand:"Cornilleau Target Pro GT-M43" },
    { id:"p11", lastName:"Зайцев",     firstName:"Никита",   gender:"m", birth:"02.10.2005", country:"Россия", city:"Пермь",            hand:"right", rating:null, trend:null,   tournaments:0,  won:0,   lost:0,  blade:"", forehand:"", backhand:"" },
    { id:"p12", lastName:"Громов",     firstName:"Илья",     gender:"m", birth:"27.01.2006", country:"Россия", city:"Волгоград",        hand:"left",  rating:null, trend:null,   tournaments:0,  won:0,   lost:0,  blade:"", forehand:"", backhand:"" },
    { id:"p13", lastName:"Соколов",    firstName:"Тимур",    gender:"m", birth:"09.06.2005", country:"Россия", city:"Краснодар",        hand:"right", rating:null, trend:null,   tournaments:0,  won:0,   lost:0,  blade:"", forehand:"", backhand:"" },
  ];
  const insert = db.prepare("INSERT INTO players (id, data) VALUES (?, ?)");
  const insertMany = db.transaction((players) => {
    for (const p of players) {
      const player = Object.assign({ name: [p.lastName, p.firstName].filter(Boolean).join(" ") }, p);
      insert.run(p.id, JSON.stringify(player));
    }
  });
  insertMany(SEED);
}

// Migration: assign random 6-digit clubIds to players without one or with old sequential ids
const needsClubId = db.prepare("SELECT id, data FROM players ORDER BY rowid").all()
  .filter(row => { const p = JSON.parse(row.data); return !p.clubId || p.clubId < 100000; });
if (needsClubId.length > 0) {
  const updateClubId = db.prepare("UPDATE players SET data = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of needsClubId) {
      const p = JSON.parse(row.data);
      p.clubId = generateClubId();
      updateClubId.run(JSON.stringify(p), row.id);
    }
  })();
}

// Migration: assign status to players that don't have one yet.
// Rule: tournaments >= 5 → 'Regular', else → 'Newcomer'. Archive is purely manual, never backfilled.
const needsStatus = db.prepare("SELECT id, data FROM players ORDER BY rowid").all()
  .filter(row => { const p = JSON.parse(row.data); return !p.status; });
if (needsStatus.length > 0) {
  const updateStatus = db.prepare("UPDATE players SET data = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of needsStatus) {
      const p = JSON.parse(row.data);
      p.status = (p.tournaments || 0) >= 5 ? 'Regular' : 'Newcomer';
      updateStatus.run(JSON.stringify(p), row.id);
    }
  })();
  console.log(`[migration] Assigned status to ${needsStatus.length} players`);
}

// Migration: assign registeredAt to players that don't have one yet.
// Backfill value is the migration date (today) — per GM's decision, technically
// inaccurate for existing players but acceptable for display purposes.
const needsRegisteredAt = db.prepare("SELECT id, data FROM players ORDER BY rowid").all()
  .filter(row => !JSON.parse(row.data).registeredAt);
if (needsRegisteredAt.length > 0) {
  const now = Date.now();
  const updateReg = db.prepare("UPDATE players SET data = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of needsRegisteredAt) {
      const p = JSON.parse(row.data);
      p.registeredAt = now;
      updateReg.run(JSON.stringify(p), row.id);
    }
  })();
  console.log(`[migration] Set registeredAt on ${needsRegisteredAt.length} players`);
}

// ── Players API ─────────────────────────────────────────────

// GET all players
app.get("/api/players", (req, res) => {
  const ungated = req.query.ungated === "1"; // admin's own view opts out of 7-day trend expiry
  const rows = db.prepare("SELECT rowid, id, data FROM players ORDER BY rowid").all();
  const rankById = computeRanks(rows);
  res.json(rows.map(r => enrichPlayer(JSON.parse(r.data), rankById, { ungated })));
});

// GET /api/players/search?clubId=123
app.get("/api/players/search", (req, res) => {
  const clubId = parseInt(req.query.clubId, 10);
  if (!clubId) return res.status(400).json({ error: "clubId query parameter required" });
  const rows = db.prepare("SELECT rowid, id, data FROM players ORDER BY rowid").all();
  const rankById = computeRanks(rows);
  const match = rows.map(r => JSON.parse(r.data)).find(p => p.clubId === clubId);
  if (!match) return res.status(404).json({ error: "Not found" });
  res.json(enrichPlayer(match, rankById));
});

// GET single player
app.get("/api/players/:id", (req, res) => {
  const ungated = req.query.ungated === "1"; // admin's own view opts out of 7-day trend expiry
  const row = db.prepare("SELECT data FROM players WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  const rows = db.prepare("SELECT rowid, id, data FROM players ORDER BY rowid").all();
  const rankById = computeRanks(rows);
  res.json(enrichPlayer(JSON.parse(row.data), rankById, { ungated }));
});

// POST create player
app.post("/api/players", (req, res) => {
  const p = req.body;
  if (!p.id) p.id = "p" + Math.random().toString(36).slice(2, 9);
  if (!p.clubId) p.clubId = generateClubId();
  if (!p.name) p.name = [p.lastName, p.firstName].filter(Boolean).join(" ").trim() || "—";
  if (!p.status) p.status = 'Newcomer';
  if (!p.registeredAt) p.registeredAt = Date.now();
  stampRatingChange({}, p); // a new rated player → "up" trend + fresh timestamp

  // A new rated player has no prior rank (no arrow of their own) but displaces
  // exactly one player down a slot; only that boundary neighbour shows -1.
  applyRankDiff(() => {
    db.prepare("INSERT OR REPLACE INTO players (id, data) VALUES (?, ?)").run(p.id, JSON.stringify(p));
  }, { movers: [p.id] });
  res.json(p);
});

// PUT update player (upsert — also handles new players with a pre-assigned id)
app.put("/api/players/:id", (req, res) => {
  const row = db.prepare("SELECT data FROM players WHERE id = ?").get(req.params.id);
  const existing = row ? JSON.parse(row.data) : {};

  const updated = Object.assign({}, existing, req.body, { id: req.params.id });
  if (!updated.name) updated.name = [updated.lastName, updated.firstName].filter(Boolean).join(" ").trim() || "—";
  const ratingChanged = stampRatingChange(existing, updated); // sets trend + ratingChangedAt

  // Only the edited player (mover) and the single player they displace show a
  // rank delta; the cascade in between is suppressed. No rating change → no
  // movers → nobody's baseline touched.
  applyRankDiff(() => {
    // UPSERT preserves rowid for existing players (updates in place); only a
    // brand-new pre-assigned id creates a fresh rowid.
    db.prepare("INSERT INTO players (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(req.params.id, JSON.stringify(updated));
  }, { movers: ratingChanged ? [req.params.id] : [] });

  // Re-read: applyRankDiff may have written a fresh rankBefore for this player.
  const saved = db.prepare("SELECT data FROM players WHERE id = ?").get(req.params.id);
  res.json(JSON.parse(saved.data));
});

// Reset rankBefore baseline to the player's current live rank so the next
// rank change is measured from "now" rather than the last tournament finish.
app.post("/api/players/:id/recalculate-rank", (req, res) => {
  const row = db.prepare("SELECT data FROM players WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Player not found" });

  const rows = db.prepare("SELECT rowid, id, data FROM players ORDER BY rowid").all();
  const rankById = computeRanks(rows);
  const currentRank = rankById[req.params.id] || null;

  const player = JSON.parse(row.data);
  const updated = Object.assign({}, player, { rankBefore: currentRank });
  db.prepare("UPDATE players SET data = ? WHERE id = ?").run(JSON.stringify(updated), req.params.id);
  res.json({ ok: true, rankBefore: currentRank });
});

// DELETE player
app.delete("/api/players/:id", (req, res) => {
  // Removing a player lets exactly one player rise into the vacated slot; only
  // that boundary neighbour shows +1, not the whole cascade below.
  applyRankDiff(() => {
    db.prepare("DELETE FROM players WHERE id = ?").run(req.params.id);
  }, { movers: [req.params.id] });
  res.json({ ok: true });
});

// POST /api/players/batch — apply many player updates atomically (tournament
// finish). Committing every rating change together means the rank-delta
// baseline is diffed exactly once, pre- vs post-tournament, for every player
// whose rank moved — impossible with the old per-player PUT loop.
app.post("/api/players/batch", (req, res) => {
  const updates = Array.isArray(req.body.players) ? req.body.players : [];
  const getStmt = db.prepare("SELECT data FROM players WHERE id = ?");
  // UPDATE (existing players only) to preserve rowid / join order.
  const saveStmt = db.prepare("UPDATE players SET data = ? WHERE id = ?");

  // Only players whose rating actually changed count as movers; each shows its
  // real delta. Non-participants merely shifted by the cascade show nothing.
  // Overlapping shift-ranges make a single boundary neighbour undefined here, so
  // boundaryNeighbour is off.
  const movers = [];
  applyRankDiff(() => {
    for (const incoming of updates) {
      if (!incoming || !incoming.id) continue;
      const row = getStmt.get(incoming.id);
      if (!row) continue;
      const existing = JSON.parse(row.data);
      const merged = Object.assign({}, existing, incoming, { id: incoming.id });
      // Never let client-sent computed/derived fields pollute the stored blob.
      delete merged.rank; delete merged.rankChange; delete merged.age;
      delete merged.matches; delete merged.winRate;
      delete merged.rightRubber; delete merged.leftRubber;
      const ratingBefore = typeof incoming.ratingBefore === 'number' ? incoming.ratingBefore : undefined;
      delete merged.ratingBefore;
      if (stampRatingChange(existing, merged, { ratingBefore })) movers.push(incoming.id);
      // Auto-transition: Newcomer → Regular once a player reaches 5 tournaments.
      // Fires on both first-publish and republish paths (idempotent — Regular stays Regular).
      // Never touches Archive — that's a manual GM setting.
      if (merged.status === 'Newcomer' && (merged.tournaments || 0) >= 5) merged.status = 'Regular';
      saveStmt.run(JSON.stringify(merged), incoming.id);
    }
  }, { movers, boundaryNeighbour: false });

  const rows = readPlayerRows();
  const rankById = computeRanks(rows);
  res.json(rows.map(r => enrichPlayer(JSON.parse(r.data), rankById)));
});

// ── Tournaments API ─────────────────────────────────────────

// Classifies a tournament into one of the three public categories based on
// its bracket format. "elimination"/anything else is reserved for the
// upcoming 32-player League Masters bracket, not implemented in the admin
// UI yet.
function tournamentCategory(format) {
  if (format === "groups") return "League Cup";
  if (format === "elimination") return "League Masters"; // not implemented in admin UI yet
  return "League Series"; // roundrobin, or missing/legacy format (tournament.html's own default is "roundrobin")
}

// Adds public-facing computed fields to a tournament object without
// removing the original admin fields.
function enrichTournament(t) {
  const capacity = t.players || 0;
  const filled = typeof t.filledPlayers === "number" ? t.filledPlayers : null;
  return Object.assign({}, t, {
    category: ['League Series', 'League Cup', 'League Masters'].includes(t.category) ? t.category : tournamentCategory(t.format),
    publicStatus: t.status === "done" ? "completed" : "scheduled",
    capacity: capacity,
    filledPlayers: filled,
    freeSlots: filled != null ? Math.max(0, capacity - filled) : null,
  });
}

// GET all tournaments
app.get("/api/tournaments", (req, res) => {
  const rows = db.prepare("SELECT data FROM tournaments ORDER BY rowid DESC").all();
  res.json(rows.map(r => enrichTournament(JSON.parse(r.data))));
});

// GET single tournament
app.get("/api/tournaments/:id", (req, res) => {
  const row = db.prepare("SELECT data FROM tournaments WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(enrichTournament(JSON.parse(row.data)));
});

// POST create tournament
app.post("/api/tournaments", (req, res) => {
  const t = req.body;
  if (!t.id) t.id = "t" + Date.now();
  db.prepare("INSERT OR REPLACE INTO tournaments (id, data) VALUES (?, ?)").run(t.id, JSON.stringify(t));
  res.json(t);
});

// PUT update tournament
app.put("/api/tournaments/:id", (req, res) => {
  const row = db.prepare("SELECT data FROM tournaments WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  const updated = Object.assign({}, JSON.parse(row.data), req.body, { id: req.params.id });
  db.prepare("UPDATE tournaments SET data = ? WHERE id = ?").run(JSON.stringify(updated), req.params.id);
  res.json(updated);
});

// DELETE tournament + roll back player stats.
// New path (appliedStats present): subtract this tournament's ledger contributions from current
// values. Does NOT touch rating/trend — those are out of scope for this rollback.
// Legacy fallback (preStats only, no appliedStats): full-replace snapshot restore, old behavior.
// Gate: if neither ledger exists (pre-feature tournament), no stats rollback is attempted.
app.delete("/api/tournaments/:id", (req, res) => {
  const id = req.params.id;
  const stateRow = db.prepare("SELECT data FROM tournament_state WHERE tournament_id = ?").get(id);
  if (stateRow) {
    try {
      const state = JSON.parse(stateRow.data);
      if (state.appliedStats && typeof state.appliedStats === "object") {
        const getStmt = db.prepare("SELECT data FROM players WHERE id = ?");
        const saveStmt = db.prepare("UPDATE players SET data = ? WHERE id = ?");
        db.transaction(() => {
          for (const [playerId, ledger] of Object.entries(state.appliedStats)) {
            const playerRow = getStmt.get(playerId);
            if (!playerRow) continue;
            const player = JSON.parse(playerRow.data);
            const clamp = (cur, sub, field) => {
              const result = (cur || 0) - (sub || 0);
              if (result < 0) console.warn(`[delete] stats underflow for player ${playerId} field ${field}: ${cur} - ${sub} = ${result}, clamping to 0`);
              return Math.max(0, result);
            };
            saveStmt.run(JSON.stringify(Object.assign({}, player, {
              won:         clamp(player.won,         ledger.won,         'won'),
              lost:        clamp(player.lost,        ledger.lost,        'lost'),
              setsWon:     clamp(player.setsWon,     ledger.setsWon,     'setsWon'),
              setsLost:    clamp(player.setsLost,    ledger.setsLost,    'setsLost'),
              tournaments: clamp(player.tournaments, ledger.tournaments, 'tournaments'),
            })), playerId);
          }
        })();
      } else if (state.preStats && typeof state.preStats === "object") {
        // Legacy fallback for pre-ledger rows: full-replace snapshot (existing behavior, unchanged).
        const updatePlayer = db.prepare("UPDATE players SET data = ? WHERE id = ?");
        db.transaction(() => {
          for (const [playerId, pre] of Object.entries(state.preStats)) {
            const playerRow = db.prepare("SELECT data FROM players WHERE id = ?").get(playerId);
            if (!playerRow) continue;
            const player = JSON.parse(playerRow.data);
            updatePlayer.run(JSON.stringify(Object.assign({}, player, {
              rating: pre.rating, trend: pre.trend,
              won: pre.won, lost: pre.lost, tournaments: pre.tournaments,
            })), playerId);
          }
        })();
      }
    } catch (e) {
      console.error("Error restoring player stats:", e);
    }
  }
  db.prepare("DELETE FROM tournaments WHERE id = ?").run(id);
  db.prepare("DELETE FROM tournament_state WHERE tournament_id = ?").run(id);
  res.json({ ok: true });
});

// ── Tournament State API (results, bracket, settings) ───────

// GET state
app.get("/api/tournament-state/:id", (req, res) => {
  const row = db.prepare("SELECT data FROM tournament_state WHERE tournament_id = ?").get(req.params.id);
  if (!row) return res.json({});
  res.json(JSON.parse(row.data));
});

// PUT save state
app.put("/api/tournament-state/:id", (req, res) => {
  const data = JSON.stringify(req.body);
  db.prepare("INSERT OR REPLACE INTO tournament_state (tournament_id, data) VALUES (?, ?)").run(req.params.id, data);
  res.json({ ok: true });
});

// GET /api/tournaments/:id/roster — the "Tournament Players" table for the
// public Tournament Detail page: slot order (# = join order), joined with
// each player's CURRENT live stats (rank/winRate/rating), not a snapshot.
// Empty (unfilled) slots come back as { seat, empty: true } with no stats.
app.get("/api/tournaments/:id/roster", (req, res) => {
  const stateRow = db.prepare("SELECT data FROM tournament_state WHERE tournament_id = ?").get(req.params.id);
  if (!stateRow) return res.json([]);

  let state;
  try { state = JSON.parse(stateRow.data); } catch (e) { return res.json([]); }
  // Normalise both save shapes into { fromId } entries.
  // Old shape: state.players[i] = { fromId, name, ... }
  // New shape: state.slots[i]   = { player: { fromId, ... }, fee }
  let rawSlots;
  if (Array.isArray(state.players)) {
    rawSlots = state.players;
  } else if (Array.isArray(state.slots)) {
    rawSlots = state.slots.map(s => (s && s.player ? { fromId: s.player.fromId } : null));
  } else {
    rawSlots = [];
  }
  const count = typeof state.playerCount === 'number' ? state.playerCount : rawSlots.length;
  const slots = rawSlots.slice(0, count);

  const rows = db.prepare("SELECT rowid, id, data FROM players ORDER BY rowid").all();
  const rankById = computeRanks(rows);
  const playersById = {};
  rows.forEach(r => { playersById[r.id] = JSON.parse(r.data); });

  const roster = slots.map((slot, i) => {
    if (!slot || !slot.fromId || !playersById[slot.fromId]) {
      return { seat: i + 1, empty: true };
    }
    const enriched = enrichPlayer(playersById[slot.fromId], rankById);
    return {
      seat: i + 1,
      empty: false,
      id: enriched.id,
      name: enriched.name,
      tournaments: enriched.tournaments || 0,
      winRate: enriched.winRate,
      rank: enriched.rank,
      rating: enriched.rating,
    };
  });

  res.json(roster);
});

// ── Fallback → redirect to players ─────────────────────────
app.get("/", (req, res) => {
  res.redirect("/players.html");
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
