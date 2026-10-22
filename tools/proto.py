"""Prototype of the new Larry ranking, tested against FantasyPros expert consensus.

Reads the Larry snapshot (player stats only) and an expert list. Run with:
    python3 -I proto.py <snapshot.json> <ecr.txt|baseline.csv>

Also regenerates the parity baseline that tools/rank-v2-vs-experts.ts asserts
the TypeScript engine reproduces. That tool is the acceptance gate, so the
baseline has to come from THIS file rather than from a hand-edited CSV:

    python -I tools/proto.py tests/fixtures/users/rank-v2-parity-snapshot.json \
        tests/fixtures/rank-v2-expert-baseline.csv --csv out.csv

The expert and legacy columns are carried through from the existing baseline
unchanged, because they are inputs rather than outputs: regenerating them from
a fresh expert pull would move the agreement number for reasons that have
nothing to do with the engine.
"""
import json, re, sys, unicodedata, math

CATS = ["REB", "AST", "STL", "BLK", "PTS"]

# Flags are pulled out so the positional arguments keep their places.
_ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SNAP = _ARGS[0] if _ARGS else None
ECR = _ARGS[1] if len(_ARGS) > 1 else None


def norm(n):
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    n = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", n)
    return " ".join(re.sub(r"[^a-z ]", "", n).split())


def per_game(p):
    gp = p.get("gamesPlayed") or 0
    st = p["stats"]["season"]
    if gp > 0:
        return {c: (st.get(c) or 0) / gp for c in CATS}, gp
    return prior_per_game(p) or {c: 0.0 for c in CATS}, 0


def prior_per_game(p):
    """Best guess at a player's per-game rate before we have seen them play.

    This is the shrink target. Shrinking toward the POOL MEAN meant that at
    gp = 0 the weight w is 0, so every player landed exactly on the mean and
    scored 0. Mid-season that reads as "no evidence"; in the preseason every
    player has 0 games, so the whole board was zeros while each player's
    projection sat unused. Returns None when there is no projection, in which
    case the caller falls back to the pool mean.
    """
    stats = p.get("stats") or {}
    ppg = stats.get("projectedPerGame")
    if ppg:
        prior = {c: float(ppg.get(c) or 0) for c in CATS}
        if any(v != 0 for v in prior.values()):
            return prior
    pr = stats.get("projectedSeason") or {}
    if pr:
        prior = {c: float(pr.get(c) or 0) / 82 for c in CATS}
        if any(v != 0 for v in prior.values()):
            return prior
    return None


def mean_std(vals):
    m = sum(vals) / len(vals)
    v = sum((x - m) ** 2 for x in vals) / (len(vals) - 1)
    return m, max(math.sqrt(v), 1e-6)


def zscores(pg, stats, cap=None):
    out = {}
    for c in CATS:
        m, s = stats[c]
        z = (pg[c] - m) / s
        if cap is not None:
            z = max(-cap, min(cap, z))
        out[c] = z
    return out


def replacement_line(rows, stats, cap, pool_size, width=20):
    """Per category, the mean PRIOR of the players just past the last roster spot.

    The prior for a player ESPN has not projected. Shrinking him toward the
    POOL MEAN made one garbage-time appearance worth a top-100 rank: at
    shrink_k = 8 a single game carries 1/9 and the prior 8/9, so whatever he
    did he came out an average starter. Priors rather than the band's own
    observed rates, so the line is stable from opening night. Players with no
    prior are not candidates; they are the rows being measured.
    """
    pri = [r["prior"] for r in rows if r["prior"]]
    if not pri:
        return {c: stats[c][0] for c in CATS}
    ranked = sorted(pri, key=lambda p: -sum(zscores(p, stats, cap).values()))
    start = min(pool_size, max(0, len(ranked) - width))
    band = ranked[start:start + width]
    return {c: sum(p[c] for p in band) / len(band) for c in CATS}


def build(players, qpool=True, shrink_k=0, cap=None, out_hair=1.0, gtd_hair=1.0,
          roster=13, teams=12, mult=12, iters=2, min_gp_pool=10):
    rows = []
    for p in players:
        pg, gp = per_game(p)
        rows.append({"p": p, "pg": pg, "gp": gp, "prior": prior_per_game(p)})
    base = [r for r in rows if r["gp"] >= min_gp_pool]
    # Preseason: nobody has cleared min_gp_pool, so define the pool from
    # priors. A pool of players who have all played 0 games has no spread.
    use_prior_pool = not base
    if use_prior_pool:
        base = rows
        pool_key = lambda r: r["prior"] or r["pg"]
    else:
        pool_key = lambda r: r["pg"]
    stats = {c: mean_std([pool_key(r)[c] for r in base]) for c in CATS}
    if qpool:
        target = roster * mult
        for _ in range(iters):
            ranked = sorted(
                base,
                key=lambda r: -sum(zscores(pool_key(r), stats, cap).values()),
            )[:target]
            stats = {c: mean_std([pool_key(r)[c] for r in ranked]) for c in CATS}
    repl = replacement_line(rows, stats, cap, teams * roster)
    for r in rows:
        pg = dict(r["pg"])
        if shrink_k and r["gp"] < 82:
            w = r["gp"] / (r["gp"] + shrink_k)
            # Blend observed production toward the player's own projection,
            # falling back to the replacement-level line when there is no
            # projection: nobody expects an unprojected player to produce,
            # so the waiver wire is the honest prior.
            prior = r["prior"]
            for c in CATS:
                p_c = prior[c] if prior else repl[c]
                pg[c] = w * pg[c] + (1 - w) * p_c
        z = zscores(pg, stats, cap)
        total = sum(z.values())
        status = r["p"].get("injuryStatus")
        if total > 0:  # haircut only ever reduces positive value
            if status in ("OUT", "SUSPENSION"):
                total *= out_hair
            elif status in ("GTD", "DAY_TO_DAY", "GAME_TIME_DECISION"):
                total *= gtd_hair
        r["score"] = total
    rows.sort(key=lambda r: -r["score"])
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return {norm(r["p"]["name"]): r for r in rows}


