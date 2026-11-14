# Hellenistic reading and astrocartography — design

Date: 2026-11-14
Status: approved in brainstorming, awaiting spec review

## Goal

Add two free, self-serve astrology tools to the site, each ending in the
"Start a conversation" call to action like `/natal-chart/`:

1. A **Hellenistic reading** as a new section of `/natal-chart/`.
2. An **astrocartography** map on a new page, `/astrocartography/`.

Human Design is out of scope; it is a later, separate sub-project (with care
over the Jovian Archive trademark and texts).

## Constraints

- Everything runs in the browser and is prerendered. No outside service is
  called, as the README promises for the natal chart today.
- Positions come only from the existing Swiss Ephemeris engine
  (`src/lib/ephemeris.ts`, DE441 files in `public/ephe/`); the Moshier
  fallback stays refused.
- English only, brand palette and type from `src/styles/global.css`, light
  and dark.
- Meanings are short (1–3 sentences), plain, in a coaching tone. Claude
  drafts them; the site owner edits them in review.

## Architecture

Pure calculation modules on top of the existing engine. Pages only render.

| File | Change | Job |
|---|---|---|
| `src/lib/ephemeris.ts` | extend | add geocentric equatorial RA/Dec per body, GMST and ARMC, Julian-day helpers |
| `src/lib/hellenistic.ts` | new, pure | whole-sign houses, sect, dignity and bounds, lots, profection, zodiacal releasing |
| `src/lib/acg.ts` | new, pure | MC/IC meridians, ASC/DSC curves, point-to-line distance |
| `src/lib/birth-query.ts` | new, pure | encode and decode the hand-off query string |
| `src/data/dignities.ts` | new | rulers, exaltations, detriments, falls, Egyptian bounds, sign minor years |
| `src/data/hellenistic.ts` | new | meanings for the Hellenistic blocks |
| `src/data/acg-lines.ts` | new | 40 line meanings (10 planets × 4 angles) |
| `src/components/BirthForm.astro` | extracted from `natal-chart.astro` | date, time, unknown-time box, place combobox |
| `src/pages/natal-chart.astro` | extend | WS house column, Hellenistic section, link to the map |
| `src/pages/astrocartography.astro` | new | the map page |
| `src/pages/resources.astro` | extend | a card for the map |
| `world-atlas/countries-110m.json` | dependency | imported with `?url`; Vite hashes it into `/_astro/`, already cached as immutable |

New dependencies: `d3-geo`, `d3-zoom`, `d3-selection`, `topojson-client`;
`vitest` as a dev dependency with an `npm test` script.

"Pure" means no DOM, no fetch: inputs are plain data (positions, dates,
coordinates), outputs are plain data. Each module is unit-tested alone.

### Shared rules

- **Unknown birth time.** On `/natal-chart/` the Hellenistic section shows
  only planetary condition (block 2 below), with the note "Sect, lots,
  profections and releasing need your birth time." The astrocartography
  page requires a time and explains why: four minutes of error shift every
  line by about 1° of longitude.
- **Hand-off.** Both pages read and write the query string
  `?d=YYYY-MM-DD&t=HH:MM&n=<place label>&lat=<deg>&lon=<deg>&tz=<IANA zone>`
  and fill the form from it. The place index rows carry no GeoNames id,
  so the place travels as its label, coordinates and zone; the index is
  not rebuilt. The natal result links "See your lines on the map"; the
  map links "Back to your chart".
- **Errors.** Out-of-range dates (outside the ephemeris files, 600–2999) and
  failed fetches use the natal chart's existing status line wording.

## Hellenistic reading (`/natal-chart/`)

Placement: a section "Hellenistic reading" under the Symbolon spread, with a
2–3 sentence intro to the tradition. The wheel stays Placidus; the positions
table gains a **WS house** column beside the Placidus house.

Blocks, top to bottom:

1. **Sect.** Day chart when the Sun lies on the half of the ecliptic above
   the horizon: from the ASC through the MC to the DSC, that is
   `(sun − asc) mod 360 ≥ 180`. Shows the sect light, benefic of sect,
   malefic of sect and the contrary malefic, each with one line of meaning.
2. **Planetary condition.** The seven traditional planets: sign, dignity
   (domicile, exaltation, detriment, fall, or peregrine), bound lord
   (Egyptian bounds), in or out of sect (Mercury by its phase: morning
   star with the day, evening star with the night). The outer planets
   are left out.
