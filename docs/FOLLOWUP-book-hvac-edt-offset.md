# Follow-up: hardcoded EDT offset in book-hvac.js

**Status:** deferred — intentionally NOT fixed in the Mechanical isolation PR.

## Issue
`functions/book-hvac.js` converts the caller's requested local time to UTC using a
**hardcoded `etOffset = -4` (EDT)** in two places:

- inside `createCalendarEvent()` (calendar event start time), and
- inside the 18-hour advance-notice check in `exports.handler`.

Because the offset is fixed at `-4`, appointments booked during **Eastern Standard
Time** (roughly early November → mid-March, offset `-5`) are computed **one hour
off**. This affects both the calendar event time and the advance-notice boundary.

## Why it's deferred
The isolation PR is scoped to swapping providers (Telnyx / Mechanical calendar /
Mechanical Supabase / Mechanical email) while preserving the exact Vapi request
and response contract and the existing date-parsing behavior. Changing the
timezone math would alter booking times and is a separate, testable change.

## Proposed fix (separate PR)
Compute the real America/New_York offset for the specific date (handling DST),
e.g. via `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ... })`
or a small tz helper, and replace both `etOffset = -4` sites. Add tests covering
a summer (EDT) and a winter (EST) date.
