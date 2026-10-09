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
  `> Buy More to Earn More`
  `> Thank you for purchasing from us`
  `> Best Wishes from SoulShop`
- Support `{brand}` substitution in every configured tagline, allow taglines to
  be independently edited/reordered, and escape all configured branding and
  tagline text before Telegram HTML insertion. Add the visible quote prefix at
  the insertion boundary; never require it in `APP_CONFIG`.
- Purchase, manual-add, redemption, and balance messages must start with the
  escaped configured application heading wrapped in literal WhatsApp bold
  markers. The default first line is exactly
  `*🏆 SoulShop Rewards Point System*`. Other Telegram screens retain the
  native HTML-bold heading without literal asterisks.
- History messages intentionally omit all three closing lines.
- Telegram-visible `Purchase Amount: BDT ...` fields use exactly two decimals
  and Bangladeshi lakh/crore grouping. This must never change positive
  whole-number input, D1 integer storage, reward arithmetic, or CSV values.
- Purchase success must preserve these exact adjacent lines:
  `Updated reward balance: {points} points`
  `Estimated reward value: *BDT {value}*`
- Manual-add success and balance messages must preserve these exact adjacent
  lines:
  `Current reward balance: {points} points`
  `Estimated reward value: BDT {value}`
- Purchase success must use the exact WhatsApp-ready presentation contract:
  `✅ Purchase Successfully Recorded` is plain text; `Customer Info:` plus each
  identifier, purchase amount, and points-earned line is independently wrapped
  in literal backticks; `*🎉 Congratulations!*` is wrapped in literal bold
  markers; and there is no blank line between the success title and the first
  backtick-wrapped detail line.
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
- `/quickbuy` accepts exactly two non-empty lines: a complete WhatsApp phone
  accepted by the shared phone utility, then a positive whole-number BDT amount
  containing digits only. It never accepts suffixes, WhatsApp usernames, or
  Telegram usernames and never infers or merges a username-only customer.
- Validate the entire Quick Buy input and calculate its point units before any
  customer lookup, customer creation, or reward write. Invalid input stays at
  `AWAIT_QUICK_PURCHASE` and must use this exact response:

  ```text
  ⚠️ Invalid input.
  Send the WhatsApp number on first line and
  purchase amount on the next line.

  No customer was created and no points were assigned.
  ```

## Data and workflow invariants

- Customer merging is an explicit confirmed action within identity management.
  Keep the selected customer ID, combine exact units, and recalculate reward
  BDT once. Reject overlapping identifier slots and mixed test/normal accounts.
- Merge customer snapshots, active-state validation, durable merge receipt,
  history/receipt reassignment, leaderboard combination, source removal,
  combined newest-40 pruning, and integrity guards in one atomic D1 batch.
  Preserve historical balance snapshots and combine leaderboard earnings only
  by their original period key and reset generation.
- Preserve `customer_merge_receipts` redirects for absorbed creation update IDs
  and chained merges. Never redirect ordinary `findById` calls from a removed
  ID; stale workflow selections must fail. Advance the surviving mutation
  high-water mark through the merge update and invalidate other selected states.
- Keep merge confirmation state until success delivery. Its receipt must
  prevent duplicate balance addition after a display failure or concurrent retry.
- Split and Reset Points separates every current identifier into its own
  zero-balance customer after explicit confirmation. Keep the primary phone,
  otherwise WhatsApp username, on the existing ID with its history/receipts.
  Preserve account classification and lifetime redemption totals; clear the
  selected customer's leaderboard earnings. Never describe this as redemption.
- Claim a durable split receipt, validate the customer/workflow snapshots,
  reset balance/reward BDT, detach and create identities, advance all resulting
  mutation high-water marks, invalidate other selected workflows, and verify
  integrity in one atomic batch. Retries must not reset subsequent earnings.
- Both merge and split confirmations must warn that splitting erases points
  and does not restore previous balances. Split confirmation shows erased units.

- `/addcustomer` and newly created purchase/manual-add customers start with exactly zero point units and zero rounded reward BDT.
- Zero-point customer creation never creates a reward transaction.
- When Quick Buy has no exact normalized phone match, create one normal,
  phone-only customer at zero point units and then use the normal purchase
  mutation pipeline. Quick Buy intentionally omits confirmation, but it must
  retain every validation, earning-policy, expected-balance, idempotency,
  leaderboard, retention, and atomic mutation guarantee.
