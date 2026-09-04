# Character growth art

20 real illustrations (4 animal types × 5 growth stages), generated from a
single source sheet (`assets-source-character-growth-sheet.png.png` in the
project root — a ChatGPT-drafted 5-column (stage) × 4-row (animal) grid) via
`scripts/crop-character-assets.py` (content-aware cropping: detects each
character's own bounding box rather than a fixed pixel grid, so slight
irregularities in the source sheet never clip an ear/tail/prop at a cell
edge — see that script's comments for the row/column band detection and
gap-midpoint clipping it uses).

```
public/characters/rabbit/stage-1.webp ... stage-5.webp
public/characters/fox/stage-1.webp   ... stage-5.webp
public/characters/otter/stage-1.webp ... stage-5.webp
public/characters/panda/stage-1.webp ... stage-5.webp
```

Animal type (picked once at onboarding, permanent) and growth stage
(derived from completion count, see `src/constants.ts` GROWTH_STAGES) are
independent axes — a rabbit stays a rabbit at every stage; only the stage
illustration changes as the student completes more weeks.

Wired up in `src/ui/character.ts` (`characterMarkup()` /
`characterMarkupForStage()`): renders `<img src="/characters/{type}/stage-
{stage}.webp">` with an `onerror` fallback back to the emoji + tinted-ring
rendering, so a missing/renamed asset degrades gracefully instead of
breaking the layout.

To regenerate from a new source sheet: replace
`assets-source-character-growth-sheet.png.png` and re-run
`python3 scripts/crop-character-assets.py` (requires Pillow + numpy —
`python3 -m pip install Pillow numpy`). It also writes
`_scratch-character-contact-sheet.png` for a quick visual review grid —
always look at it (and a few full-resolution outputs) before trusting a
regenerated batch; don't assume a clean script run means clean crops.
