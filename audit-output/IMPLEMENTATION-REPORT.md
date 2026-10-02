# Trading-system implementation report

25 September 2026. Source of requirements: TRADING-SYSTEM-AUDIT.md and IMPLEMENTATION-CHECKLIST.md. Existing staged changes were preserved; implementation changes are additional working-tree changes. No parameter search for profitable historical returns was performed. The original eight inputs, breakout rule, score cutoff, long-only/no-leverage policy, fixed stop/target, daily two-loss lock and correct fee accounting were retained.

## A. Audit issues addressed

| Audit issue | Before | Implemented correction | Validation result |
|---|---|---|---|
| H1 — indicator inconsistency | EMA seeds depended on caller's history length | Identical 299-completed-candle initialization at every timestamp; model signature/version changed | Exact full-history/prefix/rolling parity; future-change invariance |
| H2 — model lifecycle mismatch | Weekly expanding training; no historical age check | Shared rolling window, 12h due check, 24h freshness and common decision engine; declared completion delay | Bounded earlier-only history, exact cadence/latency and expiry tests |
| H3 — stale entry snapshot | Checks could expire during another request | Recheck all markets after collection; current quote/candle/model checks inside transaction | Delayed second-symbol, expired-window, stale-one/fresh-other and newly rejected-model regressions |
| H4 — invalid financial state | Partial validation before mutation only | Complete position/trade schema, conservation and immutable-history checks before commit | Missing fees/expiry, negative quantities, NaN, inconsistent balances, overlap/duplicate history and rollback tests |
| H5 — unsupported prediction acceptance | Any positive global Brier difference could pass | Separate calibration period; dependence-aware Brier interval; selected net-payoff and regime evidence gates | No evidence fails closed; final holdout cannot change fit/calibration; calibration diagnostics |
| M1 — incomplete risk budgets | Daily loss count only | Monetary day/week budgets, remaining-risk stake cap, cross-day streak cooldown, persistent drawdown latch | Large loss, budget exhaustion, reduced stake, legacy drawdown and confidence-bypass tests |
| M2 — execution mismatch | Candle prices lacked spread; stress semantics implicit | Declared spread scenario; shared label/backtest barrier routine and financial sale formula; separate fixed-trade and resimulated stresses | Spread/fee/target consistency, gap/expiry/ambiguity and synthetic execution tests |
| M3 — metrics/timing | Incorrect open-fill timestamps; no terminal drawdown update | Open fills timestamped exactly; intrabar fills explicitly censored; equity curve and final liquidation mark | Final-entry liquidation, first-candle stop ambiguity, null-ratio tests |
| M4 — missing historical bars | Timestamp intersection silently skipped gaps | Require complete, contiguous, identically aligned histories | Missing-one-asset, missing-both, duplicates and ordering tests |
| M5 — missing provenance | Models overwritten; capped event records | Model/decision/candle revision archives, hashes, trade decision linkage and equity marks | Reopen and archive persistence tests |
| M6 — malformed data filtering | Invalid end times could disappear before validation | Validate raw shape and all timestamps/price fields before completed-candle filtering | Missing/null/NaN timestamps, off-grid bars, zero/negative prices and ordering tests |
| L1 — operational/scaling | No process lease; no normalized trade archive | Exclusive server lease, indexed immutable trade archive and migration of existing trades | Two-instance lease test and persisted history checks; full JSON-history scaling remains partial |
| L2 — interpretation/provenance | Percent scores and older verification | 0–1 score display, explicit TP target, evidence counts, model/data/config/source hashes, current documentation | HTTP integration, asset syntax and generated-report review |

The confirmed high-priority bugs have been corrected. Some broader recommendations require data or a separately validated strategy redesign; those are listed under L rather than represented as implemented.

## B. Files/components changed

