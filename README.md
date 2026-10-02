# TrendGuard — JavaScript edition

**Runs directly on Windows with Node.js 24 LTS. No Docker, Python, build tools, API keys or paid AI service needed.**

This is a Node.js + Express trading agent with a local browser dashboard, native SQLite persistence, CPU model training, and a historical backtester. It automatically opens and manages **simulated paper trades using public BTC/ETH market data**. This edition does not implement real-money exchange order execution; setting `mode` to `live` is rejected.

## Start here — Windows

1. Install **Node.js 24 LTS** from https://nodejs.org and close/reopen PowerShell. Check `node --version`; it must start with `v24.`. Python 3.14 is not used.
2. Extract the ZIP to a **new folder**, such as `Desktop\TrendGuard-Node`. Do not copy this over the old Python project.
3. Double-click **START-WINDOWS.cmd**. It installs the locked dependencies on first run and starts the app.
4. Open **http://localhost:3000**. Keep the terminal running.
5. Click **Start paper agent**. It downloads data and trains models automatically, then waits for a valid signal. Training progress and errors are displayed in the dashboard.

Alternatively, open PowerShell in the extracted folder containing `package.json` and run:

```powershell
npm.cmd ci
npm.cmd start
```

Using `npm.cmd` avoids the common PowerShell restriction on `npm.ps1`. All files are at the ZIP root: there is no extra inner project folder. If a command says `package.json` is missing, run `dir` and move into the folder where `package.json` is actually present.

No Angular build is required: Express serves a responsive HTML/CSS/JavaScript dashboard. This keeps installation small while still using a JavaScript backend and frontend.

## What changed from the original project

| Original | This edition |
|---|---|
| Docker + Python + Freqtrade/FreqAI | Native Node.js + Express |
| LightGBM | Pure JavaScript logistic gradient boosting with decision stumps |
| FreqUI dashboard | Included local trading dashboard |
| Freqtrade trade database | Built-in Node SQLite, stored in `data/paper.sqlite` |
| Optional live configuration | Paper execution only; no live-order adapter |

The model is **not LightGBM** and should not be presented as having the same performance. Both use boosted trees, but this JavaScript implementation is smaller and has a binary target: **take-profit reached first** versus **stop-loss or time barrier reached first**. Model scores use separate chronological calibration, but are not guaranteed chances of winning. Neither implementation is a validated profitable strategy.

## Controls

- **Start paper agent:** enables automatic entries and schedules training when needed.
- **Pause new entries:** prevents new positions. Existing positions continue to be monitored and closed by their exit rules.
- **Train models:** downloads the last 60 days of 15-minute BTC/ETH candles and trains in a worker thread, keeping the dashboard and trade monitoring responsive.
- **Run backtest:** uses downloaded history for chronological walk-forward evaluation, plus a separate doubled-fee/slippage stress run. Results appear on the dashboard and in `data/backtest.json`.
- **Close paper position:** closes the simulated position using a current bid quote and configured slippage/fees. It counts toward the daily loss rule.

Wait for training to finish before backtesting. No trade is forced merely to populate the dashboard. If validation fails or there is no signal, the correct behavior is to wait.

## Trading and risk behavior

- BTCUSDT and ETHUSDT spot, long only, no leverage, one position across the whole account.
- Trend filter: EMA50 above EMA200, price above EMA50, a close above the previous 20-candle high, and above-average volume.
- Prediction filter: score at least 0.60, matching model configuration, passing holdout validation and model age under 24 hours.
- Only the first two minutes after a completed 15-minute candle are eligible for new entries. A signal is evaluated once per symbol/candle, preventing repeated entries after a restart.
- Entry uses the current ask plus 0.05% assumed slippage. Exit uses the current bid minus 0.05%. Fees are 0.1% on each side. Entry drift may not exceed 0.3% from signal close and spread may not exceed 0.2%.
- Stop: 1% below the simulated entry. Profit target: price needed for 2% net return after the configured fee/slippage costs. Maximum holding time: 24 candles / six hours.
- Position sizing: 0.25% of equity divided by planned stop plus round-trip fee/slippage allowance, capped at 20% of equity and available cash. Below 10 USDT, no entry. These are simulated limits, not synchronized exchange lot-size filters.
- **Two fully closed losing trades after fees in the same UTC calendar day stop all new entries across both pairs.** Losses are counted across BTC and ETH together, even with a win between them. Exactly zero does not count as a loss.
- **Eligibility returns at 00:05 UTC on the calendar day after the second loss closes**, subject to data/model checks and manual pause state. A second loss at 00:01 UTC still waits until the next day. Losses on different UTC days are not combined.
- The loss record, balance, open position and manual entry state survive restarts. A later win cannot clear an active loss lock. The daily reset is a time check, not a scheduled restart, and does not improve the predictions.

