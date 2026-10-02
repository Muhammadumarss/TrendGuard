# Prediction and production-readiness review — 26 September 2026

## Decision

**Not approved for real-money production.** The code is a more defensive paper research system after the fixes below, but neither a profitable predictive edge nor exchange-execution reliability has been established. Passing unit/integration tests is evidence about tested behavior, not an uptime guarantee or a prediction of returns.

The scope included features, labels, boosted-stump fitting, chronological tuning/calibration/holdout splits, scoring, economic evidence, regime selection, publication, entry decisions, backtesting, persistence, jobs, API reporting and market-data failures. Existing staged and working-tree work was preserved. This review did not enable real execution, lower the 0.60 threshold, increase model complexity or optimize historical returns.

## Additional confirmed weaknesses and fixes

| Weakness | Trading consequence | Correction and regression coverage |
|---|---|---|
| Infinite/invalid calibration parameters could saturate sigmoid output | Malformed artifacts could look highly confident | Validate finite/ranged calibration, tree parameters, learning rate and training inputs; invalid scores fail closed |
| Readiness trusted a saved passed flag | Missing/contradictory validation details could authorize entries | Require nonzero valid trees, fitted calibration, coherent Brier evidence, feature envelope and supported economic evidence |
| Profitability evidence ignored spread/drift eligibility | Reported payoff evidence could include trades the actual decision rules would refuse | Labels now record execution eligibility; economic evidence includes only executable, supported-feature candidates |
| Model could extrapolate outside observed features | Unknown market conditions could receive an apparently usable score | Record per-feature min/max from fitting data only; entry rejects values outside that empirical envelope |
| Broad regime evidence could justify unsupported scores | A score much higher than any tested score could inherit a payoff claim | Record selected-score min/max per regime; reject entries outside that observed score range |
| Undefined previous volume was replaced with 1 | Relative-volume feature acquired arbitrary meaning | Zero historical mean volume yields an unsupported feature and no entry |
| Invalid candle metadata could bypass comparisons with NaN | Corrupt signal rows could bypass timing/feature assumptions | Validate signal grid, timestamps, numeric inputs and feature shape before deciding |
| Concurrent older training could overwrite newer model | Effective rollback of model/data freshness | Atomic publication rejects older training/data timestamps and derives identity from content |
| Insufficient training classes were treated as an infrastructure exception | Old models could remain eligible and retries repeated hourly | Publish an explicit rejected model for insufficient training coverage; block entries and use normal retraining cadence |
| First-symbol failure aborted second-symbol training | A BTC outage could prevent ETH refreshing | Train each symbol independently, retain per-symbol failures and report aggregate job failure after both attempts |
| Old backtest could appear current after changing code/config | Dashboard could present results from different trading assumptions | Verify source/config provenance before serving results; reject stale reports; publish JSON by temporary-file rename |
| Data API retried 429/418 without honoring cooldown | Repeated requests could worsen rate limits or cause bans | Respect Retry-After, default conservatively when absent, block other endpoints and pending retries during cooldown |

Regression tests deliberately use explicitly synthetic accepted-model fixtures to exercise execution. They do not fabricate real-market acceptance. Existing tests for financial conservation, locks, persistence, chronological separation, feature parity and stop/target ambiguity remain in place.

## Prediction logic assessment

The model predicts **TP before stop/expiry for a hypothetical next-open long**. It does not forecast a specific price, all profitable closes, or shorts. Its fixed target and six-hour horizon are strategy assumptions, not outputs of the model. Timeout gains/losses are kept separately for economic evaluation.

