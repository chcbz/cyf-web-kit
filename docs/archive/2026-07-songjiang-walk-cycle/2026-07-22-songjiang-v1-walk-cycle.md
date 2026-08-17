# Songjiang v1 Walk Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the 32 walking frames in Songjiang's v1 eight-direction sprite sheet so left/right foot alternation reads clearly without changing identity, idle frames, grid layout, or runtime configuration.

**Architecture:** Treat the existing 1024×1024 RGBA sheet as the edit target and `D:\tmp\example.webp` only as a gait reference. Generate a non-destructive candidate, enforce pixel-identical idle frames and structural image checks, visually inspect all eight four-frame walk loops, and only then replace the tracked v1 asset.

**Tech Stack:** Built-in image generation/editing tool, Python 3 with Pillow, existing Jia sprite validator, Git.

---

## File Structure

- Modify: `public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png` — final 8×8 sprite sheet; frames 0–31 remain pixel-identical and frames 32–63 receive the balanced walk-cycle edit.
- Create temporarily: `tmp/imagegen/songjiang-v1-walk-candidate.png` — generated candidate before acceptance; never commit.
- Create temporarily: `tmp/imagegen/songjiang-v1-walk-contact-sheet.png` — four animation phases for all eight directions; never commit.
- Create temporarily: `tmp/imagegen/songjiang-v1-walk-preview.gif` — synchronized eight-direction loop; never commit.

### Task 1: Capture the Asset Contract and Baseline

**Files:**
- Inspect: `public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png`
- Inspect: `src/game/sprites/personaSpriteManifest.ts:1-85`

- [ ] **Step 1: Confirm the working tree and target identity**

Run:

```powershell
git status --short
git hash-object -- public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png
```

Expected: no unrelated working-tree changes are touched; Git prints one blob hash for the original v1 image.

- [ ] **Step 2: Assert the baseline image contract**

Run:

```powershell
@'
from PIL import Image
path = r"public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png"
im = Image.open(path)
assert im.size == (1024, 1024), im.size
assert im.mode == "RGBA", im.mode
assert im.getpixel((0, 0))[3] == 0
for row in range(8):
    for col in range(8):
        frame = im.crop((col * 128, row * 128, (col + 1) * 128, (row + 1) * 128))
        assert frame.getchannel("A").getbbox() is not None, (row, col)
print("Songjiang v1 baseline contract valid: 1024x1024 RGBA, 64 non-empty frames")
'@ | python -
```

Expected: `Songjiang v1 baseline contract valid: 1024x1024 RGBA, 64 non-empty frames`.

### Task 2: Generate a Non-Destructive Walk Candidate

**Files:**
- Read: `D:\tmp\example.webp`
- Read: `public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png`
- Create: `tmp/imagegen/songjiang-v1-walk-candidate.png`

- [ ] **Step 1: Load both local images for visual editing context**

Use the image viewer at original detail for the two exact paths above. Assign roles explicitly: `example.webp` is the gait reference; `songjiang-8-direction-v1.png` is the edit target.

- [ ] **Step 2: Generate the candidate with the built-in image editor**

Use this complete prompt:

```text
Use case: precise-object-edit
Asset type: 8-direction game-character sprite sheet
Input images: Image 1 is gait reference only; Image 2 is the edit target.
Primary request: Improve only the walking animation in frames 32-63 of Image 2. For each of the eight directions, make the four-frame sequence show a clear balanced cycle: left-foot stride, centered passing pose, right-foot stride, centered passing pose. Use Image 1 only to understand readable left/right foot alternation and weight transfer.
Constraints: Preserve Image 2's exact 1024×1024 canvas, 8×8 grid, 128×128 cells, frame order, transparent background, character scale, camera angle, Songjiang's face, beard, hat, clothing, colors and silhouette. Keep frames 0-31 visually and pixel-for-pixel unchanged. Keep each direction's foot-contact baseline stable. Add only subtle counter-swing in arms, sleeves and robe hem. Keep every frame fully inside its original cell.
Avoid: Do not copy Image 1's character, weapon, armor, pixel-art style, palette or layout. No new objects, weapons, text, shadows, background, resizing, grid lines, frame reordering, anatomy errors, flicker or sudden scale changes.
```

Save the selected built-in output as `tmp/imagegen/songjiang-v1-walk-candidate.png`. Do not overwrite the tracked v1 image yet.

- [ ] **Step 3: Reject structurally incorrect outputs immediately**

If the editor changes the canvas/grid, character identity, idle half, transparency, or frame ordering, issue one targeted follow-up that names only the failed invariant. Repeat until a structurally valid candidate exists; never repair identity or grid errors by accepting a compromised frame.

### Task 3: Enforce Idle Preservation and Frame Geometry

**Files:**
- Compare: `public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png`
- Test: `tmp/imagegen/songjiang-v1-walk-candidate.png`

- [ ] **Step 1: Restore the idle half byte-for-byte from the original**

Run:

```powershell
@'
from PIL import Image
original_path = r"public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png"
candidate_path = r"tmp/imagegen/songjiang-v1-walk-candidate.png"
original = Image.open(original_path).convert("RGBA")
candidate = Image.open(candidate_path).convert("RGBA")
assert candidate.size == (1024, 1024), candidate.size
candidate.paste(original.crop((0, 0, 1024, 512)), (0, 0))
candidate.save(candidate_path)
print("Idle frames 0-31 restored from original")
'@ | python -
```

