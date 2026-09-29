# 3D design workflow

Interactive 3D and WebGL experiences with Three.js. When `ak:threejs` is installed,
it owns Three.js APIs, shaders and performance details; this file covers the design side.

1. **Brief.** Write the brief from `../SKILL.md`. Decide what the 3D element means in
   the content (the product, a data shape, a place). 3D without meaning is decoration.
2. **Plan** in the project's plan location: scene, camera behavior, interaction, how
   the HTML UI layers over the canvas, and the fallback.
3. **Build the HTML layer first** so the page is complete and readable without WebGL.
4. **Build the scene.** Scene setup, materials and lighting in the brief's palette,
   custom shaders or particles only where they serve the idea, cinematic but calm
   camera motion, post-processing within a performance budget.
5. **Assets.** Textures, environment maps and sprites via `asset-pipeline.md`;
   compress textures (KTX2/Basis where supported), use power-of-two sizes.
6. **Verify.** 60fps on a mid-range laptop and acceptable frame rate on a mid-range
   phone; responsive canvas; reduced-motion and no-WebGL fallbacks (static image or
   poster frame); no memory growth when navigating away. Run `self-critique-loop.md`
   for the page around the canvas.
7. **Report** measured frame rates, fallbacks and unverified devices.

Technical checklist: efficient draw calls and instancing, level of detail where
needed, dispose geometries/materials/textures on unmount, pause rendering when the
canvas is off-screen or the tab is hidden, cap device pixel ratio at 2, lazy-load the
3D bundle after the first paint.
