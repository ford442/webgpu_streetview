# Scene-depth / semantic fixture

`alley.jpg` — a street photo the scene-depth e2e (`e2e/scene-depth.spec.ts`) and
the depth look captures (`scripts/capture-depth-looks.mjs`) feed through the
production renderer in place of a Street View frame: near walls on both sides,
a far doorway, sky above — the shape a screen-Y depth proxy gets wrong.

| | |
|---|---|
| Source | [Wikimedia Commons: Tree-sun-road-street-house-town-1063073-pxhere.jpg](https://commons.wikimedia.org/wiki/File:Tree-sun-road-street-house-town-1063073-pxhere.jpg), via [PxHere](https://pxhere.com/en/photo/1063073) |
| License | **CC0 1.0** (public domain dedication) |
| Changes | downscaled to 640 px wide, re-encoded |

`street.jpg` — the semantic-scene e2e (`e2e/scene-semantic.spec.ts`, #352): a
downtown street with open sky, the road, bare trees in front of brick shops and
parked pickups — every class the weather and night effects treat differently.
(The alley is out of distribution for a Cityscapes model: even the full-size
upstream network calls most of it vegetation.)

| | |
|---|---|
| Source | [Wikimedia Commons: Wheatland Wyoming 9th St.jpg](https://commons.wikimedia.org/wiki/File:Wheatland_Wyoming_9th_St.jpg), by Jamesmartin111 (own work, 2020) |
| License | **CC0 1.0** (public domain dedication) |
| Changes | 1280 px rendition cropped to the fixture's 640∶528 aspect (left edge at 30% of the spare width), resized to 640×528, re-encoded |