Expected: `Idle frames 0-31 restored from original`.

- [ ] **Step 2: Validate structure, idle equality, and walk baselines**

Run:

```powershell
@'
from PIL import Image, ImageChops
original = Image.open(r"public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png").convert("RGBA")
candidate = Image.open(r"tmp/imagegen/songjiang-v1-walk-candidate.png").convert("RGBA")
assert candidate.size == original.size == (1024, 1024)
assert ImageChops.difference(original.crop((0, 0, 1024, 512)), candidate.crop((0, 0, 1024, 512))).getbbox() is None
for direction in range(8):
    bottoms = []
    for phase in range(4):
        index = 32 + direction * 4 + phase
        row, col = divmod(index, 8)
        frame = candidate.crop((col * 128, row * 128, (col + 1) * 128, (row + 1) * 128))
        bbox = frame.getchannel("A").getbbox()
        assert bbox is not None, index
        assert 0 <= bbox[0] < bbox[2] <= 128 and 0 <= bbox[1] < bbox[3] <= 128, (index, bbox)
        bottoms.append(bbox[3])
    assert max(bottoms) - min(bottoms) <= 3, (direction, bottoms)
print("Candidate contract valid: idle exact, 32 walk frames bounded, foot baselines stable")
'@ | python -
```

Expected: `Candidate contract valid: idle exact, 32 walk frames bounded, foot baselines stable`.

### Task 4: Build and Inspect the Eight-Direction Animation Preview

**Files:**
- Read: `tmp/imagegen/songjiang-v1-walk-candidate.png`
- Create: `tmp/imagegen/songjiang-v1-walk-contact-sheet.png`
- Create: `tmp/imagegen/songjiang-v1-walk-preview.gif`

- [ ] **Step 1: Render synchronized contact-sheet and GIF previews**

Run:

```powershell
@'
from PIL import Image, ImageDraw
source = Image.open(r"tmp/imagegen/songjiang-v1-walk-candidate.png").convert("RGBA")
phases = []
for phase in range(4):
    strip = Image.new("RGBA", (1024, 160), (34, 47, 62, 255))
    for direction in range(8):
        index = 32 + direction * 4 + phase
        row, col = divmod(index, 8)
        frame = source.crop((col * 128, row * 128, (col + 1) * 128, (row + 1) * 128))
        strip.alpha_composite(frame, (direction * 128, 0))
    draw = ImageDraw.Draw(strip)
    draw.text((8, 136), f"walk phase {phase + 1}: down, downRight, right, upRight, up, upLeft, left, downLeft", fill="white")
    phases.append(strip)
sheet = Image.new("RGBA", (1024, 640), (34, 47, 62, 255))
for phase, strip in enumerate(phases):
    sheet.alpha_composite(strip, (0, phase * 160))
sheet.convert("RGB").save(r"tmp/imagegen/songjiang-v1-walk-contact-sheet.png")
phases[0].save(r"tmp/imagegen/songjiang-v1-walk-preview.gif", save_all=True, append_images=phases[1:], duration=90, loop=0, disposal=2)
print("Rendered contact sheet and 90ms walk preview")
'@ | python -
```

Expected: `Rendered contact sheet and 90ms walk preview`.

- [ ] **Step 2: Inspect all phases at original detail**

Open both preview files with the image viewer. Confirm for every direction: left/right stride extremes are distinguishable; passing poses return toward center; head and hat do not wobble; body scale is constant; sleeves and robe hem move subtly; feet do not skate or jump; no frame contains copied reference weapons or anatomy artifacts.

- [ ] **Step 3: Iterate one defect at a time**

If a direction fails, send the candidate back to the built-in editor with a single-change instruction naming the exact direction and phase while repeating all invariants. Re-run Tasks 3 and 4 after every iteration.

### Task 5: Replace v1 and Verify the Repository

**Files:**
- Modify: `public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png`

- [ ] **Step 1: Replace only the approved target asset**

Run:

```powershell
Copy-Item -LiteralPath 'tmp/imagegen/songjiang-v1-walk-candidate.png' -Destination 'public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png' -Force
```

- [ ] **Step 2: Re-run the exact structural contract against the final path**

Run the Task 1 baseline assertion against the replaced image. Expected: the same 1024×1024 RGBA and 64-frame success message.

- [ ] **Step 3: Run the project sprite validator**

Run:

```powershell
npm run validate:juyiting-sprites
```

Expected: validation completes successfully with required and optional missing counts equal to zero.

- [ ] **Step 4: Confirm scope and diff hygiene**

Run:

```powershell
git status --short
git diff --check
git diff --stat
```

Expected: the implementation change is limited to `public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png`; no temporary preview is staged or committed; `git diff --check` is clean.

- [ ] **Step 5: Commit the accepted sprite**

Run:

```powershell
git add -- public/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v1.png
git commit -m "fix: improve Songjiang v1 walk cycle"
```

Expected: one commit containing only the optimized v1 sprite asset.
