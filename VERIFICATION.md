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
