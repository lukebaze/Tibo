// Narration per scene. `npm run voice` turns each line into public/vo/<id>.wav (Kokoro, voice af_heart)
// and writes the measured lengths to src/durations.json, which sets every scene's length.
export const SCRIPT = [
	{id: 'intro', text: "Hi, I'm Tibo. A voice assistant that lives right in your Mac's notch."},
	{id: 'voice', text: 'Just say Tibo. I know when you have finished talking, and you can interrupt me any time.'},
	{id: 'notch', text: 'Hover the notch to open it. Type a question, or type a slash for quick commands.'},
	{id: 'apps', text: 'Open any app, instantly.'},
	{id: 'agents', text: 'Hand coding work to pi, omp, Claude Code or Codex. I ask before running, then report back.'},
	{id: 'screen', text: 'Ask about your screen. What does this error mean? Summarize this page. I read the text, and look at the picture when needed.'},
	{id: 'control', text: 'I can click and type for you, and I always ask first.'},
	{id: 'local', text: 'Speech recognition runs on your Mac, and I understand commands in under half a second.'},
	{id: 'onboarding', text: 'Setup takes a few steps: model, microphone, voice, and notch position.'},
	{id: 'recap', text: 'So: Tibo listens, understands, sees, and gets work done with you.'},
	{id: 'outro', text: "Hey Tibo, let's get started!"},
] as const;

export type SceneId = (typeof SCRIPT)[number]['id'];