3. **Lots.** Fortune = ASC + Moon − Sun by day, ASC + Sun − Moon by night.
   Spirit = ASC + Sun − Moon by day, ASC + Moon − Sun by night. Each:
   sign, degree, whole-sign house, lord, meaning.
4. **Profection.** Age in completed years at the visitor's current date.
   Activated house = age mod 12 + 1, counted in whole signs from the
   ASC sign. Shows the house, its sign, the lord of the year and its natal
   placement, the date the next profection year starts (the next birthday),
   and the meanings of the house and lord.
5. **Zodiacal releasing.**
   - Released from Spirit by default, with a toggle to Fortune.
   - Period lengths in sign minor years: Aries 15, Taurus 8, Gemini 20,
     Cancer 25, Leo 19, Virgo 20, Libra 8, Scorpio 15, Sagittarius 12,
     Capricorn 27, Aquarius 30, Pisces 12.
   - Year = 360 days (Valens), one exported constant. L2 sub-periods are
     the same numbers in 30-day months.
   - Loosing of the bond: when the L2 sequence returns to the L1 sign
     after a full cycle, it jumps to the sign opposite, per Brennan's
     *Hellenistic Astrology* (2017). Confirm the exact rule against that
     source and the test reference before coding it.
   - Peak periods: signs angular to Fortune (1st, 10th, 7th, 4th from it),
     the 10th strongest.
   - UI: an L1 band from birth to age 90 with "now" marked and peaks shaded
     gold; a `<details>` list of the current L1's L2 sub-periods, with peaks
     and the loosing of the bond flagged.

## Astrocartography (`/astrocartography/`)

Entry points: the shared `BirthForm` (time required); the link from the
natal result; a card on `/resources/`. The header nav is unchanged.

### Calculation (`acg.ts`)

Standard in-mundo lines (Jim Lewis). Geocentric RA α and Dec δ for the Sun
through Pluto at the birth moment in UTC, and GMST.

- **MC line:** the meridian at λ = α − GMST, normalised to −180…180.
  **IC line:** λ + 180°.
- **ASC / DSC lines:** for φ from −80° to 80° in 0.5° steps,
  H₀ = acos(−tan φ · tan δ) where |tan φ · tan δ| ≤ 1;
  ASC λ = α − GMST − H₀, DSC λ = α − GMST + H₀. Curves end where there is
  no solution and split at the antimeridian into separate polylines.
- **Distance:** great-circle distance from a point to each line, sampled at
  ≤ 0.25° along the line. Lines within **700 km** are listed, closest
  first. The orb is one exported constant.

### Map

- d3-geo, Mercator clipped to ±75° latitude; d3-zoom for pan and zoom.
- `countries-110m` drawn with site tokens; birthplace marker.
- One colour per planet from the brand palette, labelled at the map edge.
  The line style encodes the angle: MC solid, IC dotted, ASC dashed,
  DSC dash-dot.
- Chips toggle each planet and each angle.

### City panel

Search with the existing `searchPlaces`, or click the map to use the
clicked coordinates. Lists each line within the orb: "Venus ASC — 210 km",
then its meaning.

### Accessibility

The map SVG is `aria-hidden`. A table "Your lines" gives each planet's MC
and IC longitude and its ASC and DSC longitude at the birth latitude.
The city panel is plain text with `aria-live`.

### Credits

Add "Map data: Natural Earth (public domain), via world-atlas" to the
page's credit line.

## Testing

Vitest unit tests for the pure modules:

- `dignities` / `hellenistic`: dignity and bound lookups at 0°, 29°59′ and
  at bound edges; sect for charts minutes before and after sunrise and
  sunset; lot reversal by night; profection the day before, of and after a
  birthday; ZR L1 and L2 start dates and the loosing of the bond against a
  published example from Brennan.
- `acg`: at the MC-line longitude, the Swiss Ephemeris ARMC equals the
  planet's RA (within 0.01°); at sampled points on ASC and DSC lines, the
  planet's altitude from `azalt` is ≈ 0° (within 0.1°); antimeridian split;
  distance against known city pairs (e.g. Dublin–London ≈ 464 km).

Then `npm run check` and `npm run build`, and a browser check of both pages
in light and dark mode at desktop and phone widths.

## Out of scope

Human Design; parans and local-space lines; zodiacal (as opposed to
in-mundo) ACG lines; ZR levels below L2; translations; saving charts.
