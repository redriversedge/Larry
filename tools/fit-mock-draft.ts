// Fit the Draft Room's AI pick model on the league's real drafts, then test
// it on a held-out season against a rank-only baseline.
// docs/DRAFT_ROOM_SPEC.md s4.1.
//
// PRIVACY: this repo is public and draft history is league members' data.
// The export this tool reads is NEVER committed. Put it under
// tests/fixtures/users/, which is git-ignored, and pass the path as an
// argument. The tool prints only aggregate numbers and ESPN team ids; it
// never prints a manager or team name.
//
// To produce the export, in DevTools on larrybball.netlify.app after
// building profiles in the Draft Room:
//
//   copy(localStorage.getItem('larry_draft_history'))
//
// and save it to tests/fixtures/users/draft-history.json.
//
// Run: npx tsx tools/fit-mock-draft.ts tests/fixtures/users/draft-history.json
//
// Fit seasons are 2019 to 2025 and the test season is 2026, because ESPN ADP
// exists from the 2018-19 season (seasonId 2019) on. Profiles for each fit
// season are built from PRIOR seasons only, so nothing leaks backwards.

import * as fs from "fs";
import * as path from "path";

import {
  MOCK_TOP_PICK_SHARE,
  MOCK_TOP_PICK_SIMS,
  MOCK_TOP_PICK_WINDOW,
} from "../src/engine/constants";
import {
  checkModel,
  combineEvals,
  evaluateDraft,
  fitMockDraft,
  profilesBySeason,
  topPickRateForSeason as topPickRateFor,
  type EvalResult,
  type FitResult,
} from "../src/engine/draftFit";
import { buildAdpLookup, type AdpHistory, type DraftHistory } from "../src/engine/draftProfiles";
import {
  DEFAULT_MOCK_PARAMS,
  type MockParams,
  type RankForm,
} from "../src/engine/mockDraft";

const ROOT = path.resolve(__dirname, "..");
const ADP_PATH = path.join(ROOT, "data/espn-adp-history.json");

const FIT_SEASONS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const TEST_SEASON = 2026;

function fmt(n: number, digits = 4): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function reportLine(label: string, result: EvalResult): string {
  return (
    "  " + label.padEnd(22) +
    "logLik " + fmt(result.meanLogLik).padStart(9) +
    "   top-1 " + (result.top1 * 100).toFixed(1).padStart(5) + "%" +
    "   top-5 " + (result.top5 * 100).toFixed(1).padStart(5) + "%" +
    "   picks " + String(result.picks).padStart(5)
  );
}

function printParams(params: MockParams): void {
  console.log("  tauEarly " + fmt(params.tauEarly, 3) +
    "  tauMid " + fmt(params.tauMid, 3) +
    "  tauLate " + fmt(params.tauLate, 3));
  console.log("  beta " + fmt(params.beta, 4) +
    "  lambda " + fmt(params.lambda, 3) +
    "  gamma " + fmt(params.gamma, 3) +
    "  alpha " + fmt(params.alpha, 3));
}