- Core changes: src/engine.js, src/features.js, src/training.js, src/model.js, src/risk.js, src/market.js, src/store.js, src/backtest.js, src/config.js, src/jobs.js and src/server.js.
- New shared modules: src/account.js (financial-state invariants), src/data.js (candle validation), src/execution.js (spread/fills/accounting), src/lifecycle.js (training/freshness), src/decision.js (entry decision), src/statistics.js (calibration/evidence), src/performance.js (trade/equity metrics), src/provenance.js (hashes).
- Configuration and presentation: config.json, public/app.js, public/index.html, README.md and VERIFICATION.md.
- Tests: test/audit.test.js; existing core/integration fixtures updated for the new model identity and explicit feature warmup.
- Reproducible evaluation: verification/evaluate-audit.js and audit-output artifacts. The evaluator reads the account database only to create the first frozen candle snapshot; subsequent runs reuse that snapshot. It never publishes research models or changes the paper account.

## C. Trading logic fixes

Prediction and execution are now separate. tradeDecision evaluates the current model, signal, quote, time, evidence for the causal market regime, exposure, risk state, entry drift and available risk budget. openPaper still independently enforces global risk and exposure controls, so a high model score cannot override them.

An entry no longer uses a model that was replaced while network requests were pending. Both quotes must still be healthy after snapshot collection; the selected quote and signal are checked again at the transaction boundary. Once a valid candle is evaluated it remains consumed across restarts, preserving the original once-per-symbol/candle behavior.

Financial calculations were centralized without replacing the already-correct P&L formula. Entry fees are charged once, sale proceeds deduct exit fee once, and the target still produces exactly 2% net return on entry cost under its assumptions. Full state validation rejects nonfinite/missing financial fields and enforces cash + open cost = initial balance + realized P&L. Existing closed trades cannot be rewritten by a state mutation.

Known opening-gap and expiry fills now use the opening timestamp. Stop takes precedence over expiry at the opening quote; expiry takes precedence over a new target hit. This resolves the original paper/backtest priority disagreement. Intrabar stop/target ambiguity remains conservative stop-first.

## D. Prediction-model improvements

The target is explicit: **long TP before stop or expiry**. It is not a future-price forecast, a short signal, or a probability that every closed trade will be profitable.

Training is chronological: first 60% for fitting/internal tuning, next 20% for calibration, final 20% for evaluation, with full event-horizon purges. The internal fitting segment still selects zero to 80 decision stumps using an earlier tuning period. A regularized monotonic logistic calibration layer is fit only on the separate calibration segment. Insufficient class coverage leaves calibration unsupported and readiness blocked.

The final holdout reports Brier, baseline Brier, log loss, accuracy, precision, recall, F1, mean predicted score, observed target frequency, reliability bins, ECE and sample support. A circular moving-block bootstrap estimates uncertainty in paired baseline-minus-model squared error. The model cannot pass solely because of a tiny numerical Brier gain.

Additional readiness requires positive estimated net payoff, including timeout returns, from at least 30 non-overlapping selected examples with a positive lower bootstrap bound, and supported evidence in at least one regime. Each entry requires support in its current regime. Minimum count and bootstrap choices are explicit research safeguards; they are not a universal statistical certificate and may block entries for long periods.

## E. Feature-engineering changes

No extra indicators were added and no overlapping feature was removed without evidence. The identified defect was input inconsistency. All eight inputs now use a deterministic 299-bar feature window, matching the available paper history. The EMA values are therefore finite-warmup EMAs, a changed and versioned convention. Saved version-2 models are rejected automatically.

Causal regime metadata uses EMA50/EMA200/price ordering and compares 20-bar volatility scaled by the square root of the existing horizon with the existing stop distance. It does not read future prices, learn regime thresholds from returns, or add another optimized classifier. This metadata is used for evidence coverage and attribution.

## F. Label/target changes

Label generation and historical execution share the same barrier routine and explicit spread scenario. Features use only the signal candle and its past; entries occur at the next opening ask plus slippage. Outcomes retain TP, stop and timeout distinctions and their fee-inclusive returns. A profitable timeout remains a TP-negative label, but its actual payoff enters the separate economic evidence calculation.

