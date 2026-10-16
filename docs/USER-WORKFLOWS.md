# User workflows

How each kind of person moves through PlacesSync, step by step, as the code at this commit behaves. It covers the local build. Production was deployed on 2026-10-15 before the changes listed at the end and has not been redeployed since, so the deployed app still behaves as [`DEMO.md`](DEMO.md) describes. Labels in quotes are the exact text on screen.

The people are the synthetic ones the seed creates: 92 employees, 6 facilities staff and 2 facilities admins (`CONTEXT.md`). Staff and admins can do everything an employee can.

## Developer or presenter running it locally

**First run.**

1. `npm ci`, `npm run setup:dev`, `npm run build`, then `npm run preview` (http://localhost:8783), as the README's "Run it locally" says.
2. Open http://localhost:8783. If the database has no tables yet, the page says "Could not load PlacesSync: The local database has no tables yet. Run npm run db:migrate:local, then reload." Run it, then press "Try again" ("Check again" on the sign-in page).
3. Without a sign-in you land on "Sign in (local development)". If the tables exist but nobody is seeded, it says "No synthetic employees yet. Run npm run seed:local in another terminal, then press Check again." Run it, then press "Check again"; the "Quick picks" appear without a page reload.
4. Pick a quick pick (one admin, one staff member, one employee) or type a name in "Employee" and press "Sign in". You return to the page you asked for, or to Find a space.

**Switching persona.** Press "Sign out" in the header, then pick someone else. Opening `/login` while signed in shows "Signed in as <name>." and a "Continue as <name>" link back to where you were.

**When a sign-in expires.** The dev token lasts 8 hours. The next action that the server refuses with 401 sends you to the sign-in page, and signing in returns you to the same page and search.

## Employee

**Book a desk for an hour.**

1. Open "Find a space". It opens on the first date that can still be booked: after the day's last slot it shows the next working day and says "Bookings for today have closed; showing <date>."
2. Optionally choose the "Desks" tab, a floor, seats, amenities, a time window or a search. Every choice is kept in the address, so a reload or Back from a week calendar shows the same search.
3. Click a start time in a desk's row. One click selects an hour (desks book for at least 60 minutes; rooms for at least 15, so one click on a room selects 30 minutes). Shift+click a later time to make it longer.
4. Press "Book <desk>, <start> to <end>". The dialog "Book <desk>" opens with "Confirm booking" focused.
5. Press "Confirm booking". The dialog closes and a result appears at the top of the page, with focus on it: "Booked <desk> on <date>, <start> to <end>." with a "See My bookings" link.

**Book a meeting room.** The same steps on the "Rooms" tab. The dialog also asks for "Attendees" (up to the room's capacity) and an optional "Meeting title".

**Book from a week calendar.**

1. On Find a space open "Week calendars" and choose a space, or use "See the week calendar for <space>" in the booking dialog. The week shown is the one with the date you were looking at.
2. Rows are days. Past days, weekends and days beyond the 14-day horizon are drawn muted, unlike booked time, and their cells are named "past", "closed" or "not open for booking yet".
3. Select a time and book as above. "Previous week", "Next week" and "Jump to week" change the week; "Back to Find a space" returns to a date in the week you are looking at.

**When someone else books the same time first.**

- If it happens while you are still choosing, your selection clears and a note beside the Book button says "<start> to <end> on <space> was just booked by someone else. Pick another time."
- If it happens after you press "Confirm booking", the dialog says "Someone else booked this first: <time> is taken. The grid has been refreshed; pick another time." Press "Pick another time": the dialog closes and focus goes back to that space's row in the grid.
- If you already hold a desk (or a room) at that time, the dialog says "You already have a desk booked at that time" with a "See my bookings" link, and "Confirm booking" stays disabled.

**Cancel a booking.**

1. Open "My bookings" (Upcoming, Past and Cancelled tabs).
2. Press "Cancel booking" on the row. The dialog "Cancel this booking?" opens on "Keep booking".
3. Optionally give a reason, then press "Cancel booking". The row moves to Cancelled, and the result "Cancelled <space> on <date>." appears with a "Find a space" link.
4. A space an admin deactivated after you booked it still shows its name, marked "(not bookable now)".

**Report an issue and follow it.**

1. Open "Report issue", give a title and a description, and optionally a space or a location note. Press "Submit request".
2. The request page opens and says it was submitted. While it shows "Classification pending", the page checks again every 10 seconds for up to 3 minutes while it is visible, and "Check again" checks at once.
3. When a suggestion arrives, the page shows the suggested category with the provider that made it, then the final category once staff review it. The timeline lists every step, including a note staff leave when they resolve it.
4. To cancel before anyone picks it up, press "Cancel this request", then "Cancel request" in the dialog ("Keep request" closes it). If staff picked it up a moment earlier, the reason ("Only a request that nobody has picked up can be cancelled.") appears under the button and the request stays on screen.
5. "My requests" lists open and closed requests.

**On a phone (under 640 px wide).**

1. Find a space shows the date picker, then a "Filters" button (with "Filters (2 active)" when filters are set, and "Clear filters" inside), then the time chips for one space at a time.
2. Choose a space in "Resource" and tap a start time; tap a later time to extend, or a time inside the selection to shorten it. "Clear selection" removes it.
3. The Book button stays visible above the bottom navigation while you scroll the chips.
4. Between 640 and 1023 px the filters fold the same way and the full grid shows. At 1024 px and wider the filters sit beside the grid.

**With the keyboard or a screen reader.**

- On Find a space the second Tab stop is "Skip to availability" ("Skip to week grid" on a week calendar); Enter, then Tab, puts focus in the grid.
- In the grid the arrow keys move, Shift with Left or Right extends, Enter selects (an hour for a desk) and Escape clears.
- After moving to another page through the navigation, focus is on that page's heading.
- Every dialog takes focus when it opens, including when its main button is disabled (the booking dialog then opens on the reason), and Escape closes it. When the button that opened it is gone, focus goes to the result or to the page, never to nothing.
- If a page cannot load, it says so with "Try again".

## Facilities staff

**Review the triage queue.**

1. Open "Staff". The "Triage queue" tab lists requests waiting for review with the suggested category, its confidence and the provider label ("Keyword stub (keyword-v1)" locally, "Workers AI" in production). Requests still being classified show "Classification pending", and requests with no suggestion show "Automatic classification unavailable"; both offer only "Categorize".
2. Press "Accept" (the dialog "Accept the suggestion?"), "Reassign" (choose a "Category") or "Categorize" and confirm. The result "Assigned "<title>". It is now under In progress." appears with a "Go to In progress" link.
3. If someone else handled it first, the page says "Already reviewed" and refreshes the queue. Any other failure says "Could not save. Check your connection and try again." inside the dialog, which stays open.

**Work a request through.**

1. On "In progress", press "Start work" (one click).
2. Press "Resolve". The dialog "Resolve this request?" takes an optional "Note for the reporter" of up to 500 characters; press "Resolve". The reporter sees the note in their timeline.
3. "Resolved" lists finished requests, and "Today's bookings" lists today's bookings with names.

**Staying current.** New suggestions arrive live ("Live updates on", or "Connecting to live updates" while connecting). The queue also refreshes every 60 seconds while the page is visible, when you come back to the tab, and when the live connection returns, so a request that becomes eligible after 2 minutes without any event still appears. "Updated hh:mm" says when it last loaded. The open tab is kept in the address (`/staff?tab=working`), and a request opened from it links "Back to the staff queue" to that tab.

## Facilities admin

**Read utilization.**

1. Open "Admin". The range defaults to 28 days back through the 14-day booking horizon. Change "From" and "To" and press "Apply range", or press "Last 7 days", "Last 4 weeks" or "Next 2 weeks". A wrong range says which field is wrong, for example "To must be on or after From."
2. "Utilization" shows one row per space: bookings, booked hours, days booked, and utilization (booked hours over every bookable hour of the weekdays in the range). "Show daily rows" switches to one row per space and day.
3. Below are "Hourly occupancy" and "Bookings per day".

**Read the request report.** The "Requests" tab shows suggestion agreement per provider, each with its own label, the median time to review (for example "13 h 4 min"), and requests by category and status.

**Manage spaces.**

1. On "Resources", "Deactivate" opens "Deactivate <space>?": "Existing bookings are kept. Nobody can book it until it is activated again." Press "Deactivate" or "Keep active". "Activate" is one click.
2. "Edit" changes a room's capacity (a whole number from 1 to 50, checked before sending) and any space's description.
3. If a change fails, the page says why.

## Changed on 2026-10-15

Local and not deployed. Each item below is a commit on `main` after `e9d5feb`; the tests named in each commit cover it.

1. **First run.** The sign-in page said only "Choose who to sign in as." on an unseeded database and showed an empty "Quick picks" heading; before migrations the app showed a generic error. It now says to run `npm run seed:local` or `npm run db:migrate:local` (the latter from a new dev-only 503 `schema_missing` answer from `/api/health`), with "Check again". It offers "Continue as <name>" when already signed in, and only follows a same-origin `next`.
2. **A bookable default date, and past or closed time drawn as such.** After the day's last slot, Find a space opened on today, where every cell was blocked and drawn with the hatched Booked style, so the grid looked fully booked. It now opens on the next working day and says why, and past, closed and not-yet-open cells are muted and named. On a laptop the grid scrolls to the first open column, which was hidden off to the right.
3. **One click books the shortest valid time.** A desk must be booked for at least 60 minutes, but one click selected 30, so the most common first attempt opened a dialog with "Confirm booking" disabled. One click now selects an hour for a desk. The help text mentions Shift+click, a hint says when a selection is too short, and the chip list can shorten or clear a selection.
4. **Every action ends with a visible result.** Bookings, cancellations, reviews and status changes were confirmed only to screen readers, and the button that was used then disappeared or became disabled, so keyboard focus fell to nothing. A result line with a next step now appears at the top of the page and takes focus when needed.
5. **A lost race has a way on.** After a conflict the dialog left "Confirm booking" enabled, which only repeated the conflict. It now offers "Pick another time" (back to that row) or, for your own clash, "See my bookings". A booking taken while you were choosing is explained beside the Book button, not only to screen readers.
6. **Dialogs always take focus and close on Escape.** A dialog whose preferred focus target was disabled left focus behind the page, so Escape did nothing; Escape in an open category list also closed the whole staff dialog. Both are fixed. A "Skip to availability" link jumps past the filters, and each new page puts focus on its heading.
7. **Failures offer "Try again".** A failed load showed a message with no way on, on every page. Find a space, the week calendar, My bookings, My requests, the request page, Staff and Admin now offer "Try again". Loading never shows an empty-list sentence such as "No upcoming bookings", and an expired sign-in leads back to sign-in instead of each action failing with a generic error.
8. **The request page and the staff queue stay current.** "Classification pending" stayed until a manual reload, and a refused cancel replaced the whole page with a generic error. The request page now checks again for up to 3 minutes and confirms a cancel, and the staff queue refreshes every 60 seconds, on return to the tab and on reconnect. Both stay within the Free plan's shared request allowance (at most 18 requests per open request page, one per minute per staff page).
9. **Availability first on phones and tablets.** The 14 filter controls came before the slots: measured at `e9d5feb` signed in as an admin, the first time chip started 1,625 px down a 375x812 screen and the grid 1,251 px down a 768x1024 one. The filters now fold behind a "Filters" button below 1024 px, and Book stays visible above the bottom navigation. The same measurement now gives 862 px and 748 px.
10. **Find a space remembers the search.** A reload or Back reset the date and filters, and the week calendar always opened on the current week. Both now keep the date and filters.
11. **Resolving asks for a note and confirms first, and staff errors say what failed.** Resolving cannot be undone, and every failure was reported as "changed meanwhile", network errors included.
12. **Admin.** Deactivating asked nothing, and a failed toggle showed nothing. My bookings showed a raw id for a space deactivated after booking. The utilization report had one row per space and day, which made the admin page 94,444 px tall at 375x812 with seeded history (measured at `e9d5feb`). Deactivating now confirms, failures show, names stay, and utilization defaults to one row per space with date presets; the same measurement now gives 8,304 px.

Server changes in this round, none of which weakens a rule: `/api/health` answers 503 `schema_missing` on a database without tables in dev mode only, and `GET /api/reservations` also returns the names of the spaces in its list.