The default account has 1,000 simulated USDT. The app never asks for or accepts exchange API keys. Paper results are not exchange executions.

## Model validation and backtesting

The eight causal inputs remain 1/10/20-bar returns, 20-bar return volatility, EMA50/EMA200 distances, relative volume and candle range. Each feature timestamp now uses exactly 299 completed candles to initialize its EMAs. Training, replay and paper inference therefore agree exactly. This is an explicit finite warmup convention. Old version-2 models are blocked until retrained.

The target is **long take-profit before stop or expiry**, not profitable-close probability. Labels retain stop/target/timeout outcomes and fee-inclusive net returns. Positive timeout returns are still TP-negative. Labels and backtests share the same spread-aware next-open entry and conservative exit routine. At expiry, opening stop is checked first, then time exit, then target; intrabar ambiguity is stop-first.

The earliest 60% of complete examples is used for fitting (with an internal chronological tuning split to select 0–80 stumps). The next 20% calibrates scores using regularized logistic calibration. The final 20% evaluates the frozen model/calibrator. All event horizons are purged at both boundaries. Calibration requires at least 20 examples of each class, otherwise the model remains blocked. There is no random time-series split and final evaluation does not choose model complexity or calibration.

Readiness requires a nonzero-tree model, positive holdout improvement over the training-frequency baseline with a positive lower moving-block-bootstrap bound, and positive net-payoff evidence for non-overlapping selected examples. At least 30 selected examples and a positive lower payoff bound are required globally and in the current causal regime. Regimes describe bullish/bearish/range conditions and whether horizon-scaled volatility exceeds the configured stop distance. These are research evidence guards, not a proof of calibration or profitability. The sample minimum and bootstrap block choices have limitations; rare entry regimes may remain unsupported indefinitely.

Scores are shown on a 0–1 scale. Reports separately contain classification accuracy/precision/recall/F1 at the entry threshold, reliability bins, mean prediction, observed TP frequency, ECE, and evidence counts. Accuracy can be high when most targets are negative and no entries qualify. Never interpret it as trading win rate.

Automatic retraining remains every 12 hours with hourly failure retries and 24-hour model/data expiry. Downloads retain 30 extra days for evaluation; each model fits only the most recent configured 60 days. Model, data and configuration hashes are retained with append-only decision/model records. A failed quality check replaces the previous model; a training exception leaves the old model usable only until its normal expiry.

Backtesting now requires a full rolling training window before the evaluation start, exact aligned contiguous histories and the same model-age, trade-decision and global-risk guards. Training completion is approximated by one candle of delay (configurable); actual network and CPU latency is not historical quote data. It retrains every 12 hours on the rolling window. It uses next-open entries, a declared 0.10% full midpoint spread scenario, fees/slippage, opening-gap fills and stop-first intrabar ordering. Known open fills use open timestamps; intrabar fills are explicitly interval-censored and booked at candle end. Full quote/depth/poll-path replay is unavailable.

Reports include an equity curve, terminal-liquidation updates, sampled drawdown, a separate conservative OHLC low-price drawdown bound, win/loss/payoff/duration/streak metrics, daily-return Sharpe/Sortino/Calmar with short-sample warnings, and asset/month/regime attribution. Empty metrics are null, not artificial zeros. Shorts remain unimplemented. A doubled-cost resimulation changes spread, stake and targets; a separate fixed-trade fee/slippage stress isolates costs on unchanged quantities and exit quotes. Both retain the same frozen model schedule.

Run npm.cmd run train, npm.cmd run backtest, or npm.cmd test. Avoid concurrent CLI/dashboard jobs. The offline audit evaluator is node verification/evaluate-audit.js; it uses a frozen read-only snapshot and writes audit-output artifacts without publishing models or touching the paper account. The archived before source/config under audit-output/before is required for that comparison.

The supplied 2026-09-25 audit data covers only about 63 days. Requiring a complete 60-day training window leaves approximately 2.7 days of replay, whereas the old backtest started prematurely after 65% of history. These native backtests have different assumptions and periods. Common prediction comparisons use identical timestamps and repaired labels. Audited history is not a genuinely unseen forward test.

