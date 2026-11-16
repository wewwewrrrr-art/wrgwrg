# Formal Technical Specification: Pure-Code RTS, Sandbox, Nature, Weather, Era Creatures & Sprite Atlas Engine

This document is the authoritative engineering specification for generating deterministic **Borderless Material-Shaded Sprites** across **6 Eras** (`primordial`, `dinosaurs`, `ice-age`, `stone-age`, `bronze-iron`, `medieval`) purely in TypeScript without external sprite sheets or black outer contours.

---

## PART I — Style Constitution & PixelBuffer (`src/engine/pixelCanvas.ts`)

Every sprite is synthesized inside an integer-grid `PixelBuffer(width, height)` backed by a flat `#RRGGBB` / `#RRGGBBAA` lookup grid.

### 1.1 Borderless Material-Tone Isolation (`buf.layer()`)
- **No Black Contour Rule**: Never draw `#131110` black outer borders around sprites. Parts and overlapping limbs/buildings separate cleanly using a **dark tone of their own material** (`~58–66%` luminance of the material hue), never a flat black ink line.
- **How `buf.layer((sub) => ...)` works**:
  1. Allocates a temporary `PixelBuffer` of identical dimensions.
  2. Executes your drawing callback inside `sub`.
  3. Wherever `sub` overlaps or borders previously painted opaque pixels on the parent buffer, it shades the contact crease in a darker tone of that underlying material (`darkenMaterialHex`) while leaving exterior silhouette pixels **completely free of black contours**.
  4. Result: razor-sharp internal part separation between roofs, walls, skulls, jaws, shells, and limbs with zero muddy black lines.

### 1.2 Shape-Based Soft Shadows & Non-Destructive Composition (`src/engine/softShadow.ts`)
- **Silhouette Projection (`applySoftGroundShadow`)**: Ground shadows project from each frame's opaque silhouette along the `(-1, -1)` top-left key light onto the 3/4 ground plane, smoothed with multi-pass separable Gaussian blur and calibrated to `stageBg` (`dark`, `meadow`, `parchment`, `checker`, `ocean`) before compositing strictly behind foreground via `buf.compositeUnder(shadowBuf)`.
- **Exemption Guarantee**: `showShadow: false`, `supportsShadow: false` (`weather`, `aquatic`), and `swim`/`death` states skip ground shadows automatically.

### 1.3 Key Lighting (-1, -1), 4-Tone Ramps & Clean Color Economy
- Light arrives strictly from **top-left `(-1, -1)`**.
- Each material defines 4 tones: **блик (highlight)**, **свет (light)**, **основной (base/mid)**, **тень (shadow/deep)**.
- Keep ~6–8 main colors per frame without stray single-pixel noise or orphan dithering.

---

## PART II — Proportions, Walk/Swim & Structural Scale (`pixelCanvas.ts`)

1. **Standardized Scale Hierarchy**:
   - **Humans**: `~10×10 px` core (head `3–4 px`), `NO` outer outline, `K1/K2` kingdom tunics & `SKIN_MASK`.
   - **Small Beasts & Pack Predators**: `6–16 px` core silhouette.
   - **Large Beasts (Ceratopsians, Rhinos, Bears, Raptors)**: `20–40 px` core silhouette.
   - **Giants (Sauropods, Mammoths, Spinosaurus, T-Rex)**: `50–120 px` core silhouette.
2. **Walk & Swim**:
   - **Walk**: 2–4 distinct step phases with a `1 px` vertical body bounce per stride.
   - **Swim (`unitMode === 'swim'`)**: Renders **only the upper half** emerging above animated `WATER_LINE` (`#D1E3EB / #D5E2EA`) wave crests; submerged legs are hidden.
3. **Actions**: Every era species implements `idle`, `normal` (walk/swim), `attack`, and `death` (plus `hit` / `zombie`).

---

## PART III — Modular Units, Eras & Genetic Subspecies (`unitAssembler.ts`, `palette.ts`)

### 3.1 Exact RGB Mask Channels (`buildMaskColorLookup`)
- **`K1_MASK` (Primary Kingdom Color)**: `#FF70FF`, `#D900EB`, `#9900A6`, `#5C0066` (`RAMPS.magenta`)
- **`K2_MASK` (Secondary Trim)**: `#00EFEF`, `#00DBDB`, `#009E9E`, `#006666` (`RAMPS.cyanMask`)
- **`SKIN_MASK` (Phenotype)**: `#B8FF96`, `#00FF00`, `#00AF00`, `#4A831F`
- **Dark Clamp Rule**: If all RGB channels of a chosen faction color are `< 128`, add `+50` to every channel before computing the 4-stop Lerp toward `(30, 30, 30)`.

### 3.2 Genetic Subspecies Parameters (`CreatureGenes`)
- `size`: `'compact' | 'standard' | 'colossal'` — proportional scaling / bulk variation.
- `coat`: `'natural' | 'dark' | 'albino' | 'striped'` — fur/scale pattern & contrast morphs.
- `appendages`: `'none' | 'standard' | 'ornate'` — horns, spikes, tusks, crests, or plumage feathers.
- `biomeTint`: `'none' | 'forest' | 'tundra' | 'desert' | 'volcanic'` — adaptive biome camouflage.

---

## PART IV — Baked Sprite Atlas Performance (`src/engine/spriteAtlas.ts`)

- Models bake once into packed shelf-row sprite atlas pages (`BakedSpriteAtlas`, `1024×1024` RGBA / offscreen Canvas sheets) keyed by `(modelId, kingdom, phenotype, mode, action, genesKey, shadowStage, frame)`.
- Subsequent draws across **tens of thousands of world entities** execute via O(1) rectangle lookup and GPU `drawImage` blitting without re-running procedural rasterizers per tick.

---

## PART V — Agent Pre-Flight Verification Matrix

| Check | Requirement | Failure Mode If Violated |
| :--- | :--- | :--- |
| **No Black Contour** | Zero `#131110` outer ink borders on any model; parts separate via material dark tone | Cartoon black outlines clash with seamless sandbox terrain |
| **4-Tone Light (-1,-1)** | Top-left highlights, base midtone, shadow, and deep overhang per material | Flat 2D shapes lacking 3/4 depth |
| **Actions & Swim** | `idle`, `walk`, `attack`, `death` + upper-body-only `swim` with `WATER_LINE` | Frozen creatures or submerged legs clipping water |
| **Genes & Masks** | `K1/K2/SKIN` recolor cleanly + `CreatureGenes` visibly alter subspecies anatomy | Cloned identical creatures without biome/lineage variety |
| **Atlas Caching** | `BakedSpriteAtlas` packs frames once & sustains 20k+ O(1) lookups | Per-frame GC spikes in large worlds |