def spearman(a, b):
    n = len(a)

    def rk(v):
        o = sorted(range(n), key=lambda i: v[i])
        r = [0] * n
        for pos, i in enumerate(o):
            r[i] = pos + 1
        return r

    x, y = rk(a), rk(b)
    return 1 - 6 * sum((p - q) ** 2 for p, q in zip(x, y)) / (n * (n * n - 1))


def evaluate(label, ranks, ecr):
    m = [(e, ranks[n]) for n, e in ecr if n in ranks]
    ex, my = [e for e, _ in m], [r for _, r in m]
    ov = lambda k: len({n for n, e in ecr if e <= k and n in ranks and ranks[n] <= k})
    print(f"{label:<44} rho={spearman(ex, my):.3f}  top10={ov(10)}/10  top25={ov(25)}/25  top50={ov(50)}/50")


# The configuration the TypeScript engine implements, named once so the
# acceptance baseline and the comparison table below cannot drift apart.
SHIPPED = dict(qpool=True, shrink_k=8, cap=3.0)


def read_expert(path):
    """Expert rank by normalized name, from an ecr.txt or a baseline CSV.

    ecr.txt lines are "rank|name". A CSV is read for its name and
    expert_rank_top150 columns, which is how the committed baseline carries
    the expert list the shipped agreement number was measured against.
    """
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    lines = [l for l in text.splitlines() if l.strip()]
    if path.lower().endswith(".csv"):
        header = [h.strip() for h in lines[0].split(",")]
        i_name, i_rank = header.index("name"), header.index("expert_rank_top150")
        out = []
        for line in lines[1:]:
            f = line.split(",")
            raw = f[i_rank].strip()
            if raw:
                out.append((norm(f[i_name].strip()), int(raw)))
        return out
    return [(norm(l.split("|")[1].strip()), int(l.split("|")[0])) for l in lines]


def fmt_score(x):
    """Four decimals with trailing zeros stripped, as the baseline stores it."""
    s = ("%.4f" % x).rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def write_baseline_csv(players, ecr, dest):
    """Regenerate the parity baseline tools/rank-v2-vs-experts.ts asserts against."""
    expert = dict(ecr)
    rows = sorted(build(players, **SHIPPED).values(), key=lambda r: r["rank"])
    out = ["new_rank,name,team,injury,gp,new_score,legacy_durant_rank,expert_rank_top150"]
    for r in rows:
        p = r["p"]
        e = expert.get(norm(p["name"]))
        out.append(",".join([
            str(r["rank"]), p["name"], p.get("nbaTeam") or "",
            p.get("injuryStatus") or "", str(r["gp"]), fmt_score(r["score"]),
            str(p.get("durantRank") or ""), "" if e is None else str(e),
        ]))
    with open(dest, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out) + "\n")
    print(f"wrote {len(rows)} rows to {dest}")


if __name__ == "__main__":
    # Explicit utf-8: player names carry accents (Jokic, Doncic, Porzingis),
    # and on Windows the default is cp1252, which fails on them.
    snap = json.load(open(SNAP, encoding="utf-8"))
    players = snap["allPlayers"]
    ecr = read_expert(ECR)

    if "--csv" in sys.argv:
        dest = sys.argv[sys.argv.index("--csv") + 1]
        write_baseline_csv(players, ecr, dest)
        sys.exit(0)

    legacy = {norm(p["name"]): p["durantRank"] for p in players}
    evaluate("V0 legacy DURANT (as shipped)", legacy, ecr)
    cfgs = [
        ("V1 per-game z, all-player pool", dict(qpool=False)),
        ("V2 + starter-quality (Q) pool", dict(qpool=True)),
        ("V3 + shrink low-GP samples (k=8)", dict(qpool=True, shrink_k=8)),
        ("V4 + cap category z at 3.0", dict(SHIPPED)),
        ("V5 + OUT haircut 0.85", dict(SHIPPED, out_hair=0.85, gtd_hair=0.95)),
        ("V5b OUT haircut 0.70", dict(SHIPPED, out_hair=0.70, gtd_hair=0.95)),
        ("V5c no injury haircut", dict(SHIPPED)),
    ]
    for label, kw in cfgs:
        evaluate(label, {n: r["rank"] for n, r in build(players, **kw).items()}, ecr)
