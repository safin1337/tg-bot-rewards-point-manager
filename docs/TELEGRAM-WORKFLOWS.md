# Telegram active-message workflows

V2.1.0 uses a hybrid message model to reduce clutter without making
typed conversations appear out of order.

The brand name, main heading, closing taglines, leaderboard headings, help
policy text, and CSV prefix derive from `src/config/app-config.ts`. Configurable
values are HTML-escaped before Telegram insertion. With the default settings,
the generated heading remains `SoulShop Rewards Point System`.

## Dashboard and More Tools

- `/start` loads fresh D1 totals for included customers, current point units,
  lifetime redemption count, and lifetime redeemed point units. Each estimated
  BDT value is recalculated once from its combined unit total.
- The compact dashboard keeps Record Purchase and Check Balance, Redeem Points
  and Leaderboard, Customer History and Add New Customer, then one full-width
  `More Tools` button.
- `More Tools` and `/tools` show Manage Customer Identities, Manage Test
  Accounts, Add Points Manually, Export Data, Help, and Back to Dashboard on
  separate full-width rows. Direct legacy commands remain routable even when
  omitted from BotFather's shorter visible command list.
- `/testaccounts` opens Manage Test Accounts directly. The visible Telegram
  command menu is `/start`, `/purchase`, `/quickbuy`, `/redeem`,
  `/testaccounts`, `/tools`, `/restart`, and `/cancel`; commands omitted from
  that suggestion list remain manually routable and stay in `/help`.

## Quick Buy

- `/quickbuy` starts a dedicated `AWAIT_QUICK_PURCHASE` step inside the normal
  purchase operation. `/restart` returns to that same step instead of opening
  customer-search choices.
- The administrator must send exactly two non-empty lines: a complete WhatsApp
  phone first and a positive whole-number BDT purchase amount second. The phone
  uses the shared Unicode-whitespace and supported-hyphen normalization rules;
  the amount accepts digits only.
- The complete message, normalized phone, amount, and calculated point units
  are validated before a customer lookup or write. Any validation failure keeps
  the workflow active and creates no customer, point mutation, transaction,
  receipt, or leaderboard entry.
- An exact normalized phone match is authoritative. With no match, the Worker
  idempotently creates a normal phone-only customer at zero points, then records
  the purchase. WhatsApp and Telegram usernames are not accepted and
  username-only customers are never inferred or merged.
- There is intentionally no confirmation panel. The purchase still uses the
  centralized earning-policy calculation and complete atomic reward mutation,
  expected-balance, high-water-mark, receipt, leaderboard, and retention path.
- State is cleared only after the normal purchase-success receipt is delivered.
  A Telegram retry after commit reuses the completed receipt and cannot assign
  points twice. An interruption between customer creation and mutation can
  leave only a valid zero-balance customer, which the retry safely reuses.

## Non-text Telegram updates

- Text messages and inline-button callbacks continue through their existing
  command, workflow, stale-update, authorization, and idempotency checks.
- A structurally valid message without a `text` field is normalized to only its
  update ID, message ID, sender ID, and chat ID. Photos, documents, stickers,
  video, video notes, animation, audio, voice, contacts, locations, captions,
  file identifiers, and all other media metadata are not retained, downloaded,
  logged, or stored.
- Media captions are never commands or workflow values. A photo captioned
  `/cancel`, for example, does not cancel the operation.
- For the authorized administrator, the Worker attempts one informational
  response explaining that text or buttons are required. The active operation,
  step, state token, operation-start update ID, selected customer, collected
  values, balances, transactions, receipts, and leaderboards remain unchanged.
- The valid non-text update receives HTTP `200` even if that informational
  `sendMessage` fails. Only safe update ID/type and sanitized Telegram
  method/status/category metadata may be logged, and no second failure message
  is attempted. This prevents Telegram retries from delaying later commands.
- The administrator can immediately send the expected text, use an available
  inline button, or use `/cancel`. `/start`, `/restart`, and operation commands
  also continue normally after non-text input.
- Valid irrelevant update types, such as older edited-message or channel-post
  deliveries, receive HTTP `200` without workflow or D1 processing. Invalid
  JSON, invalid update IDs, and malformed message/callback envelopes remain
  non-2xx requests. Webhook-secret and payload-size checks are unchanged.

