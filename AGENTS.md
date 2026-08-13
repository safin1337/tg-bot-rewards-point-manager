# Permanent repository instructions

These rules are mandatory for every future coding agent working in this repository.

## Reward arithmetic

- Preserve the integer point-unit architecture. Never make floating-point points the source of truth.
- `1 point = 10,000 point units`.
- Use `APP_CONFIG` as the only runtime source of configurable reward ratios.
- Preserve the centralized `flat`/`bracketed` earning-mode switch. V2.0.5 ships
  with the bracketed policy active and point-floor protection enabled. The
  alternative flat policy remains `BDT 50 = 1 point`; never duplicate either
  policy's arithmetic in runtime code or help text.
- Purchase input remains positive whole-number BDT only. Do not add decimal or
  poisha purchase input without an explicit future requirement and design review.
- Bracketed mode is a whole-order calculation with boundaries 1-2,000 at 50:1,
  2,001-4,000 at 60:1, 4,001-6,000 at 70:1, 6,001-25,000 at 80:1, and 25,001+
  at 100:1. Never silently convert it to progressive slabs.
- Preserve the independent bracketed `pointFloorProtection` switch. When true,
  recursively protect the highest award at preceding boundaries; when false,
  use the raw selected bracket result even if it drops.
- Calculate earned purchase points with integer rational arithmetic, round
  half-up once to four decimal places, and store the resulting point units.
- Validate configured ratios, policy IDs, ordered boundaries, one final
  unbounded bracket, floor state, safe-integer arithmetic, and the supported
  database integer range.
- Validate safe-integer arithmetic and the supported database integer range.
- Reward rounding for a nonnegative balance is exactly:
  `floor((pointUnits + 20,000) / 40,000)`.
- Always recalculate rounded total reward BDT from the total point-unit balance. Never sum rounded transaction rewards.
- Manual point and redemption parsing must start from the original string and allow at most four decimal places.
- Telegram-visible point amounts must use exactly two decimal places, rounded half-up from integer point units at the third decimal place, with comma-grouped thousands.
- Display rounding must never change parsing, storage, calculations, leaderboard ranking, or exact four-decimal CSV output.
- Treat redemption-rate changes as migration-sensitive after production data
  exists. They require a reviewed D1 migration/backfill unless the database is a
  disposable test installation approved for reset.

## Required messages

- Use `APP_CONFIG` as the runtime source of the brand name, application heading,
  taglines, and reward-policy help text. Never reintroduce duplicated hardcoded
  runtime branding or earning-rate wording.
- Preserve the exact generated heading and message structure. With the default
  configuration the main heading remains `SoulShop Rewards Point System`.
- Purchase, manual-add, redemption, and balance messages must preserve these
  exact three default closing lines, generated from configurable taglines:
  `Buy More to Earn More`
  `Thank you for purchasing from us`
  `Best Wishes from SoulShop`
- Support `{brand}` substitution in every configured tagline, allow taglines to
  be independently edited/reordered, and escape all configured branding and
  tagline text before Telegram HTML insertion.
- History messages intentionally omit all three closing lines.
- Purchase and manual-add success must preserve these exact adjacent lines:
  `Your updated reward balance: {points} points`
  `Estimated reward value: BDT {value}`
- Balance messages must preserve these exact adjacent lines:
  `Your current reward balance: {points} points`
  `Estimated reward value: BDT {value}`
- Redemption must preserve these two pairs, separated by one blank line:
  `Reward amount redeemed: {points} points`
  `Equivalent reward value: BDT {value}`
  `Your remaining reward balance: {points} points`
  `Estimated remaining value: BDT {value}`
- Never use the word `Congratulations` in redemption success messages.
- Purchase success, manual-add success, and balance messages retain `Congratulations`.
- Escape every dynamic Telegram HTML value, particularly notes.

## Phone and search behavior

- Use the shared phone utility. Remove all Unicode whitespace and only these dash forms globally:
  ASCII hyphen, U+2010, U+2011, U+2012, U+2013, U+2014, U+2212.
- After cleaning, accept only digits and optionally one leading plus. Do not silently strip arbitrary punctuation or letters.
- Normalize valid Bangladesh mobile formats to `+8801...`.
- Preserve valid international E.164-style country codes. Do not guess an unprefixed international code.
- Store only normalized phones and always populate `phone_last4` and `phone_last5`.
- Suffix search accepts exactly four or five digits and queries the indexed suffix column.
- Show at most eight deterministic customer results per page.
- `Search Again` must appear on result and no-match screens, preserve the operation, clear old digits/page/selection, and rotate the state token so old results are stale.
- Treat the D1 customer ID as authoritative after selection; never trust a callback phone number.
- `Redeem All Points` must load the selected customer's exact current
  `point_balance_units` after validating the active operation, step, token, and
  customer ID. It must prepare the normal confirmation with that same value as
  `expectedBalanceUnits`; never derive a full redemption from rounded display
  text or bypass confirmation.

## Data and workflow invariants

