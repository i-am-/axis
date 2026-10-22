# claude.igniting.coach

Redesign of igniting.coach in the Igniting Coach brand: the palette and type of
the deck template, so the site and the slides read as one identity.

## The two directions

| Surface | Direction | Where |
|---|---|---|
| `.surface-paper` | **D · Field Notes** | home hero, contact |
| `.surface-reading` | **A · The Printed Page** | method, domains, resources, blog |

## Palette — from the brand deck

Colours and type follow `08-Templates/IgnitingCoach-TimeSaver.pptx`
(slide 3: "black and gold lead, teal supports", 60 / 30 / 10). Tokens live in
`src/styles/global.css`; the site is dark-first with a light inversion.

| Swatch | Hex | Job on the site |
|---|---|---|
| Ink | `#15181A` | dark ground; text on light |
| Charcoal | `#262A2D` | raised plates on dark |
| Gold | `#B8892B` | the accent — buttons, marks, links on dark (`#876419` as text on light) |
| Teal | `#006B7F` | atmosphere wash; links on light |
| Maroon | `#800000` | live marker on light |
| Rose | `#D8B8B4` | live marker on dark |
| Slate | `#5D6560` | secondary text on light |
| Cream | `#F5F1E9` | panels on light; text on dark |

## Two typefaces

- **Literata** — headings, wordmark, display figures (weight 400, as in the deck)
- **Roboto Flex** — body, interface, labels, forms

Self-hosted from the static instances in `~/.local/share/fonts/IgnitingCoach/`
(built by the deck's `mkfonts.py`), subset to Latin:
`public/fonts/literata/` (regular, italic) and `public/fonts/robotoflex/`
(regular, italic, bold).

## What was removed

- Bootstrap greys `#343a40 / #6c757d / #dee2e6`
- skill progress bars (`/skills/` → `/domains/`, seven named areas in prose)
- the typing-cursor hero
- `[data-reveal]{opacity:0}` — elements now rest **visible** and only lift, so
  the page reads with JS off, in print, and in link previews

## Develop

```sh
npm install
npm run dev      # http://localhost:4321
npm run build
```

Regenerate a font subset (needs fonttools + brotli), e.g.:

```sh
pyftsubset ~/.local/share/fonts/IgnitingCoach/Literata-Regular.ttf \
  --output-file=public/fonts/literata/literata-regular.woff2 --flavor=woff2 \
  --layout-features="liga,clig,kern,mark,mkmk,ccmp,locl,rlig,smcp,c2sc,onum,lnum,tnum,pnum,case,frac,sups,ordn" \
  --unicodes="U+0000-00FF,U+0100-017F,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212" --no-hinting --desubroutinize
```
