# Strategy development and validation — 29 September 2026

**No researched replacement met the frozen acceptance criteria.** Implemented and tested five alternatives plus the existing rules control. New trading rules remain research-only. Production improvements explain model rejection and expose the exact candidate/evidence bottlenecks; no risk limit, threshold, active entry rule or live-trading mode was relaxed.

## Data and evaluation

Downloaded all 96 checksum-verified monthly BTCUSDT/ETHUSDT spot archives for 2022–2025. Each asset contains 140,250 valid aligned candles after quarantining one truncated zero-volume interval. The resulting six-candle gap is reported explicitly. The replay uses the next observed quote on gap recovery and rewarms indicators; it never fabricates missing prices.

The protocol was fixed before observing candidate returns: development through 2023 after warmup; selection on 2024; reserved final evaluation on 2025. The selection file was written before calculating holdout returns. Every evaluation period starts an independent 1,000-USDT research account; risk state persists throughout that period. Longer 24-hour/seven-day expiries are explicit research exit hypotheses; the production six-hour expiry is unchanged.

All alternatives preserve the original 1% initial stop, 0.25% planned equity risk, 20% stake cap, one-position exposure, paper-only/no-leverage policy, cash checks and account loss controls. Trailing stops activate only after a fee-adjusted profitable completed close and can only tighten. Hourly/four-hour/daily inputs use completed UTC bars. Entry is at the following 15-minute open, with the original drift/spread guards. Costs include 0.1% fees per side, 0.05% slippage per side and an assumed 0.10% full midpoint spread. Stops are checked first; next-open gaps use adverse observed prices. These are OHLC simulations, not real fills.

## Why the model stays blocked

The previous 2026 audit showed mean TP-first event frequencies of about 4.7% (BTC) and 7.9% (ETH). Across 132 fits, no validation prediction reached the configured 60% threshold. Only 11 fits established predictive improvement, and none had selected payoff evidence. A model can achieve high classification accuracy by mostly predicting the common negative class; that does not create profitable trades. Lowering the threshold merely to populate trades would not establish an edge.

The new full-2025 walk-forward run uses the same rolling 60-day history, 12-hour retraining cadence, chronological tuning/calibration/purged validation and one-bar publication delay:

| Asset | Fits | Accepted | Predictive-quality pass | Zero trees | Mean holdout TP frequency | Mean prediction | Max independent selected evidence |
|---|---:|---:|---:|---:|---:|---:|---:|
| BTCUSDT | 730 | 0 | 94 | 194 | 4.11% | 4.72% | 0 |
| ETHUSDT | 730 | 0 | 53 | 152 | 11.35% | 11.62% | 0 |

Validation now records counts through raw breakout candidates, independent rule candidates, score qualification, fitting-domain coverage, execution eligibility and independent selected examples. Separate diagnostic reasons expose tree selection, predictive quality, calibration, sample size, payoff uncertainty and regime coverage. The dashboard displays these without mutating old model artifacts. Freshness and configuration compatibility remain separate runtime gates.

Six actual initial/middle/final BTC/ETH jobs were re-fitted with the updated diagnostic code. Trees, base score, learning rate, calibration, selected complexity, feature envelope, signature, Brier metrics and acceptance matched the baseline exactly. The finalizer verifies config/data/model-schedule hashes and identical full-year production metrics. There were 0 baseline training exceptions.

## Original versus current production policy, 2025

| Strategy | Trades | Net return | Max sampled drawdown | Expectancy (USDT) | Profit factor |
|---|---:|---:|---:|---:|---:|
| Original ML-gated trend policy | 0 | 0.00% | 0.00% | undefined | undefined |
| Current policy plus diagnostics | 0 | 0.00% | 0.00% | undefined | undefined |

Counter-trend production trades are zero in both versions because there is no approved counter-trend policy. Undefined expectancy/profit factor are retained as null in JSON. Zero trades do not demonstrate profitability. Existing exits continue to operate independently of new-entry model acceptance.

## Research alternatives, 2024 selection

| Strategy | Trades | Net return | Max sampled drawdown | Expectancy (USDT) | Profit factor |
|---|---:|---:|---:|---:|---:|
| baseline_rules | 167 | -10.10% | 10.10% | -0.60 | 0.51 |
| hourly_breakout_fixed | 135 | -9.28% | 10.04% | -0.69 | 0.49 |
| hourly_breakout_trailing | 128 | -7.19% | 8.75% | -0.56 | 0.61 |
| hourly_pullback_trailing | 70 | -6.79% | 6.79% | -0.97 | 0.37 |
| daily_momentum_trailing | 18 | -1.04% | 2.69% | -0.58 | 0.66 |
| hourly_rebound_fixed | 5 | -0.11% | 0.56% | -0.22 | 0.81 |

No candidate passed the selection gates, so both trend-following and counter-trend selections are null. The protocol requires sufficient overall/per-asset samples, positive after-cost payoff with a positive approximate block-bootstrap lower bound, positive per-asset P&L, no drawdown halt or risk violations, and positive doubled-fee/slippage returns. A positive isolated period or a smaller loss does not qualify.

## Reserved 2025 results, descriptive only

