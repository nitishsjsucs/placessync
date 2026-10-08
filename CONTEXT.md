# PlacesSync domain glossary

**Site.** One office location with a time zone, opening hours (07:00 to 19:00 at `hq`) and a booking horizon (14 days). v1 has one site, `hq`.

**Resource.** A bookable desk or meeting room at a site, with a floor, zone, capacity and amenities. There are exactly 20: 14 desks and 6 rooms.

**Employee.** One of 100 synthetic people, each with one role: `employee` (92), `facilities_staff` (6) or `facilities_admin` (2). Roles live in D1 and never come from a token.

**Reservation.** A confirmed or cancelled booking of one resource by one employee on one site-local date, from a start to an end minute on 15-minute boundaries.

**SiteLedger.** The Durable Object that is the only writer of reservations for a site. Its SQLite is the source of truth.

**Slot claim.** A row in `resource_slots` or `employee_slots` for one 15-minute slot of a reservation, under a PRIMARY KEY, so no slot can be claimed twice.

**Ledger version.** A counter that rises by exactly 1 with every committed mutation at a site. It orders the outbox.

**Date version.** A counter per date that rises by exactly 1 with every committed mutation on that date and never moves for other dates. Live clients detect gaps with it.

**Outbox.** Rows written in the same transaction as each mutation and flushed by the ledger's alarm into D1 `reservation_facts` with version-guarded upserts.

**Snapshot and delta.** WebSocket messages for a subscribed date: the full busy state, then one `booked` or `released` change at a time.

**Facilities request.** An issue reported by an employee (title, description, optional resource and location note) with a status: `submitted`, `awaiting_review`, `assigned`, `in_progress`, `resolved` or `cancelled`.

**Service category.** One of four: `building_systems`, `electrical_av`, `furniture_fixtures`, `cleaning_safety`.

**Triage suggestion.** The category, confidence and rationale proposed for a request by a provider (`workers-ai`, `openai-compat`, `stub` or `keyword-fallback`), always shown with that provider's label.

**Review.** A staff decision that assigns the final category: `accepted` (the suggestion), `reassigned` (another category) or `manual` (categorized with no suggestion shown). Exactly one review per request.

**Sweep.** The cron job that finds requests stranded in `submitted` and creates or restarts their workflow, or hands them to staff after 3 attempts.

**Agreement.** For one provider, the share of reviewed suggestions whose category staff kept. Never aggregated across providers; manual reviews are excluded.
