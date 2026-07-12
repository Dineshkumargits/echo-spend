# Dashboard Deep-Revamp — Implementation Handoff

**Goal:** the Home tab is the first thing users see; make it the app's showcase — dense with *glanceable, personal* insight, alive only where something needs attention, and unmistakably "Money as Signal". Everything below is **presentation-only**: read-only queries that already exist in `src/services/database.ts`, plus components that already exist in `src/components/Signal.tsx` / `Kit.tsx`. No business-logic changes.

---

## 1. Current state (what's already there)

`src/screens/DashboardScreen.tsx` today renders, in order:

1. Quiet header (eyebrow `ECHO SPEND` + tour/analytics/search icon buttons)
2. Safe-to-spend hero (`monthlyBudget − getCurrentMonthSpend(salaryDay)`) + gradient `CycleBar` + `Nd left` + spent/net-worth mono caption
3. Smart Inbox pulse chip (`getUnconfirmedTransactions().length`)
4. Activity feed grouped Today/Yesterday/Earlier (first 10 of `getTransactions({limit:15, confirmedOnly:true})`) — **still uses a hand-rolled row, not `SignalRow`**
5. Linked accounts horizontal carousel + Add Account tile
6. AI setup nudge card (conditional on `aiModelStatus`)
7. Upcoming commitments carousel (goals/loans/subs due ≤ 10 days)
8. Amber FAB → AddTransaction

`loadData()` already parallel-loads: transactions, accounts, categories, month spend, goals, loans, subscriptions, unconfirmed.

## 2. Unused assets & data this revamp should exploit

| Asset | Where | Status |
|---|---|---|
| `WaveformBar` (spend as audio wave — a signature element!) | `Signal.tsx` | **built, never used** |
| `ResonanceRings` (milestone celebration) | `Signal.tsx` | built, never used |
| `getSpendTrend(7)` → `SpendTrendPoint[] {date,total}` | database.ts:1050 | not on dashboard |
| `getCategoryBreakdown()` (current month, split-aware) | database.ts:1076 | Analytics only |
| `getBudgetUtilization(salaryDay)` → `{budget, spent, percentage}[]` | database.ts:1631 | Analytics only |
| `getHighSpendTransactions(threshold)` | database.ts:1243 | Analytics only |
| `getPendingSplitMembers()` → `{memberName, memberShare, memberPaidAmount, splitTitle}[]` | database.ts:2463 | Splits screens only |
| `getActiveInsights()` / `useAIInsights().generateInsights()` | useAIInsights.ts | Analytics only |
| `getLastScanTime()` (MAX(lastScannedDate)) | database.ts:1511 | SmartScanTab only |
| `lastSynced` (store) / `getLastSyncAttempt()` | store / database.ts:619 | Settings only |
| `googleUser.name` (for greeting) | store | unused on dashboard |

## 3. Target layout (top → bottom)

### 3.1 Header — personal greeting
- Eyebrow stays `ECHO SPEND` (SectionLabel).
- Below it: time-of-day greeting in Clash Display 24 — `Good morning` / `Good afternoon` / `Good evening`, plus first name when signed in: `googleUser?.name?.split(' ')[0]`. No name → greeting alone.
- Keep the three ghost icon buttons (tour/analytics/search) unchanged.

### 3.2 Hero — safe-to-spend + daily pace
Keep the existing hero (amount, CycleBar, days-left, spent/net-worth line) and **add one line** under the amount, mono size 11 `colors.secondary`:
- If `monthlyBudget > 0 && safeToSpend > 0 && daysLeftInCycle > 0`:
  `that's {currency}{formatINR(Math.floor(safeToSpend / daysLeftInCycle))} / day for {daysLeftInCycle} more days`
- If over budget: `over by {currency}{…} · resets in {daysLeftInCycle}d` in `colors.danger`.

