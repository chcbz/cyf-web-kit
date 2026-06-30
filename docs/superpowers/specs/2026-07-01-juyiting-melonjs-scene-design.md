# Juyiting melonJS Scene Migration Design

## Goal

Move the Juyiting scene body from the current mixed DOM/CSS plus melonJS rendering model to a melonJS-owned canvas scene, while keeping business UI in Vue/DOM.

## Scope

The scene body includes the hall background, foreground, room objects, props, clickable hotspots, agents, agent names, speech bubbles, selection feedback, depth sorting, drag, zoom, and scene coordinate conversion.

Vue/DOM remains responsible for page layout, the stage header, refresh and sound buttons, side or bottom panels, chat, task, catalog, library, and agent detail UI. Those components continue to receive events from the scene and provide data to it.

The migration should not canvas-render business panels or form controls. It should also not keep the old CSS scene as a parallel visual implementation after melonJS is ready.

## Current State

`HallStage.vue` currently renders a `map-world` DOM scene with CSS background, object hitboxes, room props, `AgentToken` entries, foreground effects, and overflow UI. It also mounts `juyitingGame` into a `melon-layer`.

`JuyitingGame.js` dynamically imports melonJS, creates a transparent canvas, loads resources, and starts `HallScene`.

`HallScene.js` already owns melonJS background and foreground image layers, hotspot markers, agent synchronization, pointer handling, and depth sorting.

`HallAgent.js` already owns melonJS sprite display, movement, facing, highlight, names, and bubbles.

## Architecture

`HallStage.vue` becomes a Vue shell around one canvas scene container. It keeps header controls, slots, layout sizing, event bindings, and data watchers. It no longer renders `map-world`, `.hall-room`, `.room-prop-layer`, `.map-region`, `.map-road`, `.hall-foreground`, `AgentToken`, or CSS object visuals.

`JuyitingGame` remains the integration boundary between Vue and melonJS. It should expose scene operations for mount, start, destroy, agent sync, hotspot sync, selected agent sync, and viewport transform updates if needed.

`HallScene` becomes the authoritative scene renderer. It should build all static and interactive scene layers inside melonJS, register pointer events for hotspots and agents, manage drag and zoom, and convert percentage-based scene data to viewport coordinates.

Static scene objects should be represented by focused melonJS renderables or sprites. Reusing the existing background and foreground images is preferred. Existing atlas-based object rendering may be migrated if the assets are already available and provide distinct visual value; otherwise the first completed version can rely on the full hall background and foreground images plus canvas hotspot feedback.

## Data Flow

Vue passes `sceneAgents`, `sceneHotspots`, and `selectedAgent` to `juyitingGame`.

`JuyitingGame` forwards those updates to `HallScene`.

`HallScene` creates, updates, and removes melonJS agents and hotspot markers. User clicks inside canvas are translated into `onAgentClick` or `onHotspotClick` callbacks.

Vue receives those callbacks and opens existing panels or selects agents. No business panel logic moves into melonJS.

## Drag And Zoom

The old CSS transform on `.map-world` and `.melon-layer` should be replaced by melonJS-owned transform state. The scene should preserve existing user behavior: pointer drag pans the hall, wheel zoom changes scale, keyboard plus/minus adjusts zoom, and `0` resets view.

Zoom should stay clamped so the hall remains framed on desktop and mobile. Coordinate conversion must account for pan and zoom so hotspot and agent clicks remain aligned with what the user sees.

## Error Handling

If melonJS fails to load or initialize, `HallStage.vue` should show a simple scene unavailable state with a retry action or refresh path. It should not silently fall back to the previous CSS hall, because that would preserve two scene implementations.

Failed optional resources should be logged with the existing warning pattern and should not break the whole page when the core canvas can still render.

## Testing

Unit-level tests should cover pure helpers introduced for scene coordinate conversion, pan and zoom clamping, and percent-to-viewport mapping.

Existing public beta smoke tests should be updated or kept passing with the canvas scene. They should verify that the Juyiting route loads, the scene container exists, the melonJS canvas is present, key panel-opening hotspots still work, and agent selection still triggers UI state.

Build verification must include `npm run build`.

Deployment verification must include the standard CYF frontend deployment script and public `curl` smoke check after implementation passes.

## Acceptance Criteria

The visible Juyiting scene body is rendered by melonJS canvas, not by CSS room/object/agent DOM layers.

`HallStage.vue` no longer renders `AgentToken` or hall object DOM elements for the scene body.

Hotspot clicks still open the existing Vue panels.

Agent clicks still select agents and update the existing Vue details UI.

Drag, zoom, keyboard zoom, and reset still work on the scene.

The old CSS scene body is removed or reduced to non-visual layout and failure-state styling.

Business UI remains Vue/DOM.

`npm run build` passes and deployment smoke checks pass.