| Strategy | Trades | Net return | Max sampled drawdown | Expectancy (USDT) | Profit factor |
|---|---:|---:|---:|---:|---:|
| baseline_rules | 155 | -10.12% | 10.13% | -0.65 | 0.49 |
| hourly_breakout_fixed | 105 | -8.13% | 8.13% | -0.77 | 0.44 |
| hourly_breakout_trailing | 95 | -7.27% | 7.27% | -0.77 | 0.50 |
| hourly_pullback_trailing | 51 | -3.66% | 3.66% | -0.72 | 0.48 |
| daily_momentum_trailing | 14 | -0.59% | 1.47% | -0.42 | 0.70 |
| hourly_rebound_fixed | 10 | -0.36% | 1.01% | -0.36 | 0.70 |

These are standalone rules-based research portfolios with their own hypotheses, not approved model trades. The existing rules control intentionally omits its model gate to isolate the rule behavior. The other rules are independently tested alternatives; none is wired into the paper agent. Because selection chose no replacement, holdout results cannot be used to pick a runner-up. The daily and counter-trend candidates are especially sparse. All alternatives had negative net return in the reserved period.

Maximum drawdown is sampled at entries, exits and candle closes. Some controls latch the 10% drawdown halt; losses can slightly exceed that threshold through fills/marking. Trading never resumes automatically within a replay after a latched halt. A smaller loss from a halting strategy or higher-cost simulation is not evidence of improvement.

## Costs, robustness and benchmarks

| Strategy | 2025 doubled fees/slippage return | One-bar delay return | Doubled spread/fees/slippage return |
|---|---:|---:|---:|
| baseline_rules | -9.82% | -9.99% | 0.00% |
| hourly_breakout_fixed | -9.69% | -6.20% | 0.00% |
| hourly_breakout_trailing | -9.64% | -6.46% | 0.00% |
| hourly_pullback_trailing | -5.21% | -2.45% | 0.00% |
| daily_momentum_trailing | -0.99% | -0.32% | 0.00% |
| hourly_rebound_fixed | -0.63% | -0.11% | 0.00% |

The fee/slippage stress keeps spread fixed, so it measures cost sensitivity without automatically suppressing every entry. The separate doubled-spread scenario blocks all entries: 0.20% full midpoint spread corresponds to ask/bid minus one slightly above the existing 0.20% limit. Zero return in that scenario is abstention. Fixed-quantity cost stresses are also retained in JSON. Delay stress preserves the entry drift guard. These diagnostics were not used to retune parameters.

Cash returned 0%. Separate 20%-initial-allocation passive references returned -1.34% for BTC and -2.26% for ETH, with drawdowns 8.98% and 13.62%. The remainder stays cash. These are unrebalanced references with drifting exposure and no active stop/loss guards, not equivalent executable policies.

## Implemented changes and verification

- Added research candidates, causal multi-timeframe aggregation, close-based trailing exits, archive checksum verification, gap quarantine, frozen selection and an independent holdout workflow under research/.
- Added src/model-diagnostics.js; extended src/statistics.js and src/training.js to record the evidence funnel without changing learned policy or risk thresholds.
- Updated src/server.js and public/app.js to explain each failed validation requirement, including old saved models.
- Added the research:strategies npm command and research documentation. No runtime dependency was added; Python's standard library is used only by the optional archive downloader.
- Added targeted tests for timestamp conversion, gaps, completed-bar aggregation, prefix/future invariance, distinct rebound confirmation, trailing-stop timing/ratcheting, adverse gaps, expiry priority, risk locks/sizing/accounting, independent fee stress, diagnostic parity and read-only dashboard status.

The complete test log is tests.log. The baseline, revised and candidate reports, frozen protocol, source/config snapshot, checksum manifest and model schedule are retained beside this report. Pre-existing workspace changes and prior audits were preserved. No real account, published model, entry-enable flag or running server was changed.

## Decision and remaining work

The implementable research improvements have been built and evaluated, but **a profitable strategy improvement has not been validated**. Do not enable these alternatives or loosen controls to increase trades. The daily candidate's smaller loss does not clear the acceptance gates, and the counter-trend sample is too small and negative.

The fixed 1% stop is deliberately preserved; these are constrained adaptations rather than reproductions of published long-horizon systems. OHLC assumptions omit quote paths, depth, partial fills and realistic order rejection. Historical 2025 is reserved within this task, not genuinely unseen future data; public studies already reflect knowledge of these years. Candidate selection and approximate bootstrap intervals have limitations. Further changes need a newly declared hypothesis and new independent validation, not repeated tuning on this holdout. Any eventual candidate also needs untouched forward paper observation before activation.

Sources: [Binance public archives](https://github.com/binance/binance-public-data), [Catching Crypto Trends](https://concretumgroup.com/wp-content/uploads/2026/02/Catching-Crypto-Trends.pdf), [Trend-following Strategies for Crypto Investors](https://www.monash.edu/__data/assets/pdf_file/0011/3744821/Trend-following-Strategies-for-Crypto-Investors.pdf), [Freqtrade BbandRsi reference](https://github.com/freqtrade/freqtrade-strategies/blob/main/user_data/strategies/berlinguyinca/BbandRsi.py). The exact candidate definitions and reproduction commands are in research/README.md.
