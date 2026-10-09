# Triage labeling guide

Every facilities request gets exactly one of four service categories. Label the category of the team that fixes the underlying cause, not the category of the most prominent word.

| Category | Covers |
|---|---|
| `building_systems` | heating, cooling, ventilation, air quality, plumbing, leaks, water |
| `electrical_av` | power, outlets, lighting, displays, projectors, conferencing and AV gear |
| `furniture_fixtures` | desks, chairs, doors, locks, whiteboards, blinds, shelving |
| `cleaning_safety` | spills, trash, restroom supplies, pests, odors, trip hazards |

## Rules for ambiguous requests

1. **Source of water decides.** Water from pipes, drains, ceilings, windows or condensation is `building_systems`, even when it lands on a light fixture, a monitor or the floor. Liquid that people spilled (coffee, drinks, a knocked-over jug) is `cleaning_safety`.
2. **Temperature and air are building systems.** A room that is too hot or too cold, stale or stuffy air, and smells that come out of vents are `building_systems`, even when the room holds electrical equipment. Thermostats belong to `building_systems`.
3. **Power failures are electrical, mechanical failures are furniture.** A motorized desk, screen or badge reader with no power, a tripped breaker, or a dead switch is `electrical_av`. A frame, hinge, arm, tray or lock that is physically bent, loose or broken is `furniture_fixtures`, even if it holds a monitor or cables.
4. **Damaged cords are electrical; intact cords in the way are a hazard.** A frayed, melted or sparking cord is `electrical_av`. Undamaged cords or cables lying across a walkway are a trip hazard, `cleaning_safety`.
5. **Restrooms split three ways.** Plumbing failures (clogs, overflows, running water) are `building_systems`. Broken physical fixtures (seats, stall doors, locks, hooks) are `furniture_fixtures`. Consumable supplies (soap, paper, sanitizer) and dirty or wet floors are `cleaning_safety`. Powered appliances (hand dryers, lights) are `electrical_av`.
6. **Odors follow the source.** Food, trash and fridge smells are `cleaning_safety`; vent and air smells are `building_systems`; a burning smell from a device is `electrical_av`.
7. **Pests are cleaning and safety**, wherever they appear, including near electrical rooms.
8. **Lighting is electrical**, including exit signs and restroom lights, even when the request is framed as a safety issue.
9. **Dust and dirt on equipment** are `cleaning_safety` unless the equipment has also stopped working.
10. **Broken glass or debris on the floor** is `cleaning_safety` even when it came from a fixture; a fixture that is still hanging loose is `furniture_fixtures`.

## Provenance

The 40 items in `data/triage-hard.jsonl`, the 12 items in `data/triage-injection.jsonl`, the rules above and every label were all produced during the AI-assisted build of this repository. No person has labeled them, and no facilities staff member wrote or checked them. A blind relabel by a person would allow an inter-annotator agreement figure to be reported next to the accuracy numbers; that has not been done.