## Additional global risk budgets

The existing two-loss UTC lock, long-only/no-leverage policy and 20% stake cap remain. New default safety budgets are 0.5% gross realized loss per UTC day, 2% per UTC Monday-based week, a 24-hour cooldown after four consecutive losses across days, and a persistent 10% drawdown halt. Daily/weekly bases are realized equity at the start of the period. Wins do not replenish gross loss budgets. Planned stake is also capped by the remaining daily/weekly loss allowance. These are transparent safety-policy defaults, not parameters optimized on returns or guarantees against gaps.

Equity marks preserve the peak and latch a drawdown halt. Entry pause/resume does not clear it; a halt requires deliberate account review and there is no automatic reset API. Existing-position exit monitoring remains active. Volatility-dependent stop/sizing redesign is deliberately deferred pending out-of-sample evidence; volatility presently affects regime evidence coverage. All financial mutations must satisfy complete schema, position/trade validity and conservation checks before committing. Closed trade history is immutable.

## Reliability and limitations

The app polls quotes every 15 seconds. A price can touch a barrier and move away between polls; the paper engine will miss that event. Real fills, order-book depth, partial fills, rounding constraints, exchange rejections and hosted stops are not simulated by the running paper engine. The historical backtester follows a different OHLC approximation, so exact agreement is not expected.

Closing the terminal, sleeping the computer or losing the network stops monitoring. On recovery after more than 90 seconds without a successful position quote, the bot first applies any currently triggered stop/profit/time exit; otherwise it closes at the recovered quote with reason `recovery_quote`. It does **not** invent historical fills during the missing period. This can understate losses or miss gains. Recovery closes still update fees, P&L and the daily loss lock.

SQLite uses transactions, WAL and full synchronization. Model/decision/candle-revision archives and normalized closed-trade records are retained. The compatible account JSON still retains full trade history, so large-account scaling remains a limitation. Corrupt state fails closed instead of silently creating a fresh balance. Preserve the entire `data` folder; stop the app before backup and include SQLite companion files. Deleting the database creates a fresh paper account and erases its risk history. There is intentionally no reset-balance API or dashboard button.

The server binds to `127.0.0.1`, rejects unexpected Host headers, uses same-origin/token checks for controls, and does not load external dashboard scripts. This is a single-user local app, not a public multi-user service. Do not expose it through port forwarding or a public reverse proxy without adding proper authentication and deployment hardening.

Changing `config.json` requires a restart. Fee/slippage/stop/target/horizon changes invalidate saved models until retraining. An existing position retains its original fee assumptions, exit levels and expiry. Changing `initialBalance` does not reset an existing account. The current BTC/ETH paper configuration is a research default, not a recommendation to invest.

## Troubleshooting

**PowerShell says running scripts is disabled:** use `npm.cmd ci` and `npm.cmd start`, or double-click `START-WINDOWS.cmd`. No execution-policy change is needed.

**`node` is not recognized:** install Node.js 24 LTS, then reopen the terminal.

**`node:sqlite` unavailable:** the Node version is too old. This app uses the built-in SQLite module to avoid native dependency compilation.

**Port 3000 in use:** stop the other app, or change `port` in `config.json` and use that new port in the browser. The launcher's printed shortcut assumes the default 3000; the server prints the actual configured address.

**Model not ready / no trades:** check the Model validation and Activity panels. Data download, class coverage, holdout quality, model freshness, breakout conditions, spread, entry timing and the daily loss lock can all legitimately block entries.

**HTTP 403/451 / timeout / market data failed:** public Binance data is inaccessible or unreliable from your location/network. The app retries transient failures and blocks entries if data is unavailable. It does not bypass exchange restrictions or substitute fake data. The computer clock must also be synchronized to within 30 seconds of exchange time.

**Dashboard doesn't open:** check the terminal for startup errors. Keep `npm start` running and use `http://localhost:3000`, not an HTTPS URL.

## Source layout

- `src/server.js`: Express API, local access controls and worker scheduling.
- `src/engine.js`: paper fills, position lifecycle and entry guards.
- `src/risk.js`: persistent-history loss lock, sizing and signal conditions.
- `src/store.js`: SQLite persistence and atomic account changes.
- `src/features.js`, `src/model.js`, `src/training.js`: features, labels, boosted-tree learning and chronological validation.
- `src/market.js`: public market-data access, clock and data checks.
- `src/backtest.js`: historical simulation and lock audit.
- `src/jobs.js`: off-thread training and backtest tasks.
- `public/`: browser dashboard.
- `test/`: risk, restart recovery, model, backtest and HTTP integration tests.

