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
  checkModel,
  combineEvals,
  evaluateDraft,
  fitMockDraft,
  profilesBySeason,
  type EvalResult,
} from "../src/engine/draftFit";
import { buildAdpLookup, type AdpHistory, type DraftHistory } from "../src/engine/draftProfiles";
import { DEFAULT_MOCK_PARAMS, type MockParams } from "../src/engine/mockDraft";

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

  // --- Fit ---
  console.log("Fitting the full model...");
  const full = fitMockDraft(history, fitSeasons, adp, { iterations: 6 });
  for (const line of full.trace) console.log("  " + line);
  console.log("");
  console.log("Fitted parameters:");
  printParams(full.params);
  console.log("");

  console.log("Fitting the rank-only baseline (beta = lambda = gamma = alpha = 0, tau refit)...");
  const baseline = fitMockDraft(history, fitSeasons, adp, { rankOnly: true, iterations: 6 });
  printParams(baseline.params);
  console.log("");

  // --- Test on the held-out season ---
  const testProfiles = profilesBySeason(history, [TEST_SEASON], adp)[TEST_SEASON] || {};

  const fullTest = evaluateDraft(history, TEST_SEASON, adpLookup, testProfiles, full.params);
  const baselineTest = evaluateDraft(
    history,
    TEST_SEASON,
    adpLookup,
    testProfiles,
    baseline.params,
  );
  const shippedTest = checkModel(history, TEST_SEASON, adp, DEFAULT_MOCK_PARAMS);

  console.log("=".repeat(78));
  console.log("IN-SAMPLE (" + fitSeasons.join(", ") + ")");
  console.log(reportLine("full model", full.fitEval));
  console.log(reportLine("rank-only baseline", baseline.fitEval));
  console.log("");
  console.log("HELD OUT (" + TEST_SEASON + ")");
  console.log(reportLine("full model, fitted", fullTest));
  console.log(reportLine("rank-only, fitted", baselineTest));
  console.log(reportLine("shipped defaults", shippedTest.full));
  console.log(reportLine("shipped, rank-only", shippedTest.baseline));
  console.log("");

  // --- Which components actually earned their weight ---
  console.log("COMPONENT ABLATION on " + TEST_SEASON + " (each term zeroed in turn)");
  const terms: Array<keyof MockParams> = ["beta", "lambda", "gamma", "alpha"];
  const dead: string[] = [];
  for (const term of terms) {
    const ablated: MockParams = { ...full.params, [term]: 0 };
    const result = evaluateDraft(history, TEST_SEASON, adpLookup, testProfiles, ablated);
    const delta = fullTest.meanLogLik - result.meanLogLik;
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
        dead.join(", "),
    );
    console.log("");
  }

  const pass = fullTest.meanLogLik > baselineTest.meanLogLik;
  console.log("=".repeat(78));
  console.log(
    "  GATE: full model beats rank-only on " + TEST_SEASON + "   " +
      (pass ? "PASS" : "FAIL") +
      "  (" + fmt(fullTest.meanLogLik) + " vs " + fmt(baselineTest.meanLogLik) + ")",
  );
  console.log("=".repeat(78));
  console.log("");
  console.log("To ship these, copy the fitted parameters into src/engine/constants.ts,");
  console.log("set MOCK_FITTED to true, and record these numbers in the comment there.");

  if (!pass) process.exit(1);
}

if (require.main === module) {
  main();
}

export { combineEvals };