## Customer-selection context

- Record Purchase, Add Points Manually, Redeem Points, Check Balance, Customer
  History, Manage Customer Identities, and Manage Test Accounts selection
  panels show the active operation as a bold,
  emoji-prefixed heading between the configured application heading and
  `Select a customer:`.
- Record Purchase uses the `🛍️` emoji on the dashboard, selection heading, and
  customer-actions panel.
- Search options include WhatsApp last 4/5 digits, full WhatsApp number, exact
  WhatsApp username, and exact Telegram username. Each input panel starts with
  `Selected Operation: {emoji} {operation}`.
- The suffix prompt is exactly:

  ```text
  Enter the last 4 or 5 digits of the WhatsApp No.
  Telegram / WhatsApp Username are not accepted
  ```

- The full-number prompt is exactly:

  ```text
  Enter the customer's WhatsApp number:
  Spaces and hyphen are accepted.
  ```

- The WhatsApp-username and Telegram-username prompts are exactly:

  ```text
  Enter the customer's WhatsApp username:

  Enter the customer's Telegram username:
  ```

- Add New Customer first asks for an initial identifier type, then validates and
  confirms that phone or username before creating the zero-point customer.
- Dashboard callbacks, matching slash commands, and `/restart` use the same
  operation-aware selection panel.

## Customer identity management

- `/managecustomer` and the customer-actions panel open the same identity
  manager after the D1 customer ID is selected.
- One current WhatsApp phone, WhatsApp username, and Telegram username may be
  attached to a customer. At least one must remain.
- A single leading `@` is discarded from username input. Display capitalization
  is preserved, while exact lookup and uniqueness are case-insensitive.
  WhatsApp additionally accepts non-leading, non-trailing, non-consecutive
  periods; Telegram rejects periods.
- Recognized Unicode bidirectional formatting controls are removed before
  whitespace trimming, optional-`@` removal, length checking, and platform
  validation. Other invisible characters remain invalid. Invalid input keeps
  the same active input step so the next valid value succeeds without restart.
- A change/removal confirmation stores the exact current value it displayed.
  The SQL update includes that expected value, so a later or concurrent edit is
  rejected as stale rather than overwritten.
- An identifier owned by a compatible second customer opens
  `CONFIRM_CUSTOMER_MERGE`, showing both IDs, identifiers, balances, and the
  combined result. `Confirm Merge` keeps the selected customer's ID. Back and
  Cancel change no customer data. Conflicting same-platform identities and
  mixed test/normal accounts return to management with an explanation.
  Invalid values remain at input. The last alias cannot reach a removal mutation.
- A committed identity change is harmless to retry: if Telegram display fails,
  the repository recognizes that the requested value is already current.
- Ordinary identity edits change only alias columns and `updated_at_utc`; reward
  balances, transactions, receipts, and leaderboard aggregates are untouched.
- A confirmed merge combines exact units, moves retained transactions and
  receipts, combines leaderboard aggregates by period and reset generation,
  and removes the absorbed customer in one atomic batch. Both customer
  snapshots and the active workflow must still match the preview. A durable
  receipt permits retry after a committed merge's success display fails.
  Details and upgrade instructions are in [Customer Merging](CUSTOMER-MERGING.md).

## Split and Reset Points

- Identity management shows `Split and Reset Points` for accounts with at least
  two current identifiers, including accounts assembled by adding aliases.
- Its confirmation shows all identities, the balance to erase, and the number
  of resulting zero-point accounts. The merge confirmation also warns that
  later splitting erases points and does not restore old balances.
- `Confirm Split and Reset` separates every current identity. The existing ID
  keeps its WhatsApp phone, or its WhatsApp username when there is no phone,
  along with retained history. Detached usernames receive new zero-point IDs.
- Both normal and test accounts preserve their classification. Leaderboard
  earnings are cleared; lifetime redemption totals remain unchanged.
- Back rotates the token and discards the preview; Cancel exits without writes.
  Confirm validates the active state and customer snapshot inside one atomic
  batch. Success state stays until delivery; retries cannot erase later earnings.