References used for implementation: [Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html), [Express setup](https://expressjs.com/en/starter/installing/), [Binance public market data](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md), [market endpoints](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints).

## Production-readiness follow-up (26 September 2026)

Prediction acceptance now verifies the model/calibrator and evidence fields, rejects inputs outside the observed fitting-feature envelope, and rejects scores outside the selected regime evidence range. Zero historical volume is unsupported rather than replaced by an arbitrary denominator. Payoff evidence excludes candidates failing the entry spread/drift rules. These guards prevent unsupported decisions; they do not prove a profitable edge or production readiness. The changed policy signature requires retraining.

Model publication refuses older training/data snapshots and derives an immutable content hash. An individual symbol training failure no longer aborts the other symbol. Backtest output is atomically replaced and the dashboard refuses results from older source/configuration. Public-data requests honor rate-limit cooldowns, including pending concurrent retries; IP-wide budgeting across processes remains a deployment requirement.

Run node verification/production-review.js for the latest frozen 90-day local snapshot evaluation without changing the paper account. The detailed production blockers are in audit-output/PRODUCTION-READINESS-REVIEW.md. Real execution, order reconciliation, protective orders, quote-path validation, independent forward profitability evidence and operational soak testing are still outstanding.

Insufficient training outcome coverage is now saved as an explicit model rejection rather than retaining an old accepted model. Network/infrastructure exceptions still allow the previous model only until its existing expiry. Rejected coverage models wait for the normal retraining cadence.

## Strategy and counter-trend review (28 September 2026)

The current strategy remains spot-style, long-only paper trading. Its bullish breakout filter has been preserved. A separate downside-sweep/recovery hypothesis is evaluated only by the offline research scripts; it has no route to paper or live entries. Existing evidence is selected from bullish breakout setups and cannot justify counter-trend entries.

Automatic and manual exits now independently reject stale, future-dated or malformed quotes. A fresh wide spread still allows a protective exit. Failed quotes do not advance the recovery timestamp or mutate the account. New strategy entries record `context.setup` for attribution.

The [review report](audit-output/strategy-review/REPORT.md) traces the complete strategy and describes its behavior across regimes. The identical-period walk-forward comparison used 60-day rolling training windows and 32.89 evaluation days. Both original and revised strategies made zero approved trades; none of 132 models passed validation. A separate **rules-only diagnostic without model gates** lost 1.50% on 36 trend-following trades and 0.98% on seven counter-trend trades after costs. This does not support enabling counter-trend trading or removing existing filters.

Run `node verification/strategy-review.js` to reproduce the comparison from the saved source/data snapshot, or add `--reuse-models` to verify and reuse its frozen model schedule. The scripts write only to `audit-output/strategy-review`; they never publish models, start the agent or change the paper account. `npm.cmd test` includes exit-freshness, causal counter-trend research and cross-asset risk regressions. Longer untouched forward evaluation and setup-specific predictive/payoff evidence are required before adding an executable counter-trend policy.

## Strategy development and validation (29 September 2026)

Model rejection now includes a diagnostic breakdown: predictive quality, calibration, independent evidence count, payoff uncertainty and regime support. New training reports also count how many breakout candidates survive score, feature-domain and execution checks. The dashboard displays these reasons for new and existing model artifacts. These additions do not change prediction values, entry thresholds or risk limits.

Five alternatives and the original rules control were implemented in an isolated [research workflow](research/README.md): hourly breakouts, hourly pullback recovery, daily momentum and confirmed counter-trend rebounds, with fixed or completed-close trailing exits. Four years of checksum-verified BTC/ETH history support a frozen development/2024-selection/2025-test split. None of the alternatives passed selection; all lost money after costs in 2025. New entry/exit policies remain research-only. The [full results](audit-output/strategy-improvement/REPORT.md) explain the negative findings and why a smaller loss or fewer trades does not validate an edge.

Run `npm.cmd run research:strategies` after downloading the separate research data as described in `research/README.md`. This does not publish models or touch the paper account. The full-year baseline comparison is a separate, slower command. The optional archive downloader uses Python's standard library; running the bot still requires only Node. Existing settings, published models and entry-enable state are preserved. A running server picks up diagnostic changes at its next normal restart.
