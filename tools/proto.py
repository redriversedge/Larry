"""Prototype of the new Larry ranking, tested against FantasyPros expert consensus.

Reads the Larry snapshot (player stats only) and ecr.txt. Run with:
    python3 -I proto.py <snapshot.json> <ecr.txt>
"""
import json, re, sys, unicodedata, math

CATS = ["REB", "AST", "STL", "BLK", "PTS"]
SNAP, ECR = sys.argv[1], sys.argv[2]


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


def build(players, qpool=True, shrink_k=0, cap=None, out_hair=1.0, gtd_hair=1.0,
          roster=13, mult=12, iters=2, min_gp_pool=10):
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
    for r in rows:
        pg = dict(r["pg"])
        if shrink_k and r["gp"] < 82:
            w = r["gp"] / (r["gp"] + shrink_k)
            # Blend observed production toward the player's own projection,
            # falling back to the pool mean when there is no projection.
            prior = r["prior"]
            for c in CATS:
                p_c = prior[c] if prior else stats[c][0]
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


if __name__ == "__main__":
    # Explicit utf-8: player names carry accents (Jokic, Doncic, Porzingis),
    # and on Windows the default is cp1252, which fails on them.
    snap = json.load(open(SNAP, encoding="utf-8"))
    players = snap["allPlayers"]
    with open(ECR, encoding="utf-8") as fh:
        ecr = [(norm(l.split("|")[1].strip()), int(l.split("|")[0])) for l in fh if l.strip()]
    legacy = {norm(p["name"]): p["durantRank"] for p in players}
    evaluate("V0 legacy DURANT (as shipped)", legacy, ecr)
    cfgs = [
        ("V1 per-game z, all-player pool", dict(qpool=False)),
        ("V2 + starter-quality (Q) pool", dict(qpool=True)),
        ("V3 + shrink low-GP samples (k=8)", dict(qpool=True, shrink_k=8)),
        ("V4 + cap category z at 3.0", dict(qpool=True, shrink_k=8, cap=3.0)),
        ("V5 + OUT haircut 0.85", dict(qpool=True, shrink_k=8, cap=3.0, out_hair=0.85, gtd_hair=0.95)),
        ("V5b OUT haircut 0.70", dict(qpool=True, shrink_k=8, cap=3.0, out_hair=0.70, gtd_hair=0.95)),
        ("V5c no injury haircut", dict(qpool=True, shrink_k=8, cap=3.0)),
    ]
    for label, kw in cfgs:
        evaluate(label, {n: r["rank"] for n, r in build(players, **kw).items()}, ecr)