- `/addcustomer` and newly created purchase/manual-add customers start with exactly zero point units and zero rounded reward BDT.
- Zero-point customer creation never creates a reward transaction.
- Preserve the atomic invariant: the update-ID claim, customer balance update, transaction insertion, applicable leaderboard increments, completed mutation receipt, and required retention pruning all succeed or all fail.
- Use conditional expected-balance updates and a database-level nonnegative condition.
- Keep detailed transaction insertion append-only during normal mutation creation. Controlled retention pruning atomically removes rows beyond the newest 40 per customer and their corresponding completed mutation receipts.
- Never manually delete retained transaction rows without deleting their corresponding completed mutation receipts in the same reviewed D1 batch.
- The newest-40 limit applies across `PURCHASE`, `MANUAL_ADD`, and `REDEEM` combined. Customer balances and leaderboard aggregates must never depend on retained detailed rows.
- Completed mutation receipts are bounded to the receipts corresponding to each customer's retained newest 40 transactions. Preserve the per-customer mutation update-ID high-water mark so a pruned delayed update cannot mutate a balance.
- Retain leaderboard reset receipts only when they are both within the two-calendar-month UTC window and within the latest 40 overall, ordered by timestamp then Telegram update ID descending.
- Preserve genuinely active processed-update leases. Bound eligible non-active processed updates to records both within the two-calendar-month UTC window and within the latest 40 overall.
- Customers remain unbounded. Leaderboard periods and aggregates retain the current/previous-month and current/two-previous-week policy.
- Preserve idempotency for customer creation, balance confirmations, and exports. Duplicate Telegram updates must not change balances twice.
- Do not permanently mark a destructive update completed before its required mutation succeeds.
- Validate D1 rows and conversation `payload_json`; do not trust type assertions over external data.
- Expired or stale state must never confirm a transaction.
- Persist the active operation's starting Telegram update ID and reject older delayed messages or callbacks so they cannot continue or replace a newer operation.
- `/restart` preserves the operation but clears collected values. `/cancel` clears state.
- Answer every callback promptly, including unauthorized callbacks.
- Button-only transitions, confirmation results, search/history pagination, and leaderboard navigation normally edit the callback's bot message. Treat `message is not modified` as success and use one send-message fallback when editing is unavailable.
- Complete a database mutation before displaying success. An edit failure after commit must never repeat or misreport the mutation; keep enough temporary state for an idempotent retry until the success display is delivered.
- Bind each pending purchase confirmation to the earning-policy identifier used
  for its displayed calculation. The fingerprint must cover the active mode,
  relevant rate/brackets, point-floor state, and four-decimal rounding policy.
  If the configured earning policy changes,
  clear/restart the stale workflow before any receipt, balance, transaction, or
  leaderboard mutation.
- After typed administrator input, send the next bot response as a new message when editing an older bot message would break chronological order. Never edit administrator messages or document messages.

## Security and privacy

- This bot remains restricted to one `ADMIN_TELEGRAM_ID`, compared as a string before customer queries, mutation, history, or export.
- Require an exact `X-Telegram-Bot-Api-Secret-Token` match on the webhook.
- Never hardcode, log, export, test-fixture-copy, or commit real `BOT_TOKEN`, `WEBHOOK_SECRET`, `ADMIN_TELEGRAM_ID`, Cloudflare credentials, or customer data.
- Never log complete Telegram updates, phone numbers, or notes. Mask phones in any necessary diagnostics.
- Store all timestamps in UTC ISO 8601 and display with `Intl.DateTimeFormat` in `Asia/Dhaka`; never manually add six hours.
- CSV must use UTF-8, RFC-style quoting, spreadsheet formula-injection protection, and configured row/byte limits.
- CSV and SQL backups contain private data and must remain ignored by Git.
- Do not deploy, register a webhook, or call production-mutating setup scripts unless the user explicitly requests it.

## Migration and repository discipline

- D1 migrations are versioned under `migrations/` and must remain trackable despite the global `*.sql` ignore.
- Keep non-secret application customization centralized in
  `src/config/app-config.ts`; never put secrets or production infrastructure
  identifiers in `APP_CONFIG`.
- Never rewrite a previously deployed migration. Add a new migration.
- Avoid compound `CREATE TRIGGER ... BEGIN ... END` statements in Wrangler-managed remote D1 migrations unless they have been verified against an isolated remote D1 database; keep required retention enforcement in explicit atomic batch statements.
- Preserve existing customer balances during schema changes. Before approved retention pruning, backfill existing detailed history into mutation receipts, mutation update-ID high-water marks, and applicable leaderboard aggregates.
- Keep business logic independent of Telegram transport and SQL inside repositories/migrations.
- Use strict TypeScript and validated `unknown` for external inputs. Avoid `any`.
- Do not leave required production paths as placeholders or TODOs.

## Required validation before completion

Run all commands and fix every failure:

```powershell
npm run db:migrate:local
npm run check
```

The `check` script must run the same individual quality gates below. When
diagnosing failures, run and fix them separately:

```powershell
npm run typecheck
npm run lint
npm run test:run
npm run build
```

Then inspect:

```powershell
git check-ignore -v .dev.vars
git check-ignore -v migrations/0001_initial_schema.sql
git status --short
```

Confirm no real secret, generated CSV, backup, `.dev.vars`, `.env`, Wrangler state, coverage, or build artifact is tracked.