### 3.3 Cycle waveform — the signature moment (NEW)
Directly under the hero block, before the inbox chip:
- `WaveformBar` fed from `getSpendTrend(14)`: map to `WavePoint{value: total, kind: total > 0 ? 'out' : 'faint'}` (zero days render as faint 3px stubs at min-height — tweak WaveformBar to accept `kind:'faint'` with value 0 → it already clamps `Math.max(3, …)`).
- Height 40, barWidth 5, gap 3, full width. Under it a mono caption row: left `last 14 days`, right `peak {currency}{max}` (skip when all zero).
- Whole block wrapped in `Pressable` → `navigation.navigate('Analytics')`.
- Privacy: when `preferences.hideAmounts`, keep bars (shape is not an amount) but mask the peak caption.

### 3.4 Inbox pulse chip — unchanged (already correct)

### 3.5 Pulse strip — 3 stat tiles (NEW)
Horizontal row (flex, gap 10) of `StatBlock`-style tiles in `Card`s (padded 12, flex 1):
1. **Today** — sum of today's debits from the already-loaded `getSpendTrend(14)` last point (no extra query). Color `colors.debit`.
2. **Top category** — `getCategoryBreakdown()[0]` → name (truncated) + `{pct}%`. Color: the category's own color, fallback `colors.secondary`. Hidden if no data (render tile with `—`).
3. **Biggest pulse** — `getHighSpendTransactions(0)[0]` this data is all-time; instead compute max debit from loaded `transactions` (already in state) to stay cheap: `Math.max(debits this list)` with merchant name below. Color `colors.debit`.
All values respect `hideAmounts` (`••••`).