The full horizon, including the opening expiry price, must be available. Same-bar ambiguity is stop-first. These targets are still OHLC approximations, not observed executable quote paths. No fabricated exchange quotes or fills were introduced.

## G. Risk-management improvements

New policy defaults, fixed before replay and not optimized on returns:

| Policy | Default / semantics |
|---|---|
| Gross daily realized loss budget | 0.5% of realized equity at UTC day start |
| Gross weekly realized loss budget | 2% of realized equity at UTC Monday start |
| Drawdown halt | 10% from observed/realized equity peak; latched persistently |
| Consecutive-loss protection | Four losses across days -> 24h cooldown after last loss |
| Remaining risk allowance | Planned stake cannot consume more than remaining day/week allowance |
| Existing controls | 0.25% nominal planned risk, 20% stake cap, one position, no leverage, two-loss UTC lock |

Wins do not replenish gross loss budgets. Manual start/resume cannot clear the drawdown latch. Existing-position exit monitoring continues while entries are paused or blocked. Legacy account histories are also checked for realized drawdown. Gaps and downtime can still exceed planned risk; local polling does not enforce a guaranteed stop fill.

No new leverage or short-selling behavior was added. Volatility-dependent stop/sizing redesign was not fabricated; the existing sizing and fixed barrier strategy remain, with volatility used for regime evidence. Such redesign would alter the strategy and needs independent evaluation.

## H. Backtesting improvements

The backtest now requires the complete rolling training window before evaluation. It uses the same lifecycle/decision/risk functions as the paper engine, retrains every 12 hours, respects age/signature/quality checks and retains only earlier completed data. Model availability is delayed by one candle as an explicit approximation. Training exceptions preserve an existing model only until expiry; rejected trained models replace it.

Historical inputs must match exactly across both assets. The simulator no longer silently intersects timestamps. The declared base spread is 0.10% around candle trade price; fees and slippage remain configured. It simulates next-open entries and opening gaps, conservative intrabar exits, position sizing and capital compounding. Full quote depth, partial fills and tick latency remain unavailable.

Equity is recorded at entries, exits, bar closes and final liquidation. Reports separate sampled drawdown from a conservative low-price OHLC bound whose extrema ordering is unknown. Performance includes net return, trade counts, win rate, average wins/losses, expectancy, profit factor, durations, streaks, full-day-return Sharpe/Sortino and Calmar, with short-sample warnings. Empty/undefined metrics stay null. Asset/regime/month breakdowns and long-only scope are explicit.

Cost stress has two meanings, both labeled: (1) full resimulation with doubled spread/fees/slippage, affecting eligibility, stake and targets; (2) fixed-trade quantities and quote exits with only fee/slippage repricing. Resimulation reuses the identical frozen model schedule; it does not retrain to stressed outcomes.

## I. Anti-leakage and anti-overfitting changes

Feature parity and future-perturbation tests verify causal inputs. Training/calibration/evaluation horizons are purged. Changing the final holdout cannot alter fitted trees, tree selection or calibration coefficients. Simulation trainers receive a bounded past-only window and have delayed availability. No threshold/feature/parameter sweep against audit returns was conducted.

The current history was already audited. It cannot be renamed an untouched test. Model acceptance uses later historical evidence, but a genuinely independent future forward period is still needed. Bootstrap intervals do not remove nonstationarity, longer-range dependence or repeated-research/multiple-comparison risk.

## J. Tests added/updated

The complete suite now contains **50 tests** (25 previously, 25 added), covering the audit regressions, accounting conservation across prices/fees, risk budgets, retained loss-lock behavior, indicator parity, raw data rejection, shared labels/exits, calibration coverage, holdout invariance, lifecycle timing, final liquidation, ambiguous first-candle stops, provenance persistence and process exclusion. Synthetic accepted-model fixtures are explicitly test-only and exercise execution; their trades are not evidence of market profitability.