The chronological fitting/tuning/calibration/evaluation separation and horizon purging are sound protections against direct boundary leakage. Final holdout perturbation tests preserve fitted trees, calibration and feature-domain bounds. Calibration data must be separate from fitting data; this is consistent with the [scikit-learn calibration guidance](https://scikit-learn.org/stable/modules/generated/sklearn.calibration.CalibratedClassifierCV).

Important limits remain:

- Brier improvements and bootstrap bounds are historical diagnostics. Six-hour overlapping labels, longer dependence and regime shifts can make uncertainty estimates optimistic.
- Independent chronological calibration does not ensure stable probabilities in a later market. No claim of 60% real winning probability follows from a 0.60 score.
- Global holdout quality does not establish economic edge. Current selected-region support is insufficient. Payoff evidence is an approximation with non-overlapping hypothetical examples, not a full exchange portfolio simulation.
- Empirical min/max guards prevent some extrapolation; they are not a complete multivariate distribution-shift detector. They can reject legitimate new market conditions and reduce trading frequency.
- Score bounds do not prove calibration inside the range or sufficient density at every point. More later observations and score-local diagnostics remain necessary.
- Fixed 60-day data, EMA/breakout conditions and fixed barriers have not demonstrated robustness across full market cycles. No additional indicators are justified solely because current models fail.
- Repeated research against these historical periods creates selection risk even when the code itself has no future-price leakage. Genuine prospective validation is still required.

## Validation performed

All **65 tests pass**, including focused cases for malformed calibration, unsupported inputs/scores, dishonest acceptance metadata, malformed rows, zero volume, label eligibility, immutable publication, partial job failure, stale reports, API cooldown and concurrent retries. The offline evaluation scripts train without publishing research artifacts or changing the active account.

Two datasets are retained separately:

1. The original frozen audit sample, used for a paired comparison on identical timestamps/labels. This review's defensive changes preserve the previously measured BTC Brier 0.045391 and ETH Brier 0.095518 on that sample. Both remain blocked. The original before-implementation comparison is 0.049471 and 0.103606 respectively; those earlier improvements are not attributed to this review.
2. A newer snapshot of the locally downloaded 90-day history. A complete 60-day warmup permits roughly 30 days of chronological replay. Latest model details, all fold diagnostics, normal/stress metrics and provenance are written to production-review/summary.json and production-review/backtest.json. This remains historical data, not a prospective test.

The JSON artifacts are the authoritative numerical records; undefined trading statistics remain null when no trades exist. No historical profit is invented to demonstrate a fix.

Latest offline models, data through 25 September 2026 18:44:59.999 UTC:

| Metric | BTCUSDT | ETHUSDT |
|---|---:|---:|
| Holdout observations | 1,088 | 1,088 |
| Trees selected | 22 | 2 |
| Brier | 0.045360 | 0.097638 |
| Constant baseline Brier | 0.045528 | 0.094362 |
| Holdout rows outside fitting feature envelope | 1 | 40 |
| Supported selected economic examples | 0 | 0 |
| Acceptance | Rejected: improvement uncertain | Rejected: improvement absent/uncertain |

BTC's small numerical improvement is insufficient evidence of predictive value. ETH is worse than the baseline. Both remain unsuitable for authorizing real trading. The longer replay also exposed periods with zero positive examples in the earlier BTC fitting segment; absence of class coverage must be treated as insufficient evidence, not overcome by silently reusing a prior accepted model.

## What real-money production still requires

| Missing capability/evidence | Required acceptance before live use |
|---|---|
| Predictive/economic edge | Frozen-policy forward observations with adequate independent selected trades, costs, payoff uncertainty and adverse-regime coverage; no parameter changes against the final test |
| Authenticated execution adapter | Correct exchange tick/lot/min-notional filters, actual fees, quantities and precision; testnet contract tests before any funded use |
| Order lifecycle and recovery | Durable intent/client-order IDs, partial-fill/cancel handling, account/order reconciliation and restart recovery; unresolved orders block new exposure |
| Unknown execution status | Query order state and reconcile after timeouts instead of blindly resubmitting; Binance documents that a timeout/5xx can leave execution status unknown |
| Protective orders | Exchange-supported protective order handling, with verified behavior after disconnect/restart; polling a local quote every 15 seconds is insufficient protection |
| Quote/path realism | Timestamped bid/ask/depth replay, latency/spread/partial-fill scenarios and attribution of simulated-versus-observed fills |
| Operational service reliability | Supervised deployment, external health alerts, backup/restore drills, clock monitoring, fault-injection/soak tests, disk limits and an operator kill switch |
| Aggregate request management | IP-wide request-weight budgeting across worker/process instances; the new cooldown is per requester/runtime and is not a fleet-wide limiter |
| Long-running storage behavior | Benchmark and complete normalized account/risk-summary migration, archive retention, and decision-outcome monitoring at production scale |
| Security/deployment | Secret management and least-privilege account permissions; current local dashboard access controls are not public-service authentication |

These requirements reflect actual exchange behavior. Binance specifies [symbol quantity/price/notional filters](https://github.com/binance/binance-spot-api-docs/blob/master/filters.md), [unknown execution status and rate-limit handling](https://developers.binance.com/en/docs/products/spot/rest-api), and [user-data order/account events](https://developers.binance.com/en/docs/products/spot/user-data-stream). No live adapter or keys were added in this review.

## Activation and tradeoffs

Restart the local server and retrain before judging current eligibility. The validation-policy signature changed, so earlier model artifacts are intentionally ineligible. The dashboard also requires a newly generated backtest after source/config changes. Existing account cash, positions and trade history were not reset.

The stronger guards may leave the system inactive longer. That is acceptable while evidence is missing. More trees, a lower entry threshold or weaker validation would not demonstrate production readiness. The next decision should be based on measured forward behavior and execution reliability, not on forcing the dashboard to show trades.

## Completed final replay

The final frozen 90-day snapshot supports evaluation from **2026-08-26 18:45 UTC to 2026-09-25 18:44:59.999 UTC**. Both normal and doubled-cost runs completed. The normal run performed **120 scheduled model fits with zero uncaught training failures**, including 19 explicit insufficient-coverage rejections. Before the coverage correction, the same snapshot caused 329 attempts and 228 class-coverage exceptions. This is an operational correction, not a trading-return improvement.

Both completed replays produced **zero trades and zero P&L**. Final model gates remain rejected and there are no selected economic examples. The final source/config hashes match the saved summary. All 65 tests passed, and the source diff/syntax checks completed. Paper-account inspection still shows 1,000 USDT, no open position and no closed trades. No research model was published into that account.
