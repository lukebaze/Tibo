# Video replication workflow

Replicate a design including its motion and interactions from a video.

1. **Extract.** Follow `visual-analysis.md` for the static system, then record motion:
   for each animation, what moves, trigger, duration in ms, easing, delay and stagger,
   plus transitions between states or pages. Step through frames for timing when the
   analysis route allows it.
2. **Brief and tokens** from the extraction, including duration and easing tokens.
3. **Plan when large**, in the project's plan location.
4. **Build** structure and static states first, then motion using `motion-craft.md`
   (and `animejs.md` if the project uses Anime.js). Match the video's timing; keep
   reduced-motion alternatives and visible-by-default content.
5. **Assets** via `asset-pipeline.md`.
6. **Verify.** Record or step through your build and compare each animation with the
   source; test every interaction; confirm smooth frame rate and no layout shift.
   Run `self-critique-loop.md` for the static result.
7. **Report** remaining differences and unverified areas.
