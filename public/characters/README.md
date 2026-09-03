# Character art slots (not wired up yet)

The app currently renders characters as an emoji inside a styled "orb"
(see `src/ui/character.ts`, `characterMarkup()` / `characterMarkupForStage()`).
When real illustrations are ready, drop them here as:

```
public/characters/rabbit/stage-1.png ... stage-5.png
public/characters/fox/stage-1.png ... stage-5.png
public/characters/otter/stage-1.png ... stage-5.png
public/characters/panda/stage-1.png ... stage-5.png
```

4 characters × 5 growth stages = 20 files. Then in `src/ui/character.ts`,
replace the `<span class="animal">{emoji}</span>` line with
`<img src="/characters/${type}/stage-${stage}.png" class="animal-art" alt="">`
— `type` and `stage` are already the exact values this function receives, so
no other logic needs to change.
