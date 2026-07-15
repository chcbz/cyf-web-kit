# Songjiang Review Asset Provenance

## Canonical source and reproducibility boundary

- `sample-a.png` is the canonical approved source artwork. Its SHA-256 is `12d93d364e2785cb5dd92c77c85d7928c3e503c4eeced5f1ac0bcf74c4fa2343`.
- The approved direction was originally exploration Sample H. The duplicate H binary is not retained in this release review directory; canonical A preserves those approved bytes.
- Source A was created using the built-in `image_gen` mode, not the CLI/API fallback.
- The built-in tool did not expose a model version or seed in the review history. Therefore source generation is **not bit-reproducible**, and this record does not claim that it is. The committed `sample-a.png` is canonical.
- Only B/C raster derivation, `target-scale-preview.png` composition, and the 45-degree versus 55-degree hall comparison are deterministic from committed inputs. Image-generated A/45/55 source artwork is not bit-reproducible.

## Verbatim available built-in generation prompt for H/A

The following is the built-in tool's `revised_prompt` recorded in the review history, reproduced verbatim. The unusual `72每96` text is retained exactly as stored in that history.

```text
Use case: stylized-concept
Asset type: mobile game chibi character style-review sample, Sample H
Primary request: Create a highly readable Q-version / super-deformed Song Jiang for a mobile hall map, designed to remain recognizable at 72每96 px height.
Subject: 2.8-head-tall heroic chibi proportions, oversized head and official winged black hat, strong thick eyebrows, compact mustache and pointed beard, broad dignified stance, one hand confidently resting near an oversized ornate leader belt buckle. Simplify the Northern Song black robe into large charcoal shapes with a bright oxblood-red inner panel and bold antique-gold trim. Exaggerate the hat, beard, red sash, and belt as signature features.
Style: clean polished 2D mobile strategy-RPG chibi, thick controlled outline, high-contrast flat cel shading, minimal small details, large expressive face and hands.
Composition: exactly one centered full-body character, front three-quarter view facing slightly right, generous padding.
Backdrop: perfectly flat solid #00ff00 chroma-key background, no floor, no cast shadow, no texture, no gradient.
Constraints: readable silhouette at thumbnail size, no weapon, no text, no label, no border, no watermark, no green on character.
```

## Chroma-key removal

The source prompt requested a flat `#00ff00` chroma-key background. Transparency was produced with the installed helper and these settings:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\imagegen\scripts\remove_chroma_key.py" `
  --input sample-h-source.png `
  --out sample-h.png `
  --auto-key border `
  --soft-matte `
  --transparent-threshold 12 `
  --opaque-threshold 220 `
  --despill
```

The historical helper output reported an auto-detected H border key of `#03eb09`; `#00ff00` remains the exact requested generation backdrop. The canonical output is now committed as `sample-a.png`.

## Deterministic B/C derivation

Run:

```powershell
python docs/assets/juyiting/songjiang-style-review/derive_review_assets.py
python docs/assets/juyiting/songjiang-style-review/derive_review_assets.py --check
```

The committed derivation was produced with Python, Pillow `12.2.0`, and NumPy `2.4.2`. `--check` regenerates B, C, and the preview in a temporary directory and requires byte-for-byte equality with committed outputs.

### Official B: cool muted ink/wash

1. Downsample A's RGB to one-half width/height with LANCZOS; restore with BICUBIC; apply Gaussian blur radius `0.75`.
2. Compute luminance `0.299R + 0.587G + 0.114B` and map it through shadow `[29,39,47]`, middle `[102,113,119]`, and light `[205,207,194]`.
3. Mix `78%` wash ramp with `22%` source color muted to `78%` luminance / `22%` original RGB.
4. Add deterministic seeded (`250715`) low-frequency wash variation at amplitude `18`.
5. Add interrupted/broken ink accents from edge detection and lighten a four-pixel interior edge band by `16%` for a softer perimeter treatment.
6. Merge the original A alpha channel back without changing any alpha byte.

### Official C: clean animation/cel

1. Downsample A's RGB to one-third width/height with LANCZOS; restore with BICUBIC; apply a `3x3` median filter.
2. Apply contrast `1.28` and color `1.32`.
3. Median-cut quantize to `18` colors with no dithering.
4. Reinforce major contours with ink color `[20,22,27]`, then posterize to five bits per RGB channel.
5. Merge the original A alpha channel back without changing any alpha byte.

## Deterministic target-scale preview

- Background input is exactly `public/juyiting/images/liangshan-hall-base-clean-v3.png` at `1664x928`, SHA-256 `94b581a98fe6b16ea4d200936384efc1d975cf8892c75b2e9151fc8bcf510966`.
- For each official sample, crop to its nonzero alpha bounds and contain it bottom-centered in an exact transparent `66x66` frame using Pillow LANCZOS resampling.
- Composite multiple A instances at representative main-seat, west-floor, and east-floor positions.
- Composite A/B/C side-by-side in separately outlined `66x66` evidence frames. Labels and outlines are review overlays, not runtime UI.
- Append a separated inspection strip. Enlarge the already-created `66x66` target frame exactly `3x` with NEAREST, so the strip exposes target pixels rather than resampling the source artwork again.
- The result is a static review composite. It does not claim or simulate animation.

## Native 2.5D camera-angle review workflow

