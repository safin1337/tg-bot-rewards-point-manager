# Telegram active-message workflows

SoulShop V2.0.2 uses a hybrid message model to reduce clutter without making
typed conversations appear out of order.

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
