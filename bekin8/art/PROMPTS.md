# BeKin beacon art: prompts and specs

## Current handoff for Claude — 2026-11-23 (overrides older progress counts)

- **Keep BOTH Old Guard backgrounds. The user has not chosen between them.** `art/in/castle-bg.png` is the original curtain-wall/parapet scene. `art/in/castle-bg-tower-platform.png` is the alternate gable-apex beacon platform. Neither is superseded, neither should be deleted, and the tower version must not silently replace the wall version in code. Both are 1024×1536 opaque PNGs.
- **Latest basket:** `art/in/castle-basket.png`, a large deep circular signal-beacon cage, loaded with substantial dry wood and supported by braced feet. Created after the user rejected the shallow rectangular brazier as too small/weak for signaling. The user explicitly approved this final round basket full of wood on 2026-11-23. The rejected version is archived at `art/references/castle-basket-small-rejected.png`; do not use it as the production sprite.
- **Historical evidence:** sources and limitations are in the detailed handoff at the end. Treat the background/basket combination as an original historically informed illustration, not a verified reconstruction. The wall-ledge placement is still unverified; the tower version uses a documented architectural principle.
- **Integration:** fire/fuel assets are unlit; slot 1c is the explicitly requested exception with warm interior window and door-gap illumination. Add flames, sparks, contact shading and local firelight at runtime. Keep the background pixels intact when compositing; do not regenerate either background just to add the basket. Alpha-aware sprite bounds and proposed placement coordinates are below. No application code was changed in this art pass.
- **All 11 requested source-art slots are required.** Slot 1c has now actually been generated and saved as `art/in/beacons-hut-lit.png`. The previous claim that a build script removed this deliverable was wrong and is withdrawn. Existing app derivatives do not replace requested source images. All 11 source slots now have files; the new lit hut awaits user visual review. Both castle background alternatives remain preserved and undecided.


Paste these into ChatGPT (image generation). Save what comes back into `art/in/` with the exact
file names given, then tell Claude they are there. Claude places them, adds the fire, the light,
the names and the motion in code. **Fire/fuel assets are unlit. Slot 1c explicitly requires warm window and door-gap light, but no visible exterior flames.**

## Rules that apply to every prompt

Add this block to the end of every prompt (it is already pasted into each one below):

> No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fire,
> flames, sparks, smoke, lanterns or lit windows anywhere. No moon or sun disc. Night scene, lit
> only by faint cool moonlight from the upper left.

How to work:

- **One ChatGPT conversation per skin.** The style carries between images in the same chat.
- **Backgrounds**: portrait, 1024 x 1536. Ask again if it comes back square.
- **Sprites** (single objects): square, 1024 x 1024, **transparent background**. If the background
  is not transparent, say "same image, transparent background, PNG".