### 3.6 Insight of the day (NEW)
- Data: `getActiveInsights()` (read-only). Show the **newest one** as a dismissible card: `IconTile` (💡 / colors.ai) + title (textSemibold 14) + body (secondary 12, 2 lines) + ✕ → `dismissInsight(id)` (existing function; it's a user action, same as Analytics).
- **Freshness rule (no new storage):** if the newest insight's `generatedAt` date ≠ today **and** `transactions.length > 0`, fire `generateInsights()` once in the background after load (`useAIInsights` is deterministic/heuristic — no AI model, cheap). Guard with a `useRef` so it runs at most once per mount.
- Hidden when there are no insights and none could be generated.

### 3.7 Budget watch mini (NEW, conditional)
- Data: `getBudgetUtilization(preferences.salaryDay)`, sorted by `percentage` desc, take top 3, **only render section if any `percentage ≥ 60`** (quiet until it matters — Rule 03).
- Each row: category name (textSemibold 13) + mono `{pct}%` right + `CycleBar` (`pct`, solid `colors.danger` ≥100 / `colors.debit` ≥80 / `colors.credit` else, height 4).
- SectionLabel header `Budget watch` + whole block `Pressable` → `navigation.navigate('Budget')`.

### 3.8 Owed to you (NEW, conditional)
- Data: `getPendingSplitMembers()`. If non-empty: single `Card` row — `IconTile 🤝 colors.credit` + `“{n} people owe you”` + mono total `+{currency}{Σ(memberShare − memberPaidAmount)}` in `colors.credit` → navigate `Finances` (splits tab is inside; navigating to the tab hub is fine).
- Respect `hideAmounts`.

### 3.9 Activity feed — migrate to `SignalRow`
- Replace the hand-rolled `renderTransaction` + `txRow/txIcon/txMid` styles with the same flattened `GroupLabel`+`SignalRow` pattern used by TransactionsScreen (subtitle: `time · category · account`, node color by kind, `AmountText` right). This kills the last visual inconsistency between Home and Txns and reuses the overlap-proof row.
- Keep the Today/Yesterday/Earlier grouping memo and the `ALL TRANSACTIONS →` link.

### 3.10 Accounts carousel — restyle on kit
- Keep data/handlers. Swap card internals: `IconTile` (squared, already done) + name secondary 12 + balance in `AmountText`-style mono (fonts.signalBold 16, `colors.primary`; credit-card balances prefixed `−` in `colors.debit`). Add Account tile unchanged.

### 3.11 Upcoming commitments — restyle on kit
- Keep data/filter logic. Card: remove the left accent strip; use `IconTile` with the type color, SectionLabel-style type tag, mono amount + date, days-left pill: `colors.alertSoft`+`colors.danger` when overdue, else translucent+secondary.

### 3.12 Status footer (NEW)
Last element before bottom spacer — one mono line, size 9, `colors.muted`, centered:
`scan {relative(getLastScanTime())} · sync {relative(lastSynced)} · AI {aiModelStatus === 'ready' || 'downloaded' ? 'on-device' : 'off'}`
- `relative()`: `just now / Nm ago / Nh ago / Nd ago / never`. Each segment omitted when unknown. This quietly reassures “the machine is listening”.

### 3.13 Celebration hook (stretch, keep last)
- When any loaded goal has `currentAmount ≥ targetAmount` and a session-`useRef` set doesn't contain its id: overlay `ResonanceRings` (trigger++) over the Upcoming section + `Haptics.notificationAsync(Success)` once. Purely visual; skip if it threatens the schedule.

## 4. Data plumbing (one change)

Extend `loadData()`'s `Promise.all` with (all read-only, all cheap aggregates):
```ts
getSpendTrend(14), getCategoryBreakdown(), getBudgetUtilization(preferences.salaryDay),
getPendingSplitMembers(), getActiveInsights(), getLastScanTime()
```
New state: `trend14`, `topCategory`, `budgetWatch`, `pendingSplits`, `insight`, `lastScanAt`. Everything renders from state; no query inside render. `getHighSpendTransactions` **not** added (computed from loaded list, §3.5).

## 5. Implementation order (each step ships compiling)

1. **Data**: extend `loadData` + state (§4). Typecheck.
2. **Header greeting + hero pace line** (§3.1–3.2).
3. **Waveform block** (§3.3) — verify `WaveformBar` renders zero-days faint.
4. **Pulse strip** (§3.5).
5. **Activity → SignalRow migration** (§3.9) — delete `txRow/txIcon/txMid` styles + `renderCategoryIcon` import if unused.
6. **Insight card** (§3.6) with once-per-mount generation guard.
7. **Budget watch + Owed to you** (§3.7–3.8).
8. **Accounts + Upcoming restyle** (§3.10–3.11).
9. **Status footer** (§3.12).
10. **Celebration** (§3.13) only if all above are green.
11. Final: `npx tsc --noEmit`, then on-device pass (see §7).

## 6. Edge cases (each section must handle)

- **First run / empty DB**: no transactions → hero shows budget untouched, waveform all-faint, pulse strip `—`, activity shows the existing empty state; no crashes on `[0]` indexing (guard every `arr[0]`).
- **`monthlyBudget === 0`**: hero already falls back to cycle-spend; pace line hidden.
- **`hideAmounts`**: every new amount goes through the `••••` mask (grep for `hideAmounts` before finishing).
- **No googleUser**: greeting without name.
- **Budget watch**: hidden when no budgets or all < 60%.
- **Insights generation**: never block render; fire-and-forget with `.catch(() => {})`.
- **Long account/category names**: `numberOfLines={1}` everywhere in tiles.

## 7. Verification checklist (on device)

- [ ] Cold start with data: all sections render, no layout jumps after load
- [ ] Cold start fresh install: graceful empties
- [ ] Toggle privacy mode → every amount masked including waveform caption, pulse strip, owed-to-you
- [ ] Light theme pass (all new colors from tokens, no raw hexes except ink-on-amber pattern)
- [ ] Rows: long merchant + tags truncate, amount stays right-aligned (SignalRow)
- [ ] Insight dismiss removes card; regenerates next day only
- [ ] Waveform tap → Analytics; budget watch tap → Budget; owed tap → Finances
- [ ] Scroll perf: no jank at 60fps on the carousel + waveform screen (staggered MotiView delays capped ≤ 400ms total)

## 8. Files touched

| File | Change |
|---|---|
| `src/screens/DashboardScreen.tsx` | all sections above (only screen with real changes) |
| `src/components/Signal.tsx` | only if WaveformBar needs a `faint`-at-zero tweak |
| `src/components/Kit.tsx` | none expected (consume as-is) |

**Hard constraints for the implementer:** no writes to services/store beyond existing user actions (`dismissInsight`, `generateInsights`); every color/font from `tokens.ts`; every new block is skippable (conditional) so the screen never looks broken with sparse data.