Commands: `npm.cmd test` and `node verification/evaluate-audit.js`. The latter runs both before/after prediction pipelines and the normal/stressed repaired backtest on frozen local market data, without touching the active account.

## K. Before versus after metrics

Prediction comparison uses **the same 1,088 timestamps per asset, the same repaired spread-aware labels and identical metric formulas**. Native before scores from the earlier audit used different labels/window counts, so they are intentionally not substituted into this paired table.

| Metric | Before | After | Change | Interpretation |
|---|---:|---:|---:|---|
| BTC Brier | 0.049471 | 0.045391 | -0.004080 | Lower descriptive error on common targets |
| ETH Brier | 0.103606 | 0.095518 | -0.008088 | Lower descriptive error on common targets |
| BTC ECE, 10 bins | 0.032368 | 0.024812 | -0.007556 | Lower bin-averaged mismatch in this sample |
| ETH ECE, 10 bins | 0.079383 | 0.068096 | -0.011288 | Lower bin mismatch; substantial underprediction remains |
| BTC classification accuracy at 0.60 | 95.22% | 95.22% | 0 | Majority-negative result, not trading accuracy |
| ETH classification accuracy at 0.60 | 89.89% | 89.89% | 0 | Majority-negative result, not trading accuracy |
| Precision at 0.60, both | Undefined | Undefined | — | No positive predictions |
| Recall / F1 at 0.60, both | 0 / 0 | 0 / 0 | 0 | No target-hit cases selected |
| BTC mean predicted TP frequency | 6.690% | 6.022% | -0.668 pp | Observed common-label frequency 4.779% |
| ETH mean predicted TP frequency | 10.644% | 3.301% | -7.343 pp | Observed frequency 10.110%; mean bias worsened despite lower Brier |
| Automated tests | 25 passing | 50 passing | +25 | Added behavior coverage, not proof of profit |

BTC's repaired native Brier is 0.045391 versus constant baseline 0.045528, but the improvement interval includes zero (approximately -0.00509 to +0.00745). ETH is worse than its new baseline (0.095518 versus 0.091979), and its improvement interval also crosses zero. **Both remain blocked.** Both have zero selected economic examples at the unchanged 0.60 threshold. Lower Brier is not claimed as a statistically established predictive edge, and no calibration guarantee is made.

| Trading metric | Before saved backtest | After repaired replay | Interpretation |
|---|---:|---:|---|
| Trades, normal / stress | 0 / 0 | 0 / 0 | No realized strategy evidence |
| Net P&L, normal / stress | 0 / 0 USDT | 0 / 0 USDT | Inactivity, not profitability |
| Ending balance | 1,000 USDT | 1,000 USDT | Unchanged capital |
| Sampled max drawdown | 0% | 0% | No deployed capital |
| Win rate, average win/loss, expectancy, profit factor | Undefined | Undefined | No trades |
| Sharpe, Sortino, Calmar | Not reported | Undefined | Constant inactive equity |
| Average duration, asset/regime profitability | No observations | No observations | Cannot measure improvement |
| Short performance | Unsupported | Unsupported | Long-only scope retained |
| Loss-lock violations | 0 | 0 | Vacuous on real zero-trade sample; exercised in synthetic tests |

The old saved backtest spans roughly 22 days from September 3; the repaired replay spans **September 22 19:45 UTC through September 25 13:29:59.999 UTC**, about 2.7 days. The short after period follows from requiring a full 60-day warmup from the approximately 63 days available. On the common subset the old zero-trade run also has zero trades/P&L. Execution assumptions were deliberately corrected, so native trading results are **not a controlled profit-improvement experiment**. Reproducing the old invalid lifecycle solely for comparability would defeat the fixes. Longer history and forward observation are required for meaningful risk-adjusted comparisons.