- For a matching second version of a sprite, use **edit on the same image** ("same image exactly,
  change only ..."). Do not start a new generation: it will not match.
- Reroll until the layout rules hold. The checks under each prompt say what to look for. A pretty
  image that breaks the layout cannot be used.

Why the backgrounds have empty bands: the phone screen is taller than the image and has things on
top of it. The top of the image must fade into one flat color so code can extend the sky. The
middle is where friend tiles sit, so it has to stay calm and dark. The lower middle is where your
own beacon stands. The very bottom is under the buttons.

---

## 1. The Beacons (home): painted mountain range (source-art slots supplied 2026-11-23)

Slot 1c is REQUIRED as its own source PNG. It is now supplied as `art/in/beacons-hut-lit.png`, edited from the approved original stone hut. A build script does not cancel this deliverable.

Style for this skin: cinematic matte painting, like concept art for a fantasy film. Realistic rock
and snow, painterly, deep blue night.

### 1a. Background -> `art/in/beacons-bg.png` (portrait 1024 x 1536)

```
A cinematic matte painting of a vast mountain range at night, portrait orientation, viewed from a
high rocky ledge looking out across many receding ridges. Deep blue pre-dawn darkness, realistic
jagged rock, snow on the highest far summits, thin mist lying in the valleys between ridges so each
ridge separates clearly from the next. Atmospheric perspective: the nearest ridge is almost black,
each farther ridge is paler and bluer.

Composition, exactly:
- The top fifth of the image is empty sky that fades upward to a single flat dark navy color
  (#0D1626) with no stars, no clouds and no gradient banding at the very top edge.
- Seven small, clearly visible, FLAT rocky shelves or summit ledges, each bare and empty, zigzagging
  up the image from the lower right to the upper middle: lower right, then lower left, then middle
  right, then middle left, then upper right, then upper left of center, then the highest one near
  the center. They get smaller with distance. Each shelf has clear dark space around it.
- At the bottom center, the nearest ground: a wide flat bare rock ledge, completely empty, seen
  from slightly above. The bottom tenth of the image is near-black rock.
- No buildings, no huts, no towers, no trees, no paths.

No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fire,
flames, sparks, smoke, lanterns or lit windows anywhere. No moon or sun disc. Night scene, lit only
by faint cool moonlight from the upper left.
```

Check: seven empty flat shelves you can point at, in a zigzag. Top edge is one flat navy. Nothing
built anywhere. The middle of the image is not bright.

### 1b. Hut -> `art/in/beacons-hut.png` (square, transparent)

```
A single small mountain watch-hut, painted in the same cinematic matte-painting style: rough stone
walls, a steep timber-and-slate roof with a little snow on it, a stone chimney, one wooden door and
one small shuttered window, both dark. Seen straight on from the front, slightly from below. Night,
faint cool moonlight from the upper left, so the roof edge and the left wall catch a thin cold rim
light. The hut fills most of the frame and its base sits on the bottom edge. Transparent
background, no ground, no shadow on the ground, nothing else in the image.

No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fire,
flames, sparks, smoke, lanterns or lit windows anywhere.
```

### 1c. Hut, somebody home -> `art/in/beacons-hut-lit.png` (edit of original 1b)

Required matching lit-state source image, now saved. Preserve the actual original 1b canvas of 1536×1024, rather than changing its framing to square. The source is `a_realistic_highly_detailed_isolated_png_transpar.png`. See the exact edit prompt, validation and matching limitations in the final handoff below.

```
Same image exactly, same size, same transparent background. Change only this: the window and the
gap under the door now glow warm orange from firelight inside, and a little warm light spills onto
the stone around them. Nothing else changes.
```

### 1d. Pyre -> `art/in/beacons-pyre.png` (square, transparent)

**Current direction, corrected by the user on 2026-11-21:** square Gondor / Lord of the Rings-style signal pyre, built from horizontal logs in alternating crossed courses. The earlier conical / teepee specification is superseded.

```text
Use case: stylized-concept.
Asset: BeKin unlit mountain signal beacon sprite, replacing the conical pyre with the user's requested square Lord of the Rings / Gondor-style pyre.
Input 1: approved moonlit alpine mountain background, for cool lighting and realism only. Input 2: approved timber-and-stone hut, for realistic wood and stone rendering only. Do not include mountains or buildings.
Create ONE isolated SQUARE SIGNAL PYRE: a broad square crib of heavy rough-cut logs stacked HORIZONTALLY in alternating perpendicular crossed courses. Each layer runs at 90 degrees to the one below it, making a strongly squared, slightly tapered block with a flat square top, visible ends, rough dry bark and smaller kindling within the open crib. Several substantial layers, recognizable as a deliberately built large Gondor mountain signal beacon. Width greater than height, sturdy and imposing. Rest on a LOW SQUARE platform of rough fitted gray stone, not a circular stone ring. Front three-quarter view from slightly above so the square top and two sides are visible. Whole structure fully visible with modest transparent margins.
This is a SQUARE crib-stack, not a cone, teepee, tent, upright bundle, campfire, bowl, basket or tower. All major logs lie horizontally. No protruding tall central pole, no stakes, no roof.
Match the realistic cinematic detail of the approved BeKin sprites: weathered rough dry wood with natural bark, uneven cut ends, believable heavy stone; dark neutral brown wood under faint cool blue moonlight from the upper left. Crisp silhouette readable at small sprite scale. Ready to light but completely UNLIT.
Genuine transparent background including gaps through the outer log layers where appropriate; no opaque backdrop, checkerboard, gradient, ground plane, surrounding terrain, floating cast shadow or halo. No snow covering the fuel. No flames, fire, embers, sparks, smoke, warm glow, lanterns, lit windows, people, animals, text, letters, numbers, logos, watermarks, border, moon or sun. One pyre only. Square canvas 1024x1024 requested.
```

Check: square log crib and square stone base, readable top and two sides, completely unlit, real transparent PNG. No cone or circular stone ring.

### 1e. Your own beacon (optional) -> `art/in/beacons-main.png` (square, transparent)

```
The great signal beacon of the mountain watch, same cinematic matte-painting style: a large, wide
stack of heavy logs laid in crossed courses on a square platform of fitted grey stone blocks, unlit,
seen straight on. Night, faint cool moonlight from the upper left. It fills most of the frame and
its base sits on the bottom edge. The top of the log stack is flat and about half the width of the
image. Transparent background, no ground, no shadow, nothing else in the image.

No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fire,
flames, sparks, smoke, embers or glow anywhere.
```

---

## 2. Old Guard (new): a real castle wall

**2026-11-23 trial revision:** `art/in/castle-bg-tower-platform.png` explores a dedicated gable-apex beacon platform based on the documented architectural principle at Gilnockie Tower. See the “Old Guard tower-beacon alternative” entry below for exact prompts and source limitations. The original parapet image is retained; the basket design remains to be reviewed for the revised setting.

Style for this skin: realistic digital painting, like a historical illustration. Weathered stone,
believable medieval masonry. Not a cartoon, not fantasy-ornate.

### 2a. Background -> `art/in/castle-bg.png` (portrait 1024 x 1536)

```
A realistic digital painting, portrait orientation, of the view from the wall walk on top of a
medieval castle curtain wall at night. We stand on the wall walk looking outward over the parapet.
Weathered grey limestone, real coursed masonry with worn mortar, moss in the joints.

Composition, exactly:
- The top fifth of the image is empty night sky that fades upward to a single flat dark blue-black
  color (#0A0F1C) with no stars, no clouds and no banding at the very top edge.
- The upper middle of the image is a calm dark distant landscape seen beyond the wall: low wooded
  hills and one far-off stone watchtower on a hill at the right, small, dark and unlit.
- Across the lower third runs the crenellated parapet of our wall, seen from behind at chest
  height: tall merlons on the far left and far right, and in the CENTER a wide open gap with a
  flat, empty stone platform (the top of the wall) about a third of the image wide. Nothing stands
  on that platform.
- The bottom tenth of the image is dark flagstone of the wall walk.

No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No banners
or flags. No fire, flames, torches, braziers, sparks, smoke, lanterns or lit windows anywhere. No
moon or sun disc. Night scene, lit only by faint cool moonlight from the upper left.
```

Check: an empty flat stone platform in the bottom center. Merlons only at the sides. The middle of
the image is dark and quiet. No torches (it loves adding torches: reroll).

### 2b. Signal-beacon basket -> `art/in/castle-basket.png` (square, transparent)

**Approved final basket, 2026-11-23:** large deep circular iron cage with a substantial dry-wood load and braced feet. Replaces the user-rejected shallow rectangular heating grate and the old single-stem bowl concept. Real beacon references, source limitations, placement estimates and complete prompt history are in the “Old Guard signal basket and full integration handoff” entry below. The user approved the circular basket full of wood on 2026-11-23.

```text
Use case: historical-scene.
Asset: BeKin Old Guard large SIGNAL BEACON fire basket, transparent square sprite, requested 1024x1024.
Input: supplied castle tower background is ONLY the palette, surface realism, cool lighting and camera reference. No scenery in output.
Create a substantial TOWER-TOP SIGNAL BEACON, a deep open iron cage holding a large mass of dry wood. It should look capable of supporting a conspicuous bonfire on a stone tower, with visual mass comparable to a large barrel or small hogshead, not a domestic hearth grate or decorative garden firepit.
Historical design grounding: real early signal beacons used iron fire baskets; early maritime beacons such as Skagen's lever light used suspended iron fuel containers, and North Foreland's 1636 light had a coal-burning iron grate atop a tower. Adapt the deep iron-container principle to a fixed stone-platform mount with WOOD fuel; this is an original historically informed game asset, not a claimed replica of either maritime beacon. Do not depict the lever, tower, coal or landscape.
Shape: a broad deep ROUND iron cage, mildly flared outward toward the open top, approximately 1.3m across its rim and 0.9m deep as an artistic scale target. Overall silhouette with fuel and low feet about as tall as it is wide. Three substantial circular horizontal bands reinforced with heavy closely spaced vertical forged iron ribs and large handmade rivets. Coherent bottom grate supports the fuel. Four short stout braced iron feet integrated into a broad low support frame, stable wide footprint, no tall single stem, no ornamental pedestal, no slab.
Fill the cage substantially with many hefty dry split logs in several irregular crossed layers, leaving believable air gaps and finer kindling below. A dense but airy mound rises approximately one quarter of the cage depth above the rim. Numerous visible log ends and substantial layered fuel volume, not three or four small pieces. The logs are all securely contained, no absurd towering loose stack. The basket must remain visibly deep even with fuel inside. Dark iron ribs and broad bands readable at phone size.
View near front slightly from above so the elliptical open rim and fuel load are readable, compatible with the tower-platform background. Cool realistic historical-illustration painting, hand-forged matte black iron with blue-gray edge highlights and restrained hammer texture, natural dark brown dry wood with lighter split grain. Upper-left cool moonlight, no warm light. Entire assembly UNLIT and cold.
SQUARE CANVAS. Center the whole beacon and show all feet and log ends with at least 8% fully transparent margin on every side. Genuine transparent background including empty gaps in the cage and beneath feet. No ground, stone, plinth, external cast shadow, background color, checkerboard or halo. No fire, flames, sparks, embers, smoke, people, flags, decoration, spikes, heraldry, letters, logos, watermark, snow or green foliage. One imposing deep signal-beacon cage only, no other objects.

```

---

## 3. Campfire: the forest clearing

Style for this skin: storybook gouache illustration, soft and hand-painted, like a picture book.
Rounded brush shapes, visible paint texture. Not pixel art, not vector, not photographic.

### 3a. Background -> `art/in/campfire-bg.png` (portrait 1024 x 1536)

```
A storybook gouache illustration, portrait orientation, of a small clearing in an old forest on a
summer night. Tall trees with thick trunks and soft heavy foliage stand close on the left and right
edges, their branches arching toward each other high up; between them, straight ahead, more forest
fades back into deep blue darkness in several soft layers. Ferns and long grass at the edges of the
clearing. Deep blues and blue-greens, hand-painted texture.

Composition, exactly:
- The top fifth of the image is dark foliage and night sky fading upward to a single flat dark
  blue-green color (#0A1620) with no stars and no banding at the very top edge.
- The middle of the image is open dark air between the trees: calm, dim, low contrast, nothing
  bright.
- In the lower third, the clearing floor: a flat patch of bare trodden earth in the bottom center,
  about a third of the image wide, completely empty. Nothing stands on it.
- The bottom tenth is dark grass.

No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No
fireflies, no glowing dots, no fire, flames, sparks, smoke, lanterns or lights of any kind. No moon
or sun disc. Night scene, lit only by faint cool moonlight from the upper left.
```

Check: an empty earth patch bottom center, open dark air in the middle, no glowing specks anywhere
(the lightning bugs are added in code and carry your friends' names).

### 3b. Campfire logs -> `art/in/campfire-logs.png` (square, transparent)

```
A single unlit campfire in the same storybook gouache style: split logs leaned together in a
teepee over a nest of kindling, inside a ring of rounded river stones. Cold and unlit. Seen from
the front, slightly from above. Night, faint cool moonlight from the upper left. It fills most of
the frame, the stone ring sits on the bottom edge. Transparent background, no ground, no shadow,
nothing else in the image.

No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fire,
flames, sparks, smoke, embers or glow anywhere.
```

---

## 4. Smoke Signal: the sky is the canvas

The names of the people coming are written into the smoke puffs in code, so this background is
mostly open sky and it is the one DAYTIME scene.

Style for this skin: mid-century national-park travel poster. Flat, bold shapes, limited palette,
a little paper grain. Not photographic.

### 4a. Background -> `art/in/smoke-bg.png` (portrait 1024 x 1536)

```
A mid-century national park travel poster illustration, portrait orientation, of high desert mesa
country in the last warm light of late afternoon. Flat bold shapes, limited palette of warm sand,
terracotta, dusty sage and a clear pale turquoise sky, subtle paper grain.

Composition, exactly:
- The top two thirds of the image is open, empty sky: one smooth clean gradient from pale turquoise
  at the top (the very top edge is a single flat color, #7FB9C4) down to warm peach near the
  horizon. Absolutely no clouds, no birds, no sun.
- A low horizon in the lower third: distant flat-topped mesas and buttes in layered terracotta
  silhouettes.
- In the bottom center, the nearest ground: the flat top of a rocky bluff, bare sandstone, about a
  third of the image wide, completely empty. Sagebrush at its edges only.
- The bottom tenth is darker rock in shadow.

No text, letters, numbers, logos, watermarks, borders or frames. No people, animals, tents, tipis
or buildings. No fire, flames, sparks or smoke of any kind anywhere in the sky or on the ground.
No sun disc.
```

Check: the sky is completely empty and smooth (it will add clouds or smoke: reroll). Empty flat rock
bottom center.

### 4b. Signal fire -> `art/in/smoke-fire.png` (square, transparent)

Current fuel specification: pine boughs, supported by the historical source recorded in the correction appendix. The earlier juniper choice is superseded; do not describe the exact illustration as a verified historical reconstruction.

```
A single unlit signal fire in the same mid-century travel-poster style: a low wide heap of dry
sticks and split wood with freshly cut green pine boughs loosely laid on top, sitting in a shallow ring
of flat sandstone slabs. Cold and unlit. Flat bold shapes, warm sand and terracotta palette. Seen
straight on, slightly from above. It fills most of the frame, the stone ring sits on the bottom
edge. Transparent background, no ground, no shadow, nothing else in the image.

No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fire,
flames, sparks, smoke, embers or glow anywhere.
```

---

## Order to do them in

1. `beacons-bg.png` first. It is the home screen and the hardest layout. Send it back alone if you
   like, so the shelf positions can be checked before you make the hut and pyre.
2. The Beacons sprites (1b to 1e).
3. Campfire (3a, 3b).
4. Smoke Signal (4a, 4b).
5. Old Guard castle (2a, 2b).

Eleven images in all. Any size ChatGPT returns is fine as long as the shape is right (portrait for
backgrounds, square for sprites).


---

## Beacons hut alternatives — 2026-11-21

Generated with the built-in image_gen tool using the approved hut and mountain PNGs as references. Individual assets retain their original generated alpha channels and resolution. The original background and hut are unchanged. These are unlit sprites for runtime placement and lighting.

References:
- `art/in/a_realistic_highly_detailed_isolated_png_transpar.png` — architecture, material and camera reference.
- `art/in/Moonlit Milky Way Over Alpine Peaks.png` — moonlight and palette reference only.

### beacons-hut-02-steep-gable.png

Saved as `art/in/beacons-hut-02-steep-gable.png`.

```text
Use case: stylized-concept.
Asset type: one standalone PNG sprite for a moonlit alpine scene, square 1024 x 1024 with genuine alpha transparency.
Input image 1 is the approved hut: use it as the architectural, material, realism, scale and camera reference. Input image 2 is the approved mountain background: use it only as the cool moonlight and palette reference; do not reproduce any part of its landscape.
Create a distinct alternate small mountain stone hut belonging to the same family as the reference. Preserve believable rough gray stone masonry, aged dark wood door, rough layered slate, patchy snow, dark unlit windows, and photoreal cinematic detail. Same three-quarter front view and near-ground camera height, restrained cold light from upper left; dark but readable, suitable for a blue night mountain scene. The silhouette must remain recognizable when reduced to roughly 160 pixels wide.
Show the entire hut and chimney with modest clear padding; nothing cropped. Only a very tight irregular skirt of foundation stones and snow touching the building; no large ground island, no landscape, no cast shadow floating beyond the base. Clean real transparent alpha outside the silhouette, including chimney openings where background should show. Do not render a gray backdrop, gradient, checkerboard, halo or rectangle.
No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fire, flames, sparks, smoke, lanterns or lit windows anywhere. No moon or sun disc. Night scene, lit only by faint cool moonlight from the upper left. One hut only.
Variant: Compact square watch-hut with a distinctly steep gable slate roof, front-facing triangular gable, centered short wooden door, one small square shuttered window, and a short stout chimney rising at the rear right roof corner. Snow catches the roof courses and stone lintel. Make the narrower, taller roof silhouette clearly different from the original broad roof. Modest single-story shelter, not a tower.
```

### beacons-hut-03-longhouse.png

Saved as `art/in/beacons-hut-03-longhouse.png`.

```text
Use case: stylized-concept.
Asset type: one standalone PNG sprite for a moonlit alpine scene, square 1024 x 1024 with genuine alpha transparency.
Input image 1 is the approved hut: use it as the architectural, material, realism, scale and camera reference. Input image 2 is the approved mountain background: use it only as the cool moonlight and palette reference; do not reproduce any part of its landscape.
Create a distinct alternate small mountain stone hut belonging to the same family as the reference. Preserve believable rough gray stone masonry, aged dark wood door, rough layered slate, patchy snow, dark unlit windows, and photoreal cinematic detail. Same three-quarter front view and near-ground camera height, restrained cold light from upper left; dark but readable, suitable for a blue night mountain scene. The silhouette must remain recognizable when reduced to roughly 160 pixels wide.
Show the entire hut and chimney with modest clear padding; nothing cropped. Only a very tight irregular skirt of foundation stones and snow touching the building; no large ground island, no landscape, no cast shadow floating beyond the base. Clean real transparent alpha outside the silhouette, including chimney openings where background should show. Do not render a gray backdrop, gradient, checkerboard, halo or rectangle.
No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fire, flames, sparks, smoke, lanterns or lit windows anywhere. No moon or sun disc. Night scene, lit only by faint cool moonlight from the upper left. One hut only.
Variant: Low, modestly elongated rectangular shepherd's hut with a broad low-pitched slate gable roof, squat masonry chimney at the far left end, slightly off-center wooden door and two small dark windows on the long facade. An exposed stone lintel and uneven roof edges add age. Clearly wider and lower than the original, yet a small single-room alpine shelter, not a large house. No porch or extensions.
```

### beacons-hut-04-hipped-roof.png

Saved as `art/in/beacons-hut-04-hipped-roof.png`.

```text
Use case: stylized-concept.
Asset type: one standalone PNG sprite for a moonlit alpine scene, square 1024 x 1024 with genuine alpha transparency.
Input image 1 is the approved hut: use it as the architectural, material, realism, scale and camera reference. Input image 2 is the approved mountain background: use it only as the cool moonlight and palette reference; do not reproduce any part of its landscape.
Create a distinct alternate small mountain stone hut belonging to the same family as the reference. Preserve believable rough gray stone masonry, aged dark wood door, rough layered slate, patchy snow, dark unlit windows, and photoreal cinematic detail. Same three-quarter front view and near-ground camera height, restrained cold light from upper left; dark but readable, suitable for a blue night mountain scene. The silhouette must remain recognizable when reduced to roughly 160 pixels wide.
Show the entire hut and chimney with modest clear padding; nothing cropped. Only a very tight irregular skirt of foundation stones and snow touching the building; no large ground island, no landscape, no cast shadow floating beyond the base. Clean real transparent alpha outside the silhouette, including chimney openings where background should show. Do not render a gray backdrop, gradient, checkerboard, halo or rectangle.
No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fire, flames, sparks, smoke, lanterns or lit windows anywhere. No moon or sun disc. Night scene, lit only by faint cool moonlight from the upper left. One hut only.
Variant: Squat square mountain refuge with a distinctive four-sided hipped slate roof (no triangular gable), a small short stone chimney offset toward the rear left, a recessed wood door under a heavy rough stone lintel, and one tiny dark window. Strong slightly battered stone corners and a restrained patchy snow cap. Clearly distinct rounded-square roof silhouette, rustic and practical rather than ornate. Single story.
```

Validation: all three files are RGBA PNGs with substantial fully transparent regions. Reviewed the silhouettes and edges composited over dark blue. No fire or lit windows.


---

## Recovered design direction and wood varieties — 2026-11-21

Source: [Select All Army Hotkey](https://chatgpt.com/c/6affa041-338c-83ea-a165-c2883344f7a6). Read directly in Firefox after the chat retrieval tool exposed only five recent exchanges with placeholders and no older-page cursor. The original concept has been recovered as `art/references/recovered-mixed-hut-concept.png`. This is a concept sheet, NOT a production background or a sheet of finished transparent sprites.

The original direction is a MIX of stone shelters, TIMBER huts, mixed timber-and-stone shelters, and small watchtowers at different distances. Do not narrow future variations to all-stone roof variants. The recovered plan lists a square stone watch-hut, compact stone tower with flat or low-pitched roof, timber-and-stone mountain shelter, smaller weathered stone outpost for distant peaks, and separate unlit beacon pyres. Keep the approved mountain background exactly unchanged and let application code position and scale the independent sprites. Fire/light/animation are added in code. The original conversation says the individual transparent alternatives were not successfully completed at that point; the recovered sheet is a design reference.

The three stone variants 02–04 remain usable additions, but do not represent the whole recovered direction. This correction adds the missing wood materials. Tower, distant outpost and pyres remain separate planned assets; this correction does not claim to complete them.

### Reference inputs for these two new sprites

1. `art/references/recovered-mixed-hut-concept.png`: top-row wood-and-stone architecture.
2. `art/in/a_realistic_highly_detailed_isolated_png_transpar.png`: approved realistic rendering family.
3. `art/in/Moonlit Milky Way Over Alpine Peaks.png`: palette and lighting only.

Generated using the built-in image_gen tool, actual transparent-background flag enabled. Both results are 1254 × 1254 RGBA PNGs. Alpha ranges from 0 to 255 and large exterior regions are fully transparent.

### beacons-hut-05-timber-stone.png

Saved to `art/in/beacons-hut-05-timber-stone.png`.

```text
Use case: stylized-concept.
Create ONE production-ready isolated hut sprite with genuine transparent alpha, ideally square 1024x1024.
Reference image 1 is the RECOVERED ORIGINAL DESIGN CONCEPT from the user's earlier chat. Its TOP ROW huts are the key design reference, especially the timber-dominant middle shelter and the steep-roof rustic mixed-material shelter on the right. Restore their weathered, practical, rough-built character.
Reference image 2 is the approved stone hut, for matching realistic material rendering and scale only. DO NOT turn the new hut into another all-stone house.
Reference image 3 is the approved mountain backdrop, for cold moonlit lighting only. DO NOT reproduce the landscape.
The object must have visibly dominant weathered WOOD wall surfaces with worn brown-gray timber grain, rough joints, some irregular stone foundation masonry, a dark wooden door, completely unlit little windows, aged roofing and light patchy alpine snow. Cinematic realism, realistic modest single-story shelter, not ornate fantasy, not cartoon. Three-quarter near-level view showing front and one side, complete silhouette with padding, recognizable at 160px wide. Faint cool moonlight from upper left, subdued brown wood remains identifiable inside the cold blue palette.
Only a minimal irregular foundation skirt touching the building, no landscape, no surrounding rocks spread far from the walls, no ground plane or floating shadow. Genuine transparent background, no gray gradient, no checkerboard, no halo. No people, animals, text, logos, borders, fire, flames, sparks, smoke, lanterns or lit windows. No sun or moon disc. One object only, no contact sheet.
Design: Closely develop the TOP MIDDLE hut in reference image 1 into a standalone timber-and-stone mountain shelter: low rectangular body, dark horizontal squared timber walls across most of the front and visible side, substantial rough stone corner piers and low stone plinth, an offset vertical plank door, one tiny recessed black window, rugged old wooden-shingle gable roof with light snow, a narrow uneven masonry chimney at the far right end. The wood should dominate about two thirds of the visible walls, with stones providing structural ends and base.
```

### beacons-hut-06-woodland-shelter.png

Saved to `art/in/beacons-hut-06-woodland-shelter.png`.

```text
Use case: stylized-concept.
Create ONE production-ready isolated hut sprite with genuine transparent alpha, ideally square 1024x1024.
Reference image 1 is the RECOVERED ORIGINAL DESIGN CONCEPT from the user's earlier chat. Its TOP ROW huts are the key design reference, especially the timber-dominant middle shelter and the steep-roof rustic mixed-material shelter on the right. Restore their weathered, practical, rough-built character.
Reference image 2 is the approved stone hut, for matching realistic material rendering and scale only. DO NOT turn the new hut into another all-stone house.
Reference image 3 is the approved mountain backdrop, for cold moonlit lighting only. DO NOT reproduce the landscape.
The object must have visibly dominant weathered WOOD wall surfaces with worn brown-gray timber grain, rough joints, some irregular stone foundation masonry, a dark wooden door, completely unlit little windows, aged roofing and light patchy alpine snow. Cinematic realism, realistic modest single-story shelter, not ornate fantasy, not cartoon. Three-quarter near-level view showing front and one side, complete silhouette with padding, recognizable at 160px wide. Faint cool moonlight from upper left, subdued brown wood remains identifiable inside the cold blue palette.
Only a minimal irregular foundation skirt touching the building, no landscape, no surrounding rocks spread far from the walls, no ground plane or floating shadow. Genuine transparent background, no gray gradient, no checkerboard, no halo. No people, animals, text, logos, borders, fire, flames, sparks, smoke, lanterns or lit windows. No sun or moon disc. One object only, no contact sheet.
Design: Develop the TOP RIGHT hut in reference image 1 into a distinct compact square TIMBER shelter: steep dark weathered wood-shingle gable roof, rough-hewn timber frame and aged vertical plank upper walls, a low rough stone knee wall/foundation under the wood, a small recessed plank door under the front gable, one small dark side window, modest narrow chimney tucked against the rear wall. Far more exposed wood than stone, rustic wind-worn mountain watch shelter, no porch, no tower. Keep the irregular old handcrafted character of the reference, not the clean blocklike masonry of reference 2.
```


---

## Superseded conical signal pyre — 2026-11-21

Historical generation, superseded by the square pyre below. Formerly saved as `art/in/beacons-pyre.png`. Generated with the built-in image_gen tool and transparent_background=true, using the approved mountain and timber/stone hut as style references. Preserved the original generated PNG and its alpha. Actual size: 1254 × 1254. Verified 995750 fully transparent pixels, a substantial opaque subject, and a complete unlit wood stack/stone-ring silhouette. No flames, glow, embers or smoke. Fire and animation remain application-rendered.

Reference inputs:
- `art/in/Moonlit Milky Way Over Alpine Peaks.png`
- `art/in/beacons-hut-05-timber-stone.png`

Exact prompt:

```text
Use case: stylized-concept.
Asset type: BeKin mountain beacon sprite, art/in/beacons-pyre.png. One isolated unlit signal pyre, square PNG with genuine transparent alpha.
Input image 1 is the approved mountain scene: lighting and realism reference only. Input image 2 is an approved timber-and-stone hut sprite: material texture and rendering reference only. Do not include a mountain, hut or any part of these reference images in the output.
Follow this project prompt:
A single unlit signal pyre in the same cinematic matte-painting style: a tall stack of rough-cut logs and branches built in a cone on a low ring of stones, about twice as tall as it is wide, clearly real dry wood with bark, ready to be lit but NOT burning. Seen straight on. Night, faint cool moonlight from the upper left. The pyre fills most of the frame and its base sits near the bottom edge. Transparent background, no ground, no shadow on the ground, nothing else in the image.
No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fire, flames, sparks, smoke, embers or glow anywhere.
Production details: match the detailed realistic bark, rough gray stone and restrained blue moonlight of the approved sprites. A believable carefully built tall conical signal stack, stout individual logs leaning together around smaller dry kindling, natural irregular wood ends and visible bark, low narrow rough-stone ring. Distinct narrow upright silhouette roughly 2:1 height to total width including stone ring. Show every tip and the complete stone base without cropping, with a thin transparent margin. Keep wood dry and unburned; no snow blanket over the fuel. Crisp clean cutout with genuine transparency through open gaps between logs where appropriate. No checkerboard, backdrop, gray gradient, opaque rectangle, halo, terrain, platforms or surrounding scenery. Square 1024x1024 canvas requested.
```


---

## Square pyre correction — 2026-11-21

User correction: "in lord of the rings, they have square pyres". The square crossed-log sprite now replaces `art/in/beacons-pyre.png`; the old cone is retained only at `art/references/beacons-pyre-conical-superseded.png`. Section 1d above contains the exact prompt used for the corrected asset.

Generated with the built-in image_gen tool, transparent_background=true, referencing the approved mountain and `beacons-hut-05-timber-stone.png`. Actual output 1254 × 1254 RGBA; 719389 fully transparent pixels; 817974 nearly opaque pixels. Visually checked on dark blue: squared horizontal log courses, square stone plinth, no fire/embers/smoke, full silhouette.


---

## Main foreground beacon — 2026-11-21

Completed step 1e: `art/in/beacons-main.png`. A broad square crossed-log main beacon with a substantial stepped stone platform, unlit. Built-in image_gen with transparent_background=true. Style reference: the approved `art/in/beacons-pyre.png`. Final sprite is 1254 × 1254 RGBA. Verified 937,649 fully transparent pixels and complete visible bounds (63, 318)–(1191, 1050); full platform fits within the canvas. Checked edges against dark blue.

### Initial prompt

```text
Use case: stylized-concept.
Asset: beacons-main.png, the user's own great mountain watch beacon, an isolated transparent PNG sprite.
Use the attached approved square signal pyre as the exact art-style and material reference. Create the larger MAIN BEACON in this family, not a duplicate resized copy. Keep the same realistic rough bark, dry heavy logs, weathered fitted gray stone and cold upper-left moonlight.
Project brief: The great signal beacon of the mountain watch, same cinematic matte-painting style: a large, wide stack of heavy logs laid in crossed courses on a square platform of fitted grey stone blocks, unlit, seen straight on. Night, faint cool moonlight from the upper left. It fills most of the frame and its base sits near the bottom edge. The top of the log stack is flat and about half the width of the image. Transparent background, no ground, no shadow, nothing else in the image.
Design: a broad low SQUARE stone dais of large fitted blocks with a single shallow projecting stone step around its base. A substantial square crib of thick heavy logs on its center, all major logs HORIZONTAL in alternating perpendicular crossed layers. The square log stack is slightly tapered inward and has a clearly flat top filled with dry kindling, with a top width around half the canvas width. The lower platform occupies about 80 percent of the canvas width. This is a major foreground beacon, broader and more deliberately built than the smaller reference pyre, with larger stones, thicker timbers and a generous visible stone platform lip. No ornate decoration. Nearly straight-on camera with a small amount of top-surface visibility, realistic perspective, complete silhouette and thin transparent padding. The structure should be distinctly wider than tall, a heavy grounded silhouette.
Unlit Gondor-inspired mountain signal structure, not a conical teepee, campfire, tower, house, brazier or basket. No vertical logs, no large central pole. Actual transparent alpha outside the entire structure and through open gaps where appropriate, no backdrop, checkerboard, gradient, opaque rectangle, glow halo, ground plane, terrain or external cast shadow. No snow covering the fuel. No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fire, flames, sparks, smoke, embers or glow anywhere. No moon or sun. One beacon only, no scene or collage. Square 1024 x 1024 canvas requested.
```

### Final framing edit

The first render reached the side edges; this edit produced the saved file, preserving the design while restoring clear margins.

```text
Edit the attached main beacon sprite. Preserve this exact square crossed-log beacon design, materials, stone platform, camera angle, cool moonlight, flat top and complete unlit state. Correct ONLY the framing: zoom out enough that the entire stone base and every side corner are fully contained within the canvas, with at least 6% transparent margin on the left and right and 5% below. The current image clips the extreme sides of the bottom step: restore those corners naturally. Center the complete object horizontally and vertically with balanced margins. No part may touch any canvas edge. Keep genuine transparent alpha background, no backdrop or cast shadow. Do not add fire, flames, smoke, embers, glow, people, text, symbols, terrain or other objects. Square PNG.
```


## Painted flame (optional) -> `art/in/beacons-flame.png` (square 1024 x 1024, BLACK background)

Status 2026-11-21: the chain fires already burn the same fire as your main pyre, only smaller.
This image is only worth making if that fire still looks too clean against the painting. If you
make it, it replaces the fire on BOTH the main pyre and the chain, so they stay identical.

Fire cannot be cut out cleanly, so do NOT ask for a transparent background. Ask for pure black:
the app adds the image onto the scene as light, and black adds nothing.

Prompt:

> A sprite sheet of one large bonfire flame, four frames in a 2 x 2 grid, each frame the same
> size and each flame centred in its cell with its base on the bottom edge of the cell. The four
> frames show the SAME fire at four different moments: the tongues lean and split differently in
> each, but the base width and overall height stay the same. A tall, roaring signal fire: wide at
> the base, breaking into several ragged tongues, a few loose sparks above. White-yellow at the
> core, deep orange in the body, dark red at the thinning tips. Realistic painted fire, the same
> cinematic matte-painting style as a moonlit alpine night scene. Background is PURE FLAT BLACK
> (#000000) everywhere, no gradient, no smoke, no glow haze, no ground, no wood, no logs, no
> embers bed. No grid lines, no borders, no text, no numbers.

Check before saving:
- Background is truly black, not dark grey or dark blue.
- All four flames are about the same height and their bases line up on the cell bottoms.
- No wood or ground under any of them (the pyre is already painted).
- No lines drawn between the cells.


---

## Campfire forest background — completed 2026-11-22

Completed step 3a: `art/in/campfire-bg.png`. Generated using built-in image_gen on 2026-11-21; resumed, visually checked and saved on 2026-11-22. No reference image was used: this follows the separate Campfire gouache style. Output is an opaque RGB PNG, exactly 1024 × 1536.

Visual checks: soft hand-painted blue-green forest, large framing trees, dim receding center, empty trodden-earth clearing in the lower third, dark grass below, no people, props, stars, fireflies or built-in fire/light effects. The top is visually nearly flat; generated pixels are not mathematically uniform #0A1620. Top-row RGB ranges: [(7, 10), (22, 26), (32, 35)]. For an exact app-color join, the app can blend its #0A1620 top overlay into this region. Original generated pixels are preserved.

### Exact generation prompt

```text
Use case: illustration-story.
Asset: BeKin Campfire skin background, art/in/campfire-bg.png.
Create one PORTRAIT image, 1024 pixels wide by 1536 pixels tall (2:3 aspect ratio). This is a finished scene background, not a phone mockup, no UI.
A storybook gouache illustration of a small clearing in an old forest on a summer night. Soft and hand-painted like a picture book, rounded brush shapes, subtle visible paint texture, realistic sense of depth but illustrated rather than photographic. Tall trees with thick trunks and soft heavy foliage stand close on the left and right edges, their branches arching toward each other high up; between them, straight ahead, more forest fades back into deep blue darkness in several soft layers. Ferns and long grass at the edges of the clearing. Deep blues and blue-greens, hand-painted texture.
Composition, exactly:
- The top fifth of the image is dark foliage and night sky fading upward to a single flat dark blue-green color (#0A1620) with no stars and no banding at the very top edge. The uppermost edge must be uniform solid #0A1620 across its entire width, with the foliage fully dissolved into it, so application code can extend the image upward seamlessly. Do not leave visible canopy contours or lighter texture at the very top edge.
- The middle of the image is open dark air between the trees: calm, dim, low contrast, nothing bright. Do not fill the center with busy leaves, branches, trunks, stones or high contrast details. Distant trunk layers fade softly into the dark center, leaving an airy spacious feeling.
- In the lower third, the clearing floor: a flat patch of bare trodden earth in the bottom center, about a third of the image wide, completely empty. Nothing stands on it. This patch is a suitable spot for a separate campfire sprite to be placed later. Its center is around 78% of the image height. Gentle perspective, natural oval shape, no stone ring or existing logs.
- The bottom tenth is dark grass, smoothly darkening toward the bottom edge.
No text, letters, numbers, logos, watermarks, borders or frames. No people or animals. No fireflies, no glowing dots, no fire, flames, sparks, smoke, lanterns or lights of any kind. No moon or sun disc. Night scene, lit only by faint cool moonlight from the upper left. No sunbeams, bright shafts of light, luminous mist or glowing clearing. No huts, buildings, tent, firepit, logs, chairs or props in the empty clearing. Not pixel art, not vector, not photographic. Quiet, intimate, gently beautiful night forest with restrained legible shapes.
```

### Asset progress after this save

5 of 11 planned asset slots complete; 10 production PNGs including the five additional hut variants.

| Slot | Status | Asset |
|---|---|---|
| 1a Mountain background | Complete | Moonlit Milky Way Over Alpine Peaks.png |
| 1b Hut | Complete | Original stone hut plus variants 02–06 |
| 1c Matching lit hut | Pending | beacons-hut-lit.png |
| 1d Square signal pyre | Complete | beacons-pyre.png |
| 1e Main beacon | Complete | beacons-main.png |
| 3a Forest background | Complete | campfire-bg.png |
| 3b Campfire logs | Next | campfire-logs.png |
| 4a Smoke Signal background | Pending | smoke-bg.png |
| 4b Signal fire | Pending | smoke-fire.png |
| 2a Castle background | Pending | castle-bg.png |
| 2b Watchfire basket | Pending | castle-basket.png |


---

## Campfire logs — completed 2026-11-22

Completed step 3b: `art/in/campfire-logs.png`. Generated with built-in image_gen and transparent_background=true, using `art/in/campfire-bg.png` as the style and palette reference. Soft storybook gouache, split logs over kindling inside rounded river stones, completely unlit. Original generated alpha retained. Actual size: 1254 × 1254 RGBA. Verified 1,113,261 fully transparent pixels, 432,541 nearly opaque pixels, and complete visible bounds (117, 302)–(1131, 1044). Visually checked on dark blue: no cropping, opaque backdrop, fire, smoke, embers or glow.

### Exact generation prompt

```text
Use case: illustration-story.
Asset: BeKin Campfire skin, art/in/campfire-logs.png, one isolated transparent PNG sprite on a square 1024x1024 canvas.
Use the attached approved forest clearing ONLY as the style and palette reference. Match its soft storybook gouache brushwork, rounded painted shapes, subtle visible paint texture, subdued dark blue-green night palette and gentle cool illumination. Do not reproduce the forest or ground.
A single unlit campfire in that exact storybook gouache style: a small group of split logs leaned together in a compact teepee over a nest of kindling, inside a low ring of rounded river stones. Cold, dry, completely unlit, prepared for a small intimate woodland campfire. Seen from the front, slightly from above, so the stone ring reads as a natural ellipse. Faint cool moonlight from the upper left. Softly painted muted brown wood and blue-gray rounded stones, readable but dim enough for the reference nighttime clearing. Not photoreal, not detailed 3D render, not vector or pixel art. Avoid hard black outlines.
One modest campfire arrangement only, not a tall signal pyre or a square beacon platform. The whole stone ring and every log tip must fit inside the square canvas. Center the object with at least 7% transparent padding on all sides. Genuine transparent alpha outside the stones and logs, and in empty gaps within the arrangement where ground would be visible. No added ground, terrain, dirt disk, drop shadow, backdrop, checkerboard, gradient, halo or opaque rectangle. Preserve naturally soft painted edges without a glow.
No text, letters, numbers, logos, watermarks, borders or frames. No people, animals, tents, chairs or other props. No fire, flames, sparks, smoke, embers, warm light or glow anywhere. No snow, stars, fireflies, lanterns, moon or sun. The fuel is unburned and the app will add fire later.
```

### Current asset progress

6 of 11 planned slots complete, 11 production PNGs including the five additional hut variants. Complete: 1a mountain background; 1b hut family; 1d square signal pyre; 1e main beacon; 3a forest background; 3b campfire logs. Remaining: 1c matching lit hut; 4a Smoke Signal background; 4b signal fire; 2a castle background; 2b watchfire basket. Next in the planned skin order: 4a, `smoke-bg.png` (daytime national-park-poster style).



---

## Smoke Signal desert background — completed 2026-11-22

Completed step 4a: `art/in/smoke-bg.png`. Generated using built-in image_gen, transparent_background=false, with no image references; this follows the separate daytime national-park-poster skin. Original output preserved as an opaque 1024 × 1536 RGB PNG.

Visual checks: upper two thirds open sky, smooth turquoise-to-peach color transition, low layered mesas, empty foreground sandstone bluff, sagebrush confined to the sides, shadowed lower rock, no text, people, buildings, fire, smoke, clouds, birds or sun disc. The top edge is visually near-uniform but not mathematically flat #7FB9C4. Actual top-row RGB ranges: [(120, 124), (176, 183), (187, 193)]. Use an app overlay if an exact UI-color join is required.

### Exact generation prompt

```text
Use case: illustration-story.
Asset: BeKin Smoke Signal background, art/in/smoke-bg.png. One finished portrait scene, exactly 1024 wide × 1536 tall (2:3). No phone mockup or user interface.
A mid-century national park travel poster illustration of high desert mesa country in the last warm light of late afternoon. Flat bold shapes, limited palette of warm sand, terracotta, dusty sage and a clear pale turquoise sky, subtle paper grain confined primarily to the terrain. A composed, quiet and beautiful desert vista with strong simple shapes; not photographic, not a 3D render, not fantasy concept art.
Composition, exactly:
- The TOP TWO THIRDS of the entire image is OPEN EMPTY SKY. The landscape horizon starts at about 68% down the image; no mountain or plant may protrude high into the sky region. Sky is one smooth clean gradient from pale turquoise at the top (the very top edge is a single flat color #7FB9C4) to warm peach near the horizon. The top edge must be uniform across the full width for seamless upward extension. Absolutely no clouds, cloudlike texture, birds, stars, sun, celestial objects, smoke, rays, contrails, specks, decorative swirls or other marks in the sky. Keep it empty and smooth for smoke graphics to be drawn later in code.
- A low horizon in the LOWER THIRD: distant flat-topped mesas and buttes in layered terracotta silhouettes, atmospheric separation through restrained warm color steps. Preserve the huge open sky above.
- In the bottom center, the nearest ground: the flat top of a rocky bluff, bare sandstone, about one third of the image wide, completely empty. Show the top surface in gentle perspective at around 80–87% of the image height, clearly large and flat enough for a separate signal-fire sprite to be placed later. Natural slab shape, subtle broad painted rock facets, no objects on it.
- Small dusty sagebrush at the lateral edges of the foreground only, leaving the central stone platform fully clear.
- The bottom tenth is darker rock in shadow, with bold simple forms that settle the bottom composition.
No text, letters, numbers, logos, watermarks, borders, decorative poster frames or labels despite the poster art style. No people, animals, tents, tipis, buildings, paths, fences, campfires, wood piles, stone fire rings or props. No fire, flames, sparks, embers or smoke of any kind anywhere in the sky or on the ground. No sun disc. This is the daytime skin, not a night scene. Full bleed opaque image.
```

### Current asset progress

7 of 11 planned slots complete, 12 production PNGs including five extra hut variants. Complete: 1a mountain background; 1b hut family; 1d square signal pyre; 1e main beacon; 3a forest background; 3b campfire logs; 4a Smoke Signal background. Remaining: 1c matching lit hut; 4b signal fire; 2a castle background; 2b watchfire basket. Next: 4b, `smoke-fire.png`, the separate unlit signal-fire sprite in the same poster style.


---

## Superseded juniper signal-fire sprite — 2026-11-23

Completed step 4b: `art/in/smoke-fire.png`. Generated with built-in image_gen, transparent_background=true, using `art/in/smoke-bg.png` as the style and palette reference. Low wide dry-stick/split-wood heap topped with green juniper boughs, inside a shallow sandstone ring, completely unlit. Original alpha retained. Actual size: 1254 × 1254 RGBA. Verified 1,189,756 fully transparent pixels, 334,542 nearly opaque pixels, and visible bounds (43, 406)–(1207, 876). Visually checked over a muted background: full silhouette, no backdrop or cropped stones, no fire, smoke, embers or glow.

### Exact generation prompt

```text
Use case: illustration-story.
Asset: BeKin Smoke Signal sprite, art/in/smoke-fire.png. One isolated transparent PNG on a square 1024x1024 canvas.
Use the attached approved desert background ONLY as the visual-style, palette and daytime-light reference. Match its mid-century national-park travel-poster illustration: bold flat painted shapes, restrained warm sand and terracotta palette, dusty sage accents, subtle paper grain. Not photographic, not a realistic 3D render, not a nighttime scene. Do not include the desert scene or sky.
A single UNLIT signal fire: a LOW WIDE heap of dry sticks and split wood with a bundle of fresh green juniper boughs laid across its top, sitting in a shallow ring of flat sandstone slabs. Show the green foliage clearly as actual small juniper branches with dense muted sage-green needles, not smoke or flame shapes. The loose kindling and dry wood remain visible beneath the boughs. All fuel unburned and cold, ready for smoke-signal use later.
Seen from the front, slightly from above, with an elliptical low ring of irregular flat warm sandstone slabs. Short, grounded, broad silhouette, more than twice as wide as the fuel mound is tall. This is not a tall teepee, tower, square pyre or stone platform. Keep shapes readable when reduced to a small sprite. Soft warm late-afternoon light from upper left, matching the attached landscape, with simple poster-style shadow facets on objects.
Center the complete arrangement with at least 8% fully transparent margin on every side; no stone or twig may be cropped. Genuine transparent alpha outside the objects, and through empty gaps where ground would show. No ground, soil disk, backdrop, checkerboard, surrounding terrain, drop shadow, floating cast shadow, gradient or halo.
No text, letters, numbers, logos, watermarks, borders or frames. No people, animals, buildings or props. No fire, flames, sparks, smoke, embers or glow anywhere. No moon, sun disc, stars or snow. One firewood-and-juniper arrangement only; not a scene, collage or sheet of variants.
```

### Current asset progress

8 of 11 planned slots complete; 13 production PNGs including five additional hut variants. Complete: 1a mountain background; 1b hut family; 1d square signal pyre; 1e main beacon; 3a forest background; 3b campfire logs; 4a desert background; 4b signal-fire sprite. Remaining: 1c matching lit hut; 2a castle background; 2b watchfire basket. Next in the original skin order: 2a, `castle-bg.png`, the Old Guard castle-wall background.



---

## Smoke Signal historical correction — 2026-11-23

The original juniper specification was not substantiated for this particular depiction. Research did NOT establish that juniper was never used; it did not verify our specific green juniper/berry bundle. Do not claim it is a documented reconstruction or use generic references to cedar to infer a precise botanical juniper identification.

A supported alternative is pine boughs. Garrick Mallery, *Sign Language Among North American Indians Compared With That Among Other Peoples and Deaf-Mutes*, First Annual Report of the Bureau of Ethnology (published 1881), section “Smoke Signals of the Apaches,” reports information obtained by W. J. Hoffman from Apache chiefs. It names pine or cedar boughs, leaves and grass as smoke-producing materials in northern New Mexico. Readable transcription: https://www.cyberlibrary.org/en/books/sign-language-among-north-american-indians-compared-with-that-a-525c31c4/chapters/30/

The new sprite therefore replaces juniper with recognizable pine boughs, without claiming a particular pine species. The sandstone ring and exact arrangement remain visual design choices; the source verifies the fuel category, not every detail of the illustration. The sprite depicts prepared, unlit fuel for application animation, not an active historical signaling operation. Preserve the approved poster style: the user's request for realism here concerns supported content, not a switch to photorealism.

Replaced production file: `art/in/smoke-fire.png`. Prior image retained as `art/references/smoke-fire-juniper-superseded.png`. Built-in image_gen edit with transparent_background=true. Final: 1254 × 1254 RGBA; 1,206,778 fully transparent pixels; 301,548 nearly opaque pixels; visible bounds (43, 420)–(1208, 878). Visually verified pine needles, no juniper berries, intact stone ring/wood, full margins, no fire/smoke/glow. Progress remains 8/11. Castle generation has not started.

### Exact correction prompt

```text
Edit the attached BeKin Smoke Signal sprite. Correct the vegetation only, preserving the established warm mid-century national-park-poster art style, flat painted shapes, subtle paper grain, sandstone ring, underlying dry sticks and split wood, low wide silhouette, front slightly elevated camera, daytime upper-left lighting, and genuine transparent background.
Remove ALL existing juniper foliage and round blue-gray juniper berry cones. Replace it with a few freshly cut GREEN PINE BOUGHS loosely laid across the top of the dry fuel. They must be botanically recognizable as pine: slender woody twigs bearing clusters of distinct fine long needle-like leaves, with visible individual needle strokes in the simplified poster style. No rounded or scale-like juniper leaf sprays, no broad leaves, no berries, no round decorative fruit, no flower bouquet. Do not tie or decorate the boughs; make them utilitarian gathered fuel placed irregularly, with some wood still clearly exposed below. Moderate amount of pine foliage, not an ornamental wreath or dense bush.
Historical design basis: the account titled Smoke Signals of the Apaches in Garrick Mallery's Sign Language Among North American Indians explicitly names pine or cedar boughs, leaves and grass. Use PINE, not a guessed specific pine species. This is an unlit prepared fuel asset, not a depiction of an operating signal.
Keep every stone, twig and needle contained within the square canvas with a clear transparent margin on all sides. Genuine alpha transparency outside the sprite and through open gaps. No opaque background, ground patch, shadow outside the footprint, checkerboard or halo.
No fire, smoke, flames, sparks, embers, warmth or glow. No people, text, logos, symbols or other objects. Preserve the existing illustrated visual style, do not change to photography.
```



---

## Old Guard castle-wall background — completed 2026-11-23

Completed step 2a: `art/in/castle-bg.png`. Generated with built-in image_gen, transparent_background=false, with no image references. Original generated 1024 × 1536 RGB PNG preserved.

Visual checks: realistic weathered stone masonry, framing merlons at left/right, empty central horizontal capstone platform supported by masonry, dark flagstone wall walk below, distant wooded hills and a small unlit watchtower on the right. No torches, baskets, flames, smoke, lit windows, flags, people, moon or stars. The top edge is visually near-uniform, not mathematically flat #0A0F1C. Actual top-row RGB ranges: [(5, 9), (12, 15), (25, 28)]. An app overlay can provide an exact UI-color join if needed.

### Exact generation prompt

```text
Use case: historical-scene.
Asset: BeKin Old Guard background, art/in/castle-bg.png. One finished portrait background exactly 1024 pixels wide by 1536 tall (2:3). No UI or phone mockup.
A realistic digital painting, like a restrained historical illustration, of the view from the wall walk on top of a medieval castle curtain wall at night. We stand on the wall walk looking outward over the parapet. Weathered gray limestone, believable coursed masonry with worn mortar, a little moss in the joints, thick solid capstones and authentic irregular weathering. Simple practical medieval architecture, not ornate fantasy, not cartoon.
Composition, exactly:
- The top fifth is empty night sky that fades upward to a single flat dark blue-black #0A0F1C. At the very top edge, one uniform color across the entire width: no stars, clouds, grain or gradient banding there. Leave the sky quiet for extension above the image.
- The upper middle is a calm dark distant landscape beyond the wall: low wooded hills receding in soft blue-gray layers and ONE far-off plain stone watchtower on a hill toward the right, small, dark and unlit. The landscape is dim and low contrast, not a bright epic panorama. No large mountain peaks, no village lights, no castle skyline filling the center.
- Across the LOWER THIRD runs the crenellated parapet of our wall, seen from behind at roughly chest height. Tall solid merlons frame the far LEFT and far RIGHT only. In the CENTER there is a wide open embrasure with a flat EMPTY stone platform formed by the broad horizontal top of the lower parapet wall. This central platform is about one third of the image width, centered around 76–82% of image height, viewed slightly from above so its top surface is clearly visible and can support a separate iron watchfire basket sprite later. Solid supporting masonry beneath it. Do not put a tall merlon in the center. The empty opening above the low central platform reveals the distant hills.
- The bottom tenth is the dark worn flagstone of the wall walk, nearest the viewer. Correct continuous masonry geometry and believable perspective. We stand on the inside of the wall; do not show a walkway projecting out over a cliff.
Lighting: night, lit only by faint cool moonlight from upper left. Readable soft cold highlights on left capstone edges, deep navy-gray shadows, muted gray stone. Calm and grounded, fine realistic stone texture without oversharpening.
No text, letters, numbers, logos, watermarks, borders or frames. No people, animals, banners or flags. No fire, flames, torches, braziers, sparks, smoke, lanterns, lit windows, warm glow or other lights anywhere. Absolutely NO existing basket or object on the empty central platform. No moon or sun disc, no stars, no bright beams or luminous mist. Full bleed opaque portrait image.
```

### Current asset progress

9 of 11 planned slots complete; 14 production PNGs including five extra hut variants. Remaining: 2b `castle-basket.png` (next), and 1c matching lit hut. Smoke Signal uses the corrected pine-bough sprite, not the superseded juniper version.


---

## Old Guard tower-beacon alternative — 2026-11-23

User requested a trial of a dedicated tower beacon platform after questioning the previous parapet-ledge placement. Saved as `art/in/castle-bg-tower-platform.png`; the earlier `art/in/castle-bg.png` remains available. This alternative is awaiting visual feedback; it has not been wired into application code.

Historical basis: Historic Environment Scotland documents a corbelled beacon platform at the south crow-stepped gable apex of Hollows/Gilnockie Tower: https://portal.historicenvironment.scot/apex/f?p=1505:300:::::VIEWTYPE,VIEWREF:designation,LB3527 . This image adapts that architectural principle for the game. It is not an exact reconstruction of Gilnockie, and the source does not establish the exact proposed iron-basket design. The earlier generic basket-on-parapet arrangement was an unverified design choice.

Created using built-in image_gen, transparent_background=false. First generation used the earlier castle background as a style/palette reference, then a framing edit lowered and reduced the tower to meet the UI layout. The background remains unlit, with no fuel or basket: animated fire is added by the application.

Final validation: 1024 × 1536 RGB PNG. Visually checked: bare top surface approximately x=316–705 and y=1142–1182; substantial corbels tied into gable masonry; descending crow steps; slate roof at bottom right; distant unlit watchtower; calm upper sky. No flames, smoke, people, text or props. Actual platform width is about 38% of canvas width. Top edge is visually dark, not certified mathematically uniform. Original generated pixels preserved in saved PNG.

### Exact initial generation prompt

```text
Use case: historical-scene.
Asset: BeKin Old Guard alternative background, castle-bg-tower-platform.png. Full-bleed opaque portrait PNG, 1024x1536.
Input image: existing castle background is a STYLE AND NIGHT PALETTE reference only. Redesign the foreground architecture completely; retain its restrained realistic painted stone, dark blue night mood and distant low wooded hills.
Primary request: replace the ordinary curtain-wall ledge with a DEDICATED CORBELLED BEACON PLATFORM AT THE APEX OF A STONE TOWER'S CROW-STEPPED GABLE. Architectural inspiration is the documented south-gable apex beacon platform of Gilnockie/Hollows Tower, Scotland. This is an original game-art adaptation, not a measured reconstruction of the real tower.
Composition: camera outside the upper part of a sturdy Scottish border tower, a close slightly elevated three-quarter view. The entire tower base is below the frame. In the lower third, the upper gable wall rises toward a central broad stone beacon stance. Its empty flat top is clearly visible at about 77% of frame height, centered, approximately one third of the image width. The dedicated stance projects outward from the gable apex on several substantial stepped stone corbels that visibly connect it to the supporting gable masonry. The crow-stepped shoulders descend from the apex to left and right toward the bottom corners. A modest dark slate roof recedes behind the gable to the right, mostly low in the frame; roof ridge remains below the beacon platform. The geometry must read as a solid elevated tower-top beacon support, not a freestanding altar, bridge, shelf across a window, or ordinary battlement gap. Keep the top completely bare and level, with clear sky or distant landscape immediately above for a separate unlit beacon fuel sprite later. No basket yet.
Upper half and middle: expansive calm deep navy night sky above low distant wooded hills, subtle atmospheric layers. One tiny unlit distant watchtower on the far right hill. No dramatic mountains. The top fifth fades to visually uniform dark blue-black #0A0F1C without stars or clouds at the top edge, suitable for sky extension. Keep the middle dark and quiet for application overlays. Bottom tenth is shadowed tower masonry, not a ground-level courtyard or wall-walk floor.
Realistic historical-illustration rendering, weathered rough coursed gray stone with worn mortar, restrained lichen, thick believable load-bearing corbels, softly defined cold highlights. Faint cool upper-left moonlight only, no visible moon, no bright beams. Detailed but not oversharpened, not cartoon, no ornate fantasy elements.
Absolutely no fire, flames, torches, sparks, embers, smoke, warm light, lanterns or lit windows. No fuel, wood heap, brazier or props on the platform. No people, animals, flags, modern rails, text, numbers, logos, watermarks, frame, sun or moon disc. Preserve a clean empty beacon stance. One image only.

```

### Exact framing edit prompt

```text
Edit this tower-beacon background only to correct framing for the game layout. Keep the same dedicated corbel-supported stone beacon stance at the apex of the crow-stepped gable, the weathered stone rendering, roof, distant wooded hills and tiny distant right watchtower, dark blue night palette and empty starless sky. Change the camera framing so the tower architecture occupies only the BOTTOM THIRD of the portrait: the EMPTY PLATFORM TOP must be centered horizontally at y=1170 in a 1024x1536 image (about 76% down), and be about 370 pixels wide (36% of image width). Show its complete flat top in gentle perspective and the supporting corbels and upper crow-stepped gable below. Let the rest of the tower continue out of frame below. Dark roof recedes at bottom right. Do not put extra masonry or any tower structure in the middle of the image above y=1120. Leave the top two thirds quiet and open, with the same distant low wooded landscape. Do not add props or fire. No basket, fuel, flames, smoke, sparks, embers, people, text, lights, stars or moon. This is a framing correction, preserve the architectural design and realistic painted style. Output opaque portrait 1024x1536 PNG.

```


---

## Old Guard signal basket and full integration handoff — 2026-11-23

### User decisions

The user explicitly asked to retain both castle scenes because their preference is undecided. Both original backgrounds are preserved byte-for-byte. The user also asked for real-world references and full notes for Claude. The first low rectangular basket was rejected: it read as a small heating grate rather than a substantial signal beacon. A deeper circular basket with a larger fuel load replaces that design. The replacement was subsequently approved by the user on 2026-11-23: “the final option looks good, i like the circle full of wood.”

### Asset manifest

| File | Role | Status |
|---|---|---|
| `art/in/castle-bg.png` | Original curtain-wall background | Preserve as selectable alternative; no verified specific ledge-fire reference |
| `art/in/castle-bg-tower-platform.png` | Corbelled gable-apex platform background | Preserve as selectable alternative; Gilnockie-inspired architectural principle |
| `art/in/castle-basket.png` | Deep circular unlit signal-beacon sprite | Approved final circular basket |
| `art/references/castle-basket-small-rejected.png` | Shallow rectangular heating-grate-like attempt | Rejected; reference archive only |

### Sources and what they actually support

1. Historic Environment Scotland, **Hollows or Gilnockie Tower, LB3527**: documents the south gable's corbelled apex beacon platform. Supports a dedicated tower-gable beacon stance, not our exact dimensions, basket mounting, composition or fuel. https://portal.historicenvironment.scot/apex/f?p=1505:300:::::VIEWTYPE,VIEWREF:designation,LB3527
2. Historic England, **Beacon mound at Fire Beacon Hill, 1019949**: describes wood/furze bonfires and later iron fire baskets on poles, with some sites using towers. Supports the historic signal-fire/fire-basket category. The modern basket at that site is not a surviving medieval artifact. https://historicengland.org.uk/listing/the-list/list-entry/1019949
3. Trinity House, **North Foreland Lighthouse**: records a coal-burning iron grate atop the 1636 tower, and substantial later coal use. This is an actual elevated navigation fire, but is early modern, maritime and coal-fired. It does not authenticate our wood-loaded cage as a medieval Scottish castle installation or establish a distance at which ours could be seen. https://www.trinityhouse.co.uk/lighthouses-and-lightvessels/north-foreland-lighthouse
4. Danish heritage agency, **Fyranlæg introduction**: describes early suspended iron baskets and the Skagen lever beacon erected in winter 1626–27. Used as a reference for an elevated iron fuel container, not as a source for our fixed-foot mounting or wood load. The present Skagen visitor structure is a reconstruction, not the original artifact. https://slks.dk/fileadmin/user_upload/kulturarv/publikationer/emneopdelt/bygninger/tema/fyranlaeg/indledning.pdf
5. **Rejected direction:** MEV 4465, Museu d’Art Medieval, a 14th-century Catalan wrought-iron rectangular brazier, 26×61×46.5 cm. The museum identifies church heating/incense-fuel purposes. Its riveted construction informed the rejected low grate, but its function/scale was a poor match for our signal-beacon task. Do not cite this artifact as proof of a castle signal basket. https://museuartmedieval.cat/en/colleccions/forge-work/brazier-mev-4465

The new cage's circular shape, mild flare, exact bands/rivets, braced feet, large wood load and target scale are art/design decisions. Prompt dimensions of roughly 1.3 m rim diameter and 0.9 m cage depth are illustrative targets, not recovered artifact measurements or an engineering plan. Actual signal visibility depends on fire output, sightlines and conditions; no tested visibility range is claimed.

### Rendering, validation and placement

Built-in image_gen, transparent_background=true, using the tower background only for style, lighting and viewpoint. Final source canvas is 1254×1254 RGBA (requested 1024 square; preserve original resolution). True transparent pixels: 707,776; nearly opaque pixels (alpha >=250): 825,633. Visible bounds at alpha >=128: x=96..1153, y=52..1222 (exclusive box [96,52,1154,1223]). Full sprite intact; feet and log ends have transparent margins. Top/bottom margins are tighter than the requested 8%, but no visible geometry is cropped. Visually checked: deep circular cage, multiple bands, hefty fuel layers, braced feet, no fire/smoke/glow or background. Original generated alpha and pixels retained.

Do not size this sprite by the entire square canvas without accounting for alpha margins. Visible width=1058, height=1171. A source-space bottom-contact anchor of approximately (625,1223) is a useful initial anchor; fuel is above the upper rim (approximately y=290–380), with the uppermost wood at y=52. Animate fire from the fuel region, not from the foot or the image center. Keep the front iron rim/ribs in front of some flame layers for depth. Add a restrained contact shadow beneath the feet in the app. Match cold unlit grading to the selected background; brighten nearby wood/iron/stone only in the active state.

Starting placement estimates on the native 1024×1536 backgrounds (NOT yet verified as rendered composites; tune with the actual app overlays):

| Background | Visible basket width | Source scale | Bottom contact target | Full-canvas top-left, approximately |
|---|---:|---:|---|---|
| Tower platform | 230 px | 230/1058 = 0.2174 | (512,1173) | (376,907) |
| Castle wall | 340 px | 340/1058 = 0.3214 | (512,1080) | (311,687) |

Tower platform top occupies approximately x=316–705, y=1142–1182. Keep all feet on the top plane; the nearest foot can sit close to its front edge. Original wall top is broadly x=160–850, y=1010–1100, with perspective variation; test foot contact carefully. These settings are alternative compositions, not equal physical scale across two different camera views. Use uniform scale only. Do not stretch a round basket or distort its legs. Both backgrounds retain their existing sky and landscape. The top rows are visually dark but not certified exactly flat; use the app's sky blend if needed.

### Exact final generation prompt

```text
Use case: historical-scene.
Asset: BeKin Old Guard large SIGNAL BEACON fire basket, transparent square sprite, requested 1024x1024.
Input: supplied castle tower background is ONLY the palette, surface realism, cool lighting and camera reference. No scenery in output.
Create a substantial TOWER-TOP SIGNAL BEACON, a deep open iron cage holding a large mass of dry wood. It should look capable of supporting a conspicuous bonfire on a stone tower, with visual mass comparable to a large barrel or small hogshead, not a domestic hearth grate or decorative garden firepit.
Historical design grounding: real early signal beacons used iron fire baskets; early maritime beacons such as Skagen's lever light used suspended iron fuel containers, and North Foreland's 1636 light had a coal-burning iron grate atop a tower. Adapt the deep iron-container principle to a fixed stone-platform mount with WOOD fuel; this is an original historically informed game asset, not a claimed replica of either maritime beacon. Do not depict the lever, tower, coal or landscape.
Shape: a broad deep ROUND iron cage, mildly flared outward toward the open top, approximately 1.3m across its rim and 0.9m deep as an artistic scale target. Overall silhouette with fuel and low feet about as tall as it is wide. Three substantial circular horizontal bands reinforced with heavy closely spaced vertical forged iron ribs and large handmade rivets. Coherent bottom grate supports the fuel. Four short stout braced iron feet integrated into a broad low support frame, stable wide footprint, no tall single stem, no ornamental pedestal, no slab.
Fill the cage substantially with many hefty dry split logs in several irregular crossed layers, leaving believable air gaps and finer kindling below. A dense but airy mound rises approximately one quarter of the cage depth above the rim. Numerous visible log ends and substantial layered fuel volume, not three or four small pieces. The logs are all securely contained, no absurd towering loose stack. The basket must remain visibly deep even with fuel inside. Dark iron ribs and broad bands readable at phone size.
View near front slightly from above so the elliptical open rim and fuel load are readable, compatible with the tower-platform background. Cool realistic historical-illustration painting, hand-forged matte black iron with blue-gray edge highlights and restrained hammer texture, natural dark brown dry wood with lighter split grain. Upper-left cool moonlight, no warm light. Entire assembly UNLIT and cold.
SQUARE CANVAS. Center the whole beacon and show all feet and log ends with at least 8% fully transparent margin on every side. Genuine transparent background including empty gaps in the cage and beneath feet. No ground, stone, plinth, external cast shadow, background color, checkerboard or halo. No fire, flames, sparks, embers, smoke, people, flags, decoration, spikes, heraldry, letters, logos, watermark, snow or green foliage. One imposing deep signal-beacon cage only, no other objects.

```

### Rejected rectangular version — exact prompt retained for audit

```text
Use case: historical-scene.
Asset: BeKin Old Guard watchfire sprite, castle-basket.png. One isolated object on a genuinely transparent square 1024x1024 PNG canvas.
Input image: tower-platform background is a reference for realistic painted materials, cool upper-left night lighting, and mildly elevated viewpoint ONLY. Do not reproduce any scenery or architecture.
Create a low, broad RECTANGULAR wrought-iron fire basket on FOUR SHORT CORNER LEGS. Adapt the construction principle of the surviving 14th-century Catalan brazier MEV 4465: rectangular openwork body, four legs, forged and riveted iron crosspieces. This is a simplified game design informed by a real medieval brazier, not an exact replica or claim that the Catalan church brazier was a Scottish signal beacon. Replace ornamental opposing spirals with plain closely spaced vertical iron bars joining two horizontal straps on each side, visible handmade rivet heads, a strong rectangular top rim, and a close-spaced iron bottom grate that actually supports fuel. No high pedestal or square plinth. Short corner legs slightly splayed with small flattened feet, all on the same plane, robust load-bearing silhouette.
A modest load of DRY SPLIT FIREWOOD with smaller dry kindling nested beneath, lying naturally in a low crisscross heap inside the basket, some split logs rising just above the rim. Solid realistic timber grain and pale cut faces, no charcoal-black illusion of already burning fuel. Fuel restrained enough that the iron construction remains clearly readable. Entire assembly cold and unlit.
Front view slightly from above and mildly from the right, so the wide front, narrow right side and open top are visible, compatible with the attached platform. Width roughly 1.7 times overall height including fuel and feet. Frame the entire object centered with at least 8% transparent margin on all four sides, including feet and stick ends. No cropping. Make all four legs structurally coherent; rear feet can be partially occluded naturally.
Realistic restrained historical-illustration digital painting, matching the background. Dark forged iron with subtle hammer texture, matte weathered surface and sparse cold steel edge highlights, not orange rust, shiny chrome, modern welded barbecue or decorative fantasy. Dark natural brown wood, faint cool blue moonlight from upper left, readable silhouette at small display size.
Keep genuine alpha outside the silhouette, beneath the legs and through empty openwork gaps. No opaque background, checkerboard, gradient, floor, ground shadow, stone slab, architectural base, surrounding scenery or halo. No flame, fire, sparks, embers, smoke, warm glow, snow, green vegetation, people, animals, letters, logos, watermarks or extra props. One single unlit loaded iron basket.

```

Square-canvas correction of that rejected version:

```text
Same iron basket and firewood exactly, same cool realistic painted style and genuine transparent background. Correct only the CANVAS to SQUARE 1024x1024, keeping the complete rectangular four-legged basket at its existing proportions, centered with transparent space above and below and at least 8% transparent margins left and right. Do not stretch the object or make the basket itself square. Preserve every foot, bar, rivet and log, no crop. Transparent background PNG, no ground, no shadows outside the object, no fire, smoke or glow.

```

### Checksums (SHA-256)

- `castle-bg.png`: `232423af0684d73badaac42ffa4459737f798b4cef992243e949cf90e945e80a`
- `castle-bg-tower-platform.png`: `46592fbb636e7dac0e2885976b9278146646e2e4c3f33b08660c45e3eb8179ca`
- `castle-basket.png`: `adcc94123ac766ec3f2e89624bd1652d13ad989aec1083b00953b5176fdcce10`


---

## Final asset audit and user approval — 2026-11-23

The user approved the final circular basket full of wood. Verified `art/in/castle-basket.png` is that exact approved file: SHA-256 `adcc94123ac766ec3f2e89624bd1652d13ad989aec1083b00953b5176fdcce10`. It is the ONLY basket file in `art/in`. The rectangular rejected attempt is archived ONLY at `art/references/castle-basket-small-rejected.png`; it is not production input. No rejected rectangle was copied into `art/in`.

Both `castle-bg.png` and `castle-bg-tower-platform.png` remain in `art/in` as explicitly requested. The user has not chosen between them. Retain both; basket approval does not select a background.

Correction: that earlier completion claim omitted required slot 1c. All 11 source images were requested. The separate lit-hut PNG has now been generated and saved; see the final 11-slot manifest below. Existing built app assets were never a substitute for this input.

No application code or existing generated app assets were changed during this audit. Claude should consume the requested source images, including the separate lit-hut PNG supplied below, and preserve both castle background options.


---

## Required eleventh source image supplied — lit hut, 2026-11-23

The user corrected the assistant: all 11 prompt slots are required as art inputs. The assistant had incorrectly treated a build-script note as permission to cancel slot 1c. That interpretation is withdrawn. Claude must not treat generated WebP site composites or build functions as fulfilling the separately requested lit-hut PNG. The missing image has now actually been generated and saved.

### Current 11-slot source manifest (files verified present)

| Slot | Requested art | File in `art/in` |
|---|---|---|
| 1a | Mountain background | `Moonlit Milky Way Over Alpine Peaks.png` |
| 1b | Original hut (plus five variants) | `a_realistic_highly_detailed_isolated_png_transpar.png` |
| 1c | Matching lit hut — newly supplied | `beacons-hut-lit.png` |
| 1d | Square signal pyre | `beacons-pyre.png` |
| 1e | Main beacon | `beacons-main.png` |
| 2a | Castle background (tower alternative also retained) | `castle-bg.png` |
| 2b | Approved circular signal basket | `castle-basket.png` |
| 3a | Forest background | `campfire-bg.png` |
| 3b | Campfire logs | `campfire-logs.png` |
| 4a | Desert background | `smoke-bg.png` |
| 4b | Pine-bough signal fire | `smoke-fire.png` |

The original approved background and hut retain their user-provided filenames. No source image was renamed. Extra hut variants 02–06 and `castle-bg-tower-platform.png` remain available. Both castle backgrounds are still undecided alternatives. Only the approved round `castle-basket.png` is in production input; the rejected rectangle remains in `art/references`. The new lit hut is generated and supplied, not yet user-approved.

### Lit-hut provenance and use

- Built-in image_gen EDIT of `art/in/a_realistic_highly_detailed_isolated_png_transpar.png`, with transparent_background=true. No new hut design or image composed by the build script.
- Output: `art/in/beacons-hut-lit.png`, 1536×1024 RGBA, matching the original canvas dimensions. Warm amber light in all three existing windows and a thin line beneath the closed door, with localized spill onto nearby stone/step. No visible exterior flame, smoke, lantern or new object. Cool exterior lighting retained.
- Transparency checked: alpha range 0–254, 653,784 fully transparent pixels. Gray/black RGB matte under alpha zero is hidden color data, not an opaque backdrop. Preserve alpha.
- Visible bounds (alpha >=128, exclusive): new [9,14,1535,1010]; original [2,16,1535,1009]. Visually matching overall hut geometry/framing, but generative editing changed some fine stone/snow details and slightly shifted outer bounds. Do not describe the pair as pixel-identical or assume a difference mask contains lighting only. Use the same full-canvas transform for both; preview the transition before shipping. Do not trim each state independently or stretch one to the other's alpha bounds.
- The historical/real-world consideration here is restrained interior light through the existing apertures, with localized spill. No new building type, historical object or documented period reconstruction is claimed. The original approved hut remains the architecture reference.
- Do not apply the generic “no lit windows” rule to 1c: warm windows and the under-door glow are the explicit purpose of this slot. Other fire/fuel assets remain unlit for app animation.

### Exact built-in imagegen edit prompt

```text
Use case: lighting-weather.
Asset: BeKin slot 1c, matching occupied/firelit hut sprite, beacons-hut-lit.png.
EDIT TARGET: the attached original approved stone hut. Same image exactly, same 1536x1024 canvas and framing, same genuine transparent alpha background. This is a matching alternate state for swapping with the original sprite, NOT a new hut design.
Change ONLY the lighting originating inside the hut: all three existing small windows now have a restrained warm amber-orange glow from a low interior hearth, strongest within the window openings, with the existing wooden window mullions and frames remaining dark and clearly visible. Add a very thin warm line through the existing gap beneath the wooden door. A little soft warm light spills onto the immediate window stone reveals and the doorstep/snow directly below the door. Natural subtle firelight, uneven and softly graded, not flat neon yellow panels or powerful searchlight beams. Keep the door fully closed, with the same ironwork.
Preserve the original building geometry, perspective, exact position and silhouette: chimney, chimney openings, slate roof, snow patches, every stone, window size and position, door, surrounding existing rocks and grass, and the original cool moonlit exterior palette. Do not add any new openings, fixtures, objects or scenery. Do not brighten the entire roof, chimney or walls. The only visible change is the interior warm light and its small nearby spill.
Keep the source object's edge and transparency, including its existing snow/rock base. The gray/black matte visible behind the source is NOT scenery and must not become an opaque backdrop. Genuine RGBA transparency everywhere outside the original hut/rock silhouette. No background, checkerboard, shadow plane, added terrain or glow cloud beyond the sprite. No visible flames, fire outside, embers, sparks, smoke, people, animals, lanterns, text, labels, logos or watermark.
Preserve landscape 3:2 1536x1024 to match this actual original 1b file; do NOT convert to square or recenter/resize the hut. One matching lit-state image only.

```

SHA-256: `307bc5ebe0208b927ca9f65ae0abf8cde5d35a1aa8f9ceca1f036944868634c1`