- Ordinary Remove Identifier still only removes an alias; it is not a split.

## Test-account management

- The administrator selects an existing customer through the normal four
  search methods. Workflow state stores the authoritative D1 customer ID.
- Mark/convert confirmation rotates the token and stores the exact displayed
  classification. A stale button cannot overwrite a newer decision, and a
  display retry after commit is harmless.
- Marking an account preserves its balance and retained transactions. With the
  default exclusion policy, it atomically removes that customer's retained
  leaderboard aggregates.
- Test accounts remain usable for purchase, manual addition, redemption,
  balance, and history. Customer-specific blocks visibly show
  `🧪 Test Account`.
- Conversion to a normal customer is blocked until exact
  `point_balance_units` is zero. `Redeem All Points` remains available while
  the account is test, and that redemption is excluded from lifetime business
  totals by default.
- Classification affects future activity. Existing test history is never
  deleted or retroactively added to the lifetime summary.

## Customer Info presentation

- Full customer-specific balance, confirmation, success, history,
  existing-customer, and identity-management messages use one shared block:

  ```text
  Customer Info:
  WhatsApp Number: +880...
  WhatsApp Username: @Example_Name
  Telegram Username: @Example_Name
  ```

- Lines appear only for identifiers that exist, always in the order shown.
  Stored capitalization is preserved, dynamic values are HTML-escaped, and no
  `Not provided` or empty identifier line appears.
- Search results, short selection panels, and purchase/manual-add amount-entry
  prompts retain the compact primary identifier order: WhatsApp number,
  WhatsApp username, then Telegram username. Leaderboards use that same priority
  with `WA`/`TG` username labels and append `(+1 alias)` or `(+2 aliases)` beside
  the points when other identifiers exist.

## Latest earning transaction context

- After customer selection, the Record Purchase and Add Points amount-entry
  panels load the newest retained `PURCHASE` or `MANUAL_ADD`, ordered by
  `created_at_utc DESC, id DESC`. `REDEEM` rows are skipped.
- The display uses Asia/Dhaka time and two-decimal point formatting. A purchase
  shows `Purchase Amount: BDT {amount}` with exactly two decimals and
  Bangladeshi lakh/crore grouping. A manual addition shows
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

- Purchase results use `Updated reward balance` followed by
  `Estimated reward value: *BDT {value}*`.
- Manual-add and balance results use `Current reward balance` followed by
  `Estimated reward value`.
- Redemption results use `Reward amount redeemed` and `Equivalent reward value`,
  then one blank line before `Your remaining reward balance` and
  `Estimated remaining value`.
- These are exact message contracts. Purchase, manual-add, redemption, and
  balance messages start with the configured application heading wrapped in
  literal `*` markers so pasted WhatsApp text renders it in bold. Their
  configured closing taglines use a visible `> ` prefix for WhatsApp blockquote
  formatting. Other Telegram screens retain their HTML-bold heading, history
  continues to omit all taglines, and the Congratulations rules and reward
  calculations remain unchanged.

The purchase-success receipt uses literal WhatsApp formatting markers as an
exact presentation contract. Its application heading and `🎉 Congratulations!`
line use `*` markers. `Customer Info:` and each identifier, purchase amount, and
points-earned line use their own pair of backticks, with no blank line between
`✅ Purchase Successfully Recorded` and `Customer Info:`. The complete `BDT
{value}` portion of the estimated reward line also uses `*` markers.

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

Every callback acknowledgement request starts immediately. For an authorized
callback it runs concurrently with state loading and navigation, and both
promises remain awaited before the webhook response; there are no floating
promises. Sensitive confirmations refresh state again before customer,
classification, reset, export, or reward mutation. Authorization,
operation-start update IDs, and rotated state tokens are checked before any
customer query or mutation.

Conversation-state start/save operations use one conditional SQL statement
with `RETURNING` for the write and validated read-back. Saves match the
operation start ID and a strictly advancing state-version timestamp so
concurrent stale navigation cannot overwrite a newer transition. This removes
one D1 network round trip without caching request state globally or moving a
required mutation or success delivery into background work.

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