- Keep Quick Buy state until its final purchase receipt is delivered. A retry
  after commit must reuse the completed mutation receipt and never assign
  points twice. An interruption between customer creation and mutation may
  leave the valid zero-balance customer for an idempotent retry; do not delete
  or merge it automatically.
- Preserve the atomic invariant: the update-ID claim, customer balance update,
  transaction insertion, applicable leaderboard increments, applicable
  lifetime-redemption snapshot, completed mutation receipt, and required
  retention pruning all succeed or all fail.
- Use conditional expected-balance updates and a database-level nonnegative condition.
- Keep detailed transaction insertion append-only during normal mutation creation. Controlled retention pruning atomically removes rows beyond the newest 40 per customer and their corresponding completed mutation receipts.
- Never manually delete retained transaction rows without deleting their corresponding completed mutation receipts in the same reviewed D1 batch.
- The newest-40 limit applies across `PURCHASE`, `MANUAL_ADD`, and `REDEEM` combined. Customer balances and leaderboard aggregates must never depend on retained detailed rows.
- Retain only the newest 40 cumulative lifetime-redemption snapshots globally.
  The newest row is the lifetime count and redeemed-point source of truth;
  never reconstruct it from retained detailed transactions or sum individually
  rounded reward BDT values.
- Test-account membership belongs in `customers.is_test`; never hardcode
  customer identifiers in `APP_CONFIG`. Preserve test balances and history.
  Under the default switches, exclude test accounts from dashboard totals,
  leaderboards, and future lifetime-redemption snapshots. Conversion to normal
  requires an exact zero point-unit balance and never backfills test activity.
- Record Purchase and Add Points amount-entry prompts show the newest retained
  `PURCHASE` or `MANUAL_ADD`, ordered by `created_at_utc DESC, id DESC`, while
  skipping `REDEEM`. Show the purchase amount for purchases, show the escaped
  note for manual additions when present, and use the exact fallback
  `No Prior Data Found!` when no eligible retained row exists. This context is
  informational and must never affect balances, mutations, or retention.
- Completed mutation receipts are bounded to the receipts corresponding to each customer's retained newest 40 transactions. Preserve the per-customer mutation update-ID high-water mark so a pruned delayed update cannot mutate a balance.
- Retain leaderboard reset receipts only when they are both within the two-calendar-month UTC window and within the latest 40 overall, ordered by timestamp then Telegram update ID descending.
- Leaderboard rows remain one logical line and use the exact primary-identifier
  priority of WhatsApp number, WhatsApp username, then Telegram username.
  Username labels are `WA @Username` and `TG @Username`; append `(+1 alias)` or
  `(+2 aliases)` beside `pts` when additional identifiers exist.
- Preserve genuinely active processed-update leases. Bound eligible non-active processed updates to records both within the two-calendar-month UTC window and within the latest 40 overall.
- Customers remain unbounded. Leaderboard periods and aggregates retain the current/previous-month and current/two-previous-week policy.
- Preserve idempotency for customer creation, balance confirmations, and exports. Duplicate Telegram updates must not change balances twice.
- Do not permanently mark a destructive update completed before its required mutation succeeds.
- Validate D1 rows and conversation `payload_json`; do not trust type assertions over external data.
- Expired or stale state must never confirm a transaction.
- Persist the active operation's starting Telegram update ID and reject older delayed messages or callbacks so they cannot continue or replace a newer operation.
- `/restart` preserves the operation but clears collected values. `/cancel` clears state.
- Preserve tokenized `Back` navigation below the first operation panel. Back
  keeps the active operation, clears fields collected after the destination,
  rotates the state token, and never bypasses confirmation or performs a data
  mutation. Cancel remains the dashboard exit.
- Answer every callback promptly, including unauthorized callbacks.
- Start authorized callback acknowledgement concurrently with routing, but
  always await the complete routing path. An acknowledgement failure must not
  abandon, repeat, or misreport an in-flight workflow or mutation, and logs
  must contain no callback data or customer identifiers.
- Reuse one validated conversation-state read for ordinary callback navigation.
  Refresh state immediately before confirmations, customer creation, test
  classification, identity changes, exports, or other sensitive work. Use
  conditional state saves/deletes so stale callbacks cannot overwrite or clear
  a newer operation; combine required write/read state transitions in one
  conditional statement with a validated `RETURNING` row where supported.
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