The camera-angle samples were created in built-in `image_gen` mode as native redraws. They were not produced by skewing, rotating, or applying perspective to `sample-a.png` in CSS or local raster code. The built-in tool did not expose model-version or seed controls, so the committed transparent 45-degree and 55-degree PNGs are the canonical source evidence.

- Retained comparison source: `sample-a-2_5d-45-v1.png`, SHA-256 `38e45ae50d8c4908c98f5436599a08027870f3d74c80db19ebeb17fc7e647904`.
- **Selected source:** `sample-a-2_5d-55-v1.png`, SHA-256 `6109be7d51cd19f2bd93304a064309b11cbc7718365a35d3ea327b60bd5d0d47`.
- Selected by Richow: native 55-degree elevated three-quarter top-down 2.5D single-frame camera angle.

### Verbatim 45-degree built-in prompt intent

```text
Use case: stylized-concept
Asset type: mobile game character sprite camera-angle review sample, one single full-body frame
Input images: Use the approved Songjiang H / Sample A artwork as identity and style reference; use the previously generated 35-degree 2.5D Songjiang as pose continuity reference; use the Juyiting hall as perspective context.
Primary request: Create the 45-DEGREE version of the same Songjiang character. Preserve the approved semi-realistic hand-painted Q-version style, oversized black official hat, strong eyebrows, moustache and pointed beard, black robe, red front panel, gold leader belt, black-red-gold palette, bold dark mobile-readable outline and simplified details.
Camera: native elevated three-quarter top-down view at exactly 45 degrees above the floor plane. Make this visibly more top-down than the previous 35-degree sample: clearly expose more of the hat top, shoulders, upper sleeves and shoe tops; moderately compress face, torso and legs vertically. Feet must share a clean ground contact line. Face slightly toward screen-right. Redraw natively—do not skew or rotate a frontal character.
Consistency: neutral idle stance, one character only, entire body visible, centered with generous padding. Keep silhouette and proportions suitable for reduction to an exact 66x66 frame.
Background extraction: perfectly flat solid #00ff00 chroma-key background, uniform with no gradient, texture, floor, shadow, reflection or lighting variation. Do not use #00ff00 on the subject. No cast/contact shadow.
Avoid: eye-level frontal view, insufficient tilt, side/back view, realistic proportions, weapons, props, text, watermark, duplicate body parts, pixel art, vector/CSS look, plastic 3D render.
```

### Verbatim 55-degree built-in prompt intent — selected

```text
Use case: stylized-concept
Asset type: mobile game character sprite camera-angle review sample, one single full-body frame
Input images: Use the approved Songjiang H / Sample A artwork as identity and style reference; use the 35-degree and 45-degree Songjiang samples only for character continuity; use the Juyiting hall as perspective context.
Primary request: Create the 55-DEGREE version of the same Songjiang character. Preserve the approved semi-realistic hand-painted Q-version style, oversized black official hat, strong eyebrows, moustache and pointed beard, black robe, red front panel, gold leader belt, black-red-gold palette, bold dark mobile-readable outline and simplified details.
Camera: native steep elevated three-quarter top-down view at exactly 55 degrees above the floor plane. It must be unmistakably more top-down than the 45-degree version: prominently expose the top of the hat, shoulders, upper sleeves, belt plane and shoe tops; noticeably foreshorten/compress the face, torso and legs vertically while retaining a readable Q-version silhouette. Feet must share a clean ground contact line. Face slightly toward screen-right. Redraw natively—do not skew or rotate a frontal character.
Consistency: neutral idle stance, one character only, entire body visible, centered with generous padding. Keep the silhouette and proportions suitable for reduction to an exact 66x66 frame.
Background extraction: perfectly flat solid #00ff00 chroma-key background, uniform with no gradient, texture, floor, shadow, reflection or lighting variation. Do not use #00ff00 on the subject. No cast/contact shadow.
Avoid: eye-level frontal view, subtle/insufficient tilt, same angle as 45-degree version, side/back view, realistic proportions, weapons, props, text, watermark, duplicate body parts, pixel art, vector/CSS look, plastic 3D render.
```

### Camera-sample chroma-key removal

Both built-in generations requested a uniform `#00ff00` background. Each transparent source was produced locally with the same helper settings:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\imagegen\scripts\remove_chroma_key.py" `
  --input <45-or-55-chroma-source>.png `
  --out <sample-a-2_5d-45-v1-or-sample-a-2_5d-55-v1>.png `
  --auto-key border `
  --soft-matte `
  --transparent-threshold 12 `
  --opaque-threshold 220 `
  --despill
```

### Deterministic exact-66x66 hall comparison

Run:

```powershell
python docs/assets/juyiting/songjiang-style-review/derive_camera_angle_preview.py
python docs/assets/juyiting/songjiang-style-review/derive_camera_angle_preview.py --check
```

The script never writes to the 45-degree or selected 55-degree source artwork. For each source it crops to nonzero alpha bounds, scales the subject to fit within `64x64` using LANCZOS, and bottom-centers that result in an exact transparent `66x66` frame. It composites both frames at matched hall depths on `liangshan-hall-base-clean-v3.png`, includes separately outlined exact-size frames, and enlarges the already-created target frames exactly `3x` with NEAREST in the review-only inspection strip. The deterministic output is `sample-a-2_5d-45-55-hall-preview-v1.png`, SHA-256 `aabdbb2fe5ede6e35258b946f2b8c98eef34f3da404bc97edc19597ebe0df253`.