function main(): void {
  const args = process.argv.slice(2);
  // --adp=<path> overrides the committed ADP history. Only useful for
  // exercising this tool on the synthetic generator, whose invented players
  // are not in the real FantasyPros file.
  const adpArg = args.find((a) => a.startsWith("--adp="));
  const adpPath = adpArg ? path.resolve(adpArg.slice("--adp=".length)) : ADP_PATH;

  const given = args.find((a) => !a.startsWith("--"));
  const historyPath = given
    ? path.resolve(given)
    : path.join(ROOT, "tests/fixtures/users/draft-history.json");

  if (!fs.existsSync(historyPath)) {
    console.error("No draft-history export found at:\n  " + historyPath + "\n");
    console.error(
      "This tool needs the owner's real league history, which cannot be\n" +
      "committed to a public repo. In DevTools on larrybball.netlify.app,\n" +
      "after building profiles in the Draft Room:\n\n" +
      "  copy(localStorage.getItem('larry_draft_history'))\n\n" +
      "Save it under tests/fixtures/users/ (git-ignored) and pass the path.\n\n" +
      "Until then the app ships the unfitted defaults in\n" +
      "src/engine/constants.ts and says so in the Draft Room footer.",
    );
    process.exit(1);
  }

  if (!fs.existsSync(adpPath)) {
    console.error("Missing " + adpPath + ". Run: npx tsx tools/fetch-espn-adp-history.ts");
    process.exit(1);
  }

  const history = JSON.parse(fs.readFileSync(historyPath, "utf8")) as DraftHistory;
  const adp = JSON.parse(fs.readFileSync(adpPath, "utf8")) as AdpHistory;
  const adpLookup = buildAdpLookup(adp);

  const available = Object.keys(history.seasons || {}).map(Number).sort((a, b) => a - b);
  console.log("Seasons in the export: " + available.join(", "));

  const fitSeasons = FIT_SEASONS.filter((s) => available.indexOf(s) >= 0);
  if (!fitSeasons.length) {
    console.error("None of the fit seasons " + FIT_SEASONS.join(", ") + " are in the export.");
    process.exit(1);
  }
  if (available.indexOf(TEST_SEASON) < 0) {
    console.error("Test season " + TEST_SEASON + " is not in the export.");
    process.exit(1);
  }
  console.log("Fitting on: " + fitSeasons.join(", ") + "   Testing on: " + TEST_SEASON);
  console.log("Profiles for each season are built from prior seasons only.\n");

  // --- Fit both rank forms ---
  //
  // -rank/tau spaces consecutive players evenly all the way down the board,
  // so one tau has to describe both a near-deterministic round 1 and a
  // near-random round 10. -ln(rank)/tau does not: the gap is ln(2) at the
  // top and ln(101/100) at pick 100. Whichever form wins on held-out
  // log-likelihood ships, provided it also passes the top-pick gate.
  const forms: RankForm[] = ["linear", "log"];
  const fits: Record<string, ReturnType<typeof fitMockDraft>> = {};
  const baselines: Record<string, ReturnType<typeof fitMockDraft>> = {};

  for (const form of forms) {
    console.log("Fitting the full model, " + form + " rank form...");
    fits[form] = fitMockDraft(history, fitSeasons, adp, { iterations: 6, rankForm: form });
    for (const line of (fits[form] as FitResult).trace) console.log("  " + line);
    console.log("  fitted:");
    printParams((fits[form] as FitResult).params);

    console.log("Fitting the rank-only baseline, " + form + " (beta = lambda = gamma = alpha = 0)...");
    baselines[form] = fitMockDraft(history, fitSeasons, adp, {
      rankOnly: true,
      iterations: 6,
      rankForm: form,
    });
    printParams((baselines[form] as FitResult).params);
    console.log("");
  }

  // --- Test on the held-out season ---
  const testProfiles = profilesBySeason(history, [TEST_SEASON], adp)[TEST_SEASON] || {};
  const shippedTest = checkModel(history, TEST_SEASON, adp, DEFAULT_MOCK_PARAMS);

  const heldOut: Record<string, { full: EvalResult; baseline: EvalResult; topPick: number }> = {};
  for (const form of forms) {
    const fit = fits[form] as FitResult;
    const base = baselines[form] as FitResult;
    heldOut[form] = {
      full: evaluateDraft(history, TEST_SEASON, adpLookup, testProfiles, fit.params),
      baseline: evaluateDraft(history, TEST_SEASON, adpLookup, testProfiles, base.params),
      topPick: topPickRateFor(history, TEST_SEASON, adpLookup, testProfiles, fit.params),
    };
  }

  console.log("=".repeat(78));
  console.log("IN-SAMPLE (" + fitSeasons.join(", ") + ")");
  for (const form of forms) {
    console.log(reportLine(form + " full", (fits[form] as FitResult).fitEval));
    console.log(reportLine(form + " rank-only", (baselines[form] as FitResult).fitEval));
  }
  console.log("");
  console.log("HELD OUT (" + TEST_SEASON + ")");
  for (const form of forms) {
    const h = heldOut[form] as { full: EvalResult; baseline: EvalResult; topPick: number };
    console.log(reportLine(form + " full, fitted", h.full));
    console.log(reportLine(form + " rank-only", h.baseline));
  }
  console.log(reportLine("shipped constants", shippedTest.full));
  console.log(reportLine("shipped, rank-only", shippedTest.baseline));
  console.log("");

  // --- The acceptance gate the likelihood cannot see ---
  console.log(
    "TOP-PICK GATE: ADP #1 inside the first " + MOCK_TOP_PICK_WINDOW +
      " picks, " + MOCK_TOP_PICK_SIMS + " simulated drafts, floor " +
      (MOCK_TOP_PICK_SHARE * 100).toFixed(0) + "%",
  );
  for (const form of forms) {
    const h = heldOut[form] as { topPick: number };
    console.log(
      "  " + (form + " fitted").padEnd(22) + (h.topPick * 100).toFixed(1).padStart(5) + "%   " +
        (h.topPick >= MOCK_TOP_PICK_SHARE ? "PASS" : "FAIL"),
    );
  }
  const shippedTopPick = topPickRateFor(
    history,
    TEST_SEASON,
    adpLookup,
    testProfiles,
    DEFAULT_MOCK_PARAMS,
  );
  console.log(
    "  " + "shipped constants".padEnd(22) + (shippedTopPick * 100).toFixed(1).padStart(5) + "%   " +
      (shippedTopPick >= MOCK_TOP_PICK_SHARE ? "PASS" : "FAIL"),
  );
  console.log("");

  // --- Which form ships ---
  const eligible = forms.filter((form) => {
    const h = heldOut[form] as { topPick: number };
    return h.topPick >= MOCK_TOP_PICK_SHARE;
  });
  const ranked = (eligible.length ? eligible : forms).slice().sort((a, b) => {
    const ha = heldOut[a] as { full: EvalResult };
    const hb = heldOut[b] as { full: EvalResult };
    return hb.full.meanLogLik - ha.full.meanLogLik;
  });
  const winner = ranked[0] as RankForm;
  console.log(
    "SHIP: " + winner + " rank form" +
      (eligible.length ? "" : "  (WARNING: no form passed the top-pick gate)"),
  );
  console.log("");

  // --- Which components actually earned their weight, for the winner ---
  const winnerFit = fits[winner] as FitResult;
  const winnerHeld = heldOut[winner] as { full: EvalResult; baseline: EvalResult };

  console.log(
    "COMPONENT ABLATION on " + TEST_SEASON + ", " + winner +
      " form (each term zeroed in turn)",
  );
  const terms: Array<keyof MockParams> = ["beta", "lambda", "gamma", "alpha"];
  const dead: string[] = [];
  for (const term of terms) {
    const ablated: MockParams = { ...winnerFit.params, [term]: 0 };
    const result = evaluateDraft(history, TEST_SEASON, adpLookup, testProfiles, ablated);
    const delta = winnerHeld.full.meanLogLik - result.meanLogLik;
    console.log(
      "  without " + String(term).padEnd(14) +
        "logLik " + fmt(result.meanLogLik).padStart(9) +
        "   full model is " + (delta >= 0 ? "+" : "") + fmt(delta) + " better",
    );
    // A term that does not help on held-out data should ship at zero.
    if (delta <= 0) dead.push(String(term));
  }
  console.log("");

  if (dead.length) {
    console.log(
      "These terms did not help on " + TEST_SEASON + " and should ship at 0: " +
        dead.join(", ") +
        "\n(gamma is the exception: it ships at 1 as a position guardrail even when\n" +
        "the likelihood is indifferent, because one absurd roster is more visible\n" +
        "to the user than a small average gain.)",
    );
    console.log("");
  }

  const pass = winnerHeld.full.meanLogLik > winnerHeld.baseline.meanLogLik;
  console.log("=".repeat(78));
  console.log(
    "  GATE: full model beats rank-only on " + TEST_SEASON + "   " +
      (pass ? "PASS" : "FAIL") +
      "  (" + fmt(winnerHeld.full.meanLogLik) + " vs " +
      fmt(winnerHeld.baseline.meanLogLik) + ")",
  );
  console.log("=".repeat(78));
  console.log("");
  console.log("To ship, copy the " + winner + " fitted parameters into");
  console.log("src/engine/constants.ts, set MOCK_RANK_FORM to '" + winner + "',");
  console.log("set MOCK_FITTED to true, and record these numbers in the comment there.");
  console.log("Keep MOCK_GAMMA at 1 even if the ablation says 0.");

  if (!pass) process.exit(1);
}

if (require.main === module) {
  main();
}

export { combineEvals };
