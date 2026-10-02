# Implementation checklist (frozen before code changes)

Source: TRADING-SYSTEM-AUDIT.md, all H1–H5, M1–M6 and L1–L2. Existing staged work is preserved. Call paths traced: server -> Engine -> features/predict/decision -> risk/account -> Store; server worker/CLI -> jobs -> market/history -> Store -> training; jobs -> backtest -> features/training/account. Tests exercise the same exported functions. Dashboard consumes status/model/backtest schemas.

| Issue / category | Component | Current behavior / why wrong | Required change / expected result | Validation |
|---|---|---|---|---|
| H1 trading logic/prediction | features, market, signature | Different EMA seeds change identical-timestamp inputs | Fixed causal warmup window in every path; invalidate old models | Prefix/rolling/restart feature equality |
| H2 backtesting | backtest, lifecycle, jobs | Weekly expanding models ignore live expiry | Shared rolling window and 12h cadence, freshness/signature checks, declared completion latency | Replay cadence, expiry, earlier-data assertions |
| H3 critical bug | Engine | Snapshot checks expire before fill | Recheck current quote/candle/model at commit | Delayed two-symbol request and model replacement regressions |
| H4 critical bug/reliability | Store/account | Incomplete schema and no post-mutation validation | Full account/position/trade validation before commit; preserve old valid accounts | Corruption injection/rollback/conservation |
| H5 statistical/model | training/decision | Tiny global Brier gain authorizes unsupported trades | Separate calibration split; block-aware comparison; selected-payoff/regime evidence; explicit TP-first target | Final holdout invariance, empty evidence, reliability/classification metrics |
| M1 risk | risk/Engine/Store | Count lock lacks monetary/week/drawdown guards | Configurable conservative entry budgets; persistent drawdown latch; exits remain active | Large losses, cross-day streak, paused exits, exposure |
| M2 execution/backtesting | shared execution | Historical trade prices omit spread; stress changes policy silently | Explicit bid/ask spread scenario; common barrier ordering; distinguish resimulation and fixed-trade cost stress | Gap, ambiguity, expiry, spread tests |
| M3 performance/backtesting | metrics/backtest | Missing final drawdown and wrong open-fill time | Timestamped equity curve, terminal update, explicit intrabar bounds | Terminal loss and open/expiry timing |
| M4 data/backtesting | validation/backtest | Intersection hides gaps | Reject misalignment and incomplete sequences | Missing bars on one/both assets |
| M5 architecture/statistical | Store/training/Engine | Predictions/models overwritten or capped | Append-only decisions/models/config/data hashes and trade linkage | Reopen/provenance/duplicate decision tests |
| M6 data quality | market/Store | Malformed rows filtered before validation | Validate structure/finite values/grid first; validate persisted input | Bad end time/grid/order/zero values |
| L1 performance/architecture | Store/server | Whole-history JSON scans; multiple engines possible | Single-server lease and normalized trade archive; retain compatible state API initially | Lease and archive consistency; document remaining scaling |
| L2 code quality/reliability | UI/reports/docs | Percent score and stale verification | Explicit target/evidence labels, versioned reports, fresh verification | API/UI shape checks and report review |

Boundaries: preserve eight causal features, long-only/no leverage, breakout rule, 0.60 threshold, stop/target and round-trip accounting. Redundancy alone is insufficient to remove features. Do not invent historical quotes, fills, untouched market periods or profitability. Regime definitions serve evidence coverage, not return optimization. Volatility-based barrier/size redesign, real execution, full raw historical reconstruction and unseen forward results require additional data/validation; record limitations explicitly.

Risk-budget defaults will be documented as safety-policy choices rather than optimized strategy parameters. Before/after real-market evaluation uses one frozen local dataset, with legacy and repaired execution assumptions reported separately. A genuinely unseen forward period cannot be manufactured from previously audited data.