Artifacts: before-after.json, after-models.json, after-backtest.json, frozen-market-data.json and per-asset after-predictions.json files in this directory. Their provenance identifies config, source and data hashes. The archived before source/config is retained for repeatability.

## L. Remaining issues / cannot safely implement from present evidence

| Cannot complete as a validated capability | Reason | Required data/infrastructure | Next step |
|---|---|---|---|
| Genuine unseen forward validation | Existing data was already audited | Later untouched market period and persisted forward decisions | Freeze this version; observe without retuning |
| Realistic quote/depth/partial-fill replay | Only OHLC history exists | Timestamped bid/ask/depth/trade stream and execution assumptions | Record and replay quotes; keep OHLC results labeled approximate |
| Validated volatility-adjusted stops/sizing or added indicators | Would change strategy without supporting evidence | Independent regime/ablation evaluation | Predefine alternatives and evaluate outside current holdout |
| Complete past prediction-versus-outcome ledger | Old models/snapshots were not retained | Historical versioned decisions that do not exist | New archives provide future traceability only |
| Measured actual MFE/MAE and path-accurate drawdown | No tick path or actual trades | Fine-resolution path and position timeline | Retain high-frequency observations; distinguish interval bounds |
| Calibrated high-confidence trade region and positive expectancy | No current scores meet the trading threshold | Sufficient independent selected examples across later regimes | Keep models blocked; do not lower threshold to populate dashboard |
| Raw past-response authenticity/revisions | Only parsed saved candles exist | Immutable raw responses and/or independent source | Current revision archive begins now; external reconciliation remains |
| Large-account scaling | Compatible state API still materializes/validates full trade history | Benchmarked migration and normalized risk summaries | Trade archive and index are present; complete normalized-account migration separately |

Model fitting remains intentionally small. Fee tier, exchange lot sizes, real orders, leverage, news filters and forced liquidation are not falsely implemented. This is still paper-only. Unknown intrabar ordering and Windows sleep/network outages can materially change outcomes.

## M. Potential risks introduced by these changes

- Version-2 models become ineligible; users must restart and retrain. This is intentional because feature/label/validation identity changed.
- The stricter evidence gates, regime subdivision and shorter calibration history can produce fewer eligible models, including prolonged zero-trade operation. They must not be relaxed solely to improve returns.
- Calibration learned on a small/nonstationary period can worsen some aspects of prediction; ETH mean frequency underprediction in this replay illustrates that risk.
- The spread and one-bar training-delay values are explicit scenarios, not historical measurements. Stress outcomes can reflect changed eligibility as well as costs.
- New loss budgets and drawdown latch can pause a system that previously traded. They are documented safety defaults, not tailored investment limits. No automatic drawdown reset is exposed.
- Additional immutable records consume disk space. The JSON-compatible account state still incurs full-history work; no unlimited-scale claim is made.
- The server lease protects updated servers only. An already-running old server does not know the lease protocol; stop all old instances before restart. PID reuse can conservatively block lease acquisition and needs operator inspection.

## N. Recommended next improvements and activation

1. Stop the existing server, preserve the entire data folder, and restart with `npm.cmd start`. Existing account balances/history are not reset. Schema additions and legacy archive population occur on startup. Run **Train models** to produce version-3 models; existing version-2 models remain blocked meanwhile.
2. Collect additional historical/quote data and forward decisions. Downloads now include 30 extra days so future backtests have a complete rolling training window plus an evaluation period.
3. Keep this version, thresholds and policy fixed during a genuinely later forward evaluation. Assess cost sensitivity and regime-specific payoff confidence before considering trading-readiness claims.
4. Add quote-path replay and benchmark a full normalized-account migration before scaling. Investigate feature/volatility alternatives only through predefined independent experiments.

The verified improvement is stronger correctness, reproducibility and refusal to trade without adequate evidence. Profitability and superior future risk-adjusted returns remain unestablished.
