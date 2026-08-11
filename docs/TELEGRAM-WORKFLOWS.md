# Telegram active-message workflows

V2.0.4 uses a hybrid message model to reduce clutter without making
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
- The Add New Customer prompt is separate and remains unchanged.
- Dashboard callbacks, matching slash commands, and `/restart` use the same
  operation-aware selection panel.

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
