# Production-readiness follow-up — 2026-09-26

65 tests pass. Added malformed-artifact, unsupported-input/score, execution-eligibility, monotonic-publication, partial-job-failure, stale-report and rate-limit/concurrency regressions. Prediction logic and normal/stress simulations were rerun offline. See audit-output/PRODUCTION-READINESS-REVIEW.md and audit-output/production-review/summary.json for the current scope and numerical evidence. Earlier dated verification below is retained as historical context.

---

# Current audit-fix verification — 2026-09-25

Node v24.21.0 on Windows. The complete suite now has 50 passing tests covering the original controls plus audit regressions, financial-state validation, feature parity, calibration separation, lifecycle parity, risk budgets, final liquidation and provenance. See audit-output/IMPLEMENTATION-REPORT.md for scope and limitations.

Run npm.cmd test and node verification/evaluate-audit.js. The offline evaluator uses frozen local candles and never publishes models or changes the paper account. Current reconstructed common-target Brier: BTC 0.049471 before / 0.045391 after; ETH 0.103606 before / 0.095518 after. Both models remain blocked by the stronger evidence gates. Normal and stressed repaired replay have zero trades, so there is no profitability evidence.

The repaired replay requires a complete rolling 60-day training window; supplied data permits only September 22–25. Previously reported runs below used older source/assumptions and remain historical evidence only. Exact artifacts, model metadata and config/data/source hashes are retained in audit-output. A genuinely untouched future evaluation and quote-path execution validation are still outstanding.

---

# Verification — JavaScript edition

Checked on 2026-09-21 using Node.js 24.19.0, npm 11.9.0 and Express 5.2.1 on Linux. The Windows launcher is provided but was not executed on a Windows host.

## Automated tests

**22 tests passed.** These exercise actual JavaScript model training, actual SQLite reopening, the Express HTTP server and historical simulation, rather than only testing stubs.

Coverage includes UTC/year-boundary resets, fee-inclusive losses, cross-pair lock enforcement, position sizing, restart persistence, transaction rollback, corrupted/missing account history, next-open triple-barrier labeling, causal features, model serialization, class coverage, chronological purging, stale/invalid models, stale market data, network failure, simultaneous polling, exits while manually paused, downtime reconciliation, local Host/origin/token checks and a synthetic backtest that executes nonzero trades with zero loss-lock violations.

Synthetic results are used only to verify behavior. They are not included as trading performance evidence.

## Real public-market check

The app downloaded 60 days of BTCUSDT and ETHUSDT 15-minute candles from Binance's public market-data API and trained both models. A transient request timeout occurred; bounded retries subsequently completed the download.

| Model | Holdout examples | Brier score | Constant baseline | Result |
|---|---:|---:|---:|---|
| BTCUSDT | 1,107 | 0.048780 | 0.048929 | Narrowly passed |
| ETHUSDT | 1,107 | 0.105261 | 0.099851 | Failed; entries blocked |

Lower Brier score is better. BTC's small improvement does not establish meaningful predictive value, profitability or calibration.

The walk-forward run evaluated 2026-08-31 20:45 UTC through 2026-09-21 20:30 UTC, with three historical training folds. Both the normal-cost and doubled-cost run produced **zero qualifying trades**. This provides **no evidence of profitability**, and the zero loss-lock violations in that market sample are vacuous. Nonzero-trade loss-lock behavior is exercised in the synthetic integration test instead.

Full metadata and results are in `verification/market-check.json`. The ZIP excludes downloaded market data, trained runtime models, account state and node_modules. A fresh installation starts with a clean paper account and trains on current public data.

The automated test suite was rerun on 2026-09-22: all 22 tests passed again. The Express server and dashboard assets were exercised through HTTP integration tests. A browser visual check could not be completed because the browser runtime download was unavailable.

## Remaining limits

Real-money orders are not implemented. Windows execution, exchange fills, partial fills and uninterrupted long-duration operation have not been verified. No claim of profitability or production readiness is made. See README for the difference between quote-polled paper execution and OHLC backtesting, the behavior after downtime, and how to run further validation.
