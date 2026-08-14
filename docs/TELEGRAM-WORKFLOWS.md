# Telegram active-message workflows

V2.0.5 uses a hybrid message model to reduce clutter without making
typed conversations appear out of order.

The brand name, main heading, closing taglines, leaderboard headings, help
policy text, and CSV prefix derive from `src/config/app-config.ts`. Configurable
values are HTML-escaped before Telegram insertion. With the default settings,
the generated heading remains `SoulShop Rewards Point System`.

## Customer-selection context

- Record Purchase, Add Points Manually, Redeem Points, Check Balance, and
  Customer History selection panels show the active operation as a bold,
  emoji-prefixed heading between the configured application heading and
  `Select a customer:`.
- Record Purchase uses the `🛍️` emoji on the dashboard, selection heading, and
  customer-actions panel.
- After `Search by Last Digits` or `Enter Full Number` is selected, the next
  panel starts with `Selected Operation: {emoji} {operation}`, followed by one
  blank line and the relevant number-entry prompt.
- The suffix prompt is exactly:

  ```text
  Enter the last 4 or 5 digits of the WhatsApp No.
  Telegram / WhatsApp Username are not accepted
  ```

- The full-number prompt is exactly:

  ```text
  Enter the full WhatsApp number.
  Spaces and hyphens are accepted.
  ```

- The Add New Customer prompt is separate and remains unchanged.
- Dashboard callbacks, matching slash commands, and `/restart` use the same
  operation-aware selection panel.

## Latest earning transaction context

- After customer selection, the Record Purchase and Add Points amount-entry
  panels load the newest retained `PURCHASE` or `MANUAL_ADD`, ordered by
  `created_at_utc DESC, id DESC`. `REDEEM` rows are skipped.
- The display uses Asia/Dhaka time and two-decimal point formatting. A purchase
  shows `Purchase Amount: BDT {amount}`. A manual addition shows
  `Reason: {note}` when a note exists, with the note HTML-escaped.
- If no eligible retained row exists, the exact text is
  `No Prior Data Found!`.
- The lookup is read-only and limited to the existing newest 40 retained
  transactions. It never changes a balance, creates a transaction, or affects
  confirmation and mutation rules.

## Point display

- Every Telegram-visible point amount uses exactly two decimal places.
- Whole-number groups use commas, for example `1,356.70 points`.
- Rounding is standard half-up at the third decimal digit: values below five
  leave the second digit unchanged, while five or above increases it by one.
- Formatting is derived directly from integer point units. It does not change
  input precision, stored balances, reward calculations, leaderboard ranking,
  or exact CSV export values.
- The rule applies to prompts, confirmations, success and balance messages,
  insufficient-balance notices, customer details, history, and leaderboards.

## Purchase earning modes

- `/purchase` continues to accept positive whole-number BDT only. Decimal input
  remains invalid.
- Flat mode uses the one configured ratio for every purchase. Bracketed mode
  selects one rate for the complete amount; it is not a progressive slab.
- V2.0.5 ships with bracketed mode active and point-floor protection enabled;
  flat mode remains available through the centralized configuration.
- Optional point-floor protection prevents a later bracket from dropping below
  the recursively protected award at preceding boundaries. With protection
  disabled, the raw bracket result is used even when it drops.
- Earned points are calculated with integer rational arithmetic and rounded
  half-up once to four-decimal point-unit precision before confirmation. The
  existing two-decimal Telegram format is presentation only.
- Each confirmation carries a fingerprint of the active mode, rates,
  boundaries, floor state, and rounding policy. A mismatch clears the workflow
  before any receipt, balance, transaction, or leaderboard mutation.

## Redeem All Points

- After a customer is selected for redemption, the amount prompt offers
  `Redeem All Points` in addition to typed partial redemption.
- The callback contains only the current state token. The Worker validates the
  active `REDEEM` operation, `AWAIT_POINT_AMOUNT` step, selected D1 customer ID,
  and token before loading the latest customer row.
- The prepared redemption amount and expected balance both use the exact stored
  `point_balance_units`. They never use the two-decimal Telegram display text,
  so a balance such as 1,300.6965 points can display as 1,300.70 and still be
  redeemed completely without leaving or over-requesting hidden precision.
- Pressing the button only prepares the existing confirmation panel. Points
  change only after `Confirm Redemption`, through the same atomic,
  expected-balance, and idempotency protections as a typed redemption.
- If the balance changes before confirmation, the mutation is rejected and the
  operation must restart. A zero balance cannot create a redemption.

## Success and balance labels

- Purchase and manual-add results use `Your updated reward balance` followed by
  `Estimated reward value`.
- Balance checks use `Your current reward balance` followed by
  `Estimated reward value`.
- Redemption results use `Reward amount redeemed` and `Equivalent reward value`,
  then one blank line before `Your remaining reward balance` and
  `Estimated remaining value`.
- These are exact message contracts. The existing headings, Congratulations
  rules, closing lines, and reward calculations remain unchanged.

## Editing rules

- A new slash command sends a new active panel.
- The first operation panel uses `Cancel` to clear the operation and return to
  the dashboard. Screens below that level also show `Back`.
- Customer-search prompts, results, no-match screens, history, and missing-
  customer screens use the compact button label `⬅️ Back`.
- `Back` preserves the active operation and returns one logical step: customer
  input/results return to Search Options, transaction confirmation returns to
  amount or note entry, and customer-creation confirmation returns to number
  entry.
- Every Back transition clears data collected after its destination and rotates
  the state token. Buttons from the abandoned screen are therefore stale and
  cannot confirm a transaction or create a customer.
- A button-only transition normally edits the bot message containing the
  pressed button.
- Add-customer, purchase, manual-add, redemption, and leaderboard-reset
  confirmations become their success result only after the database operation
  commits. Confirmation buttons are removed or replaced with current actions.
- History pages, customer-result pages, Search Again, balance/customer actions,
  and leaderboard navigation reuse the callback message ID.
- Callback cancellation replaces the active panel with the cancellation result.
- After administrator typed input, the next prompt/result is sent as a new
  message when editing the older panel would place it above that input.
- Administrator messages and Telegram document messages are never edited.

## Failure and idempotency behavior

`editMessageText` responses are validated. Telegram's `message is not modified`
error is treated as a completed display operation. A deleted, inaccessible, or
non-editable source message and other Telegram API edit failures fall back to
one `sendMessage` call. If a callback has no accessible message, the private
administrator chat is the safe fallback target.

For a committed mutation, temporary confirmation state is cleared only after
the edit or fallback succeeds. If both Telegram calls fail, Telegram may retry
the callback while the state still exists; customer creation IDs, mutation
receipts/high-water marks, and reset receipts make that retry idempotent. The
business operation is never run again or described as failed merely because
its success display could not be delivered.

Every callback is answered before workflow database work, including
unauthorized, stale, duplicate, malformed, expired, and missing-message
callbacks. Authorization, operation-start update IDs, and rotated state tokens
are checked before any customer query or mutation.

## Earning-policy deployment boundary

Every prepared purchase confirmation stores the earning-policy identifier used
to calculate its displayed point amount. When a new Worker changes that policy,
an older pending confirmation has a missing or different identifier. Its
callback is still acknowledged promptly, but the workflow is cleared and the
confirmation is replaced with a policy-changed warning plus dashboard actions.

This check occurs before mutation service execution. It changes no customer
balance, transaction, leaderboard aggregate, or completed mutation receipt.
The administrator must restart the purchase so the next confirmation displays
and commits the same point amount under the current policy.
