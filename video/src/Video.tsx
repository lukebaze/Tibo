import React from 'react';
import {Gif} from '@remotion/gif';
import {
	AbsoluteFill,
	Audio,
	Easing,
	Img,
	Series,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import durations from './durations.json';
import {SCRIPT, SceneId} from './script';

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
const PAD = 1.3; // seconds of air after each narration line
const seconds = durations as Record<string, number>;
export const sceneFrames = (id: SceneId) => Math.ceil((seconds[id] + PAD) * FPS);
export const totalFrames = SCRIPT.reduce((sum, s) => sum + sceneFrames(s.id), 0);

const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif';
const ACCENT = '#ff9f43';
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// ---------- building blocks ----------

const useSpring = (delay = 0, damping = 12) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	return spring({frame: frame - delay, fps, config: {damping}});
};

/** Taby clips are stored portrait; the app draws them rotated -90°, so do the same. */
const Taby: React.FC<{clip: string; width: number}> = ({clip, width}) => {
	const height = (width * 280) / 456;
	return (
		<div style={{width, height, position: 'relative'}}>
			<div
				style={{
					position: 'absolute',
					width: height,
					height: width,
					left: (width - height) / 2,
					top: (height - width) / 2,
					transform: 'rotate(-90deg)',
				}}
			>
				<Gif src={staticFile(`taby/${clip}.gif`)} width={height} height={width} fit="contain" />
			</div>
		</div>
	);
};

/** Google Noto animated emoji (CC BY 4.0), popping in with a spring. */
const Emoji: React.FC<{code: string; size?: number; delay?: number; style?: React.CSSProperties}> = ({
	code,
	size = 120,
	delay = 0,
	style,
}) => {
	const s = useSpring(delay, 9);
	return (
		<div style={{width: size, height: size, flexShrink: 0, transform: `scale(${s}) rotate(${(1 - s) * -25}deg)`, ...style}}>
			<Gif src={staticFile(`emoji/${code}.gif`)} width={size} height={size} fit="contain" />
		</div>
	);
};

const Title: React.FC<{kicker: string; title: string; emoji?: string[]; delay?: number}> = ({kicker, title, emoji = [], delay = 0}) => {
	const s = useSpring(delay, 14);
	return (
		<div>
			<div style={{display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20}}>
				{emoji.map((code, i) => (
					<Emoji key={code} code={code} size={150} delay={delay + 8 + i * 8} />
				))}
			</div>
			<div style={{opacity: s, transform: `translateY(${(1 - s) * 40}px)`}}>
				<div style={{color: ACCENT, fontSize: 34, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase'}}>{kicker}</div>
				<div style={{color: 'white', fontSize: 84, fontWeight: 800, lineHeight: 1.05, marginTop: 12}}>{title}</div>
			</div>
		</div>
	);
};

const Chip: React.FC<{children: React.ReactNode; delay: number; highlight?: boolean}> = ({children, delay, highlight}) => {
	const s = useSpring(delay, 13);
	return (
		<div
			style={{
				opacity: s,
				transform: `translateX(${(1 - s) * -60}px)`,
				background: highlight ? ACCENT : 'rgba(255,255,255,0.08)',
				color: highlight ? '#1a1206' : 'white',
				border: '1px solid rgba(255,255,255,0.14)',
				borderRadius: 24,
				padding: '20px 30px',
				fontSize: 38,
				fontWeight: 600,
			}}
		>
			{children}
		</div>
	);
};

/** The black notch pill, flush with the top edge like the real one. */
const Notch: React.FC<{open: number; clip: string; children?: React.ReactNode}> = ({open, clip, children}) => (
	<div
		style={{
			position: 'absolute',
			top: 0,
			left: '50%',
			transform: 'translateX(-50%)',
			width: interpolate(open, [0, 1], [260, 940]),
			background: 'black',
			borderBottomLeftRadius: interpolate(open, [0, 1], [20, 50]),
			borderBottomRightRadius: interpolate(open, [0, 1], [20, 50]),
			boxShadow: '0 20px 80px rgba(0,0,0,0.6)',
			display: 'flex',
			flexDirection: 'column',
			alignItems: 'center',
			paddingTop: 14,
			paddingBottom: interpolate(open, [0, 1], [8, 30]),
			overflow: 'hidden',
		}}
	>
		<Taby clip={clip} width={interpolate(open, [0, 1], [80, 360])} />
		<div style={{opacity: open, width: '100%'}}>{children}</div>
	</div>
);

const typed = (text: string, frame: number, start: number, perChar = 1.6) =>
	text.slice(0, Math.max(0, Math.floor((frame - start) / perChar)));

const Panel: React.FC<{children: React.ReactNode; style?: React.CSSProperties; delay?: number}> = ({children, style, delay = 0}) => {
	const s = useSpring(delay, 14);
	return (
		<div
			style={{
				background: 'rgba(20,22,34,0.92)',
				border: '1px solid rgba(255,255,255,0.12)',
				borderRadius: 32,
				boxShadow: '0 30px 90px rgba(0,0,0,0.45)',
				opacity: s,
				transform: `scale(${0.9 + 0.1 * s})`,
				...style,
			}}
		>
			{children}
		</div>
	);
};

/** Standard scene column: content starts below the notch area and stays clear of the subtitle. */
const Column: React.FC<{children: React.ReactNode; top?: number; gap?: number}> = ({children, top = 260, gap = 56}) => (
	<AbsoluteFill style={{padding: `${top}px 80px 0`, display: 'flex', flexDirection: 'column', gap}}>{children}</AbsoluteFill>
);

/** macOS-style pointer; (x, y) is the tip. */
const Cursor: React.FC<{x: number; y: number; pressed?: boolean}> = ({x, y, pressed}) => (
	<svg
		width={64}
		height={80}
		viewBox="0 0 16 20"
		style={{position: 'absolute', left: x, top: y, transform: `scale(${pressed ? 0.8 : 1})`, filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.6))'}}
	>
		<path d="M1 1 L1 16 L5 12.5 L7.8 18.5 L10.2 17.4 L7.5 11.6 L12.5 11.6 Z" fill="black" stroke="white" strokeWidth={1.2} strokeLinejoin="round" />
	</svg>
);

// ---------- scenes ----------

const Intro: React.FC = () => {
	const frame = useCurrentFrame();
	const s = useSpring(0, 11);
	const t = useSpring(18, 14);
	return (
		<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', paddingBottom: 200}}>
			<div style={{transform: `scale(${s})`, background: 'black', borderRadius: 70, padding: '50px 60px'}}>
				<Taby clip={frame < 55 ? 'startup' : 'idle_01_loop'} width={680} />
			</div>
			<div style={{display: 'flex', alignItems: 'center', gap: 24, marginTop: 60, opacity: t}}>
				<div style={{color: 'white', fontSize: 190, fontWeight: 900, letterSpacing: -5}}>Tibo</div>
				<Emoji code="1f44b" size={170} delay={28} />
			</div>
			<div style={{color: 'rgba(255,255,255,0.75)', fontSize: 50, opacity: t, textAlign: 'center', maxWidth: 860}}>
				The voice assistant in your Mac's notch
			</div>
		</AbsoluteFill>
	);
};

const Voice: React.FC = () => {
	const frame = useCurrentFrame();
	const interrupted = frame > 110;
	return (
		<>
			<Notch open={spring({frame: frame - 14, fps: FPS, config: {damping: 14}})} clip={frame > 20 ? 'listening_loop' : 'idle_01_loop'}>
				<div style={{color: 'rgba(255,255,255,0.72)', fontSize: 32, textAlign: 'center', marginTop: 8}}>
					{interrupted ? 'Interrupted, go ahead…' : 'Listening… stop talking to send'}
				</div>
			</Notch>
			<Column top={520}>
				<Title kicker="Voice" title="“Hey Tibo…”" />
				<div style={{display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'flex-start'}}>
					<Chip delay={30}>🗣 Wake word</Chip>
					<Chip delay={45}>⏸ Smart turn: sends when you pause</Chip>
					<Chip delay={60}>🎙 Tap to talk, tap again to send</Chip>
					<Chip delay={110} highlight>✋ Interrupt any time</Chip>
				</div>
				<div style={{display: 'flex', alignItems: 'center', gap: 40}}>
					<Emoji code={interrupted ? '270b' : '1f4ac'} size={170} delay={interrupted ? 110 : 10} key={interrupted ? 'b' : 'a'} />
					<div style={{display: 'flex', gap: 10, alignItems: 'center', height: 150}}>
						{Array.from({length: 22}, (_, i) => (
							<div
								key={i}
								style={{
									width: 16,
									borderRadius: 8,
									background: ACCENT,
									height: 20 + 120 * Math.abs(Math.sin(frame / 5 + i * 0.7) * Math.sin(frame / 13 + i)),
								}}
							/>
						))}
					</div>
				</div>
			</Column>
		</>
	);
};

const NotchScene: React.FC = () => {
	const frame = useCurrentFrame();
	const open = spring({frame: frame - 8, fps: FPS, config: {damping: 14}});
	const slashing = frame > 95;
	// Real slash commands of the app (names are Vietnamese in Tibo).
	const commands: [string, string][] = [
		['/caidat', 'Open Settings'],
		['/mic', 'Mute microphone'],
		['/dung', 'Stop speaking'],
		['/giong', 'Turn off voice replies'],
		['/thoat', 'Quit'],
	];
	const cx = interpolate(frame, [0, 14], [800, 560], {...clamp, easing: Easing.out(Easing.cubic)});
	const cy = interpolate(frame, [0, 14], [900, 40], {...clamp, easing: Easing.out(Easing.cubic)});
	return (
		<>
			<Notch open={open} clip={slashing ? 'searching_loop' : 'talking_default_loop'}>
				<div
					style={{
						margin: '12px 34px 0',
						background: 'rgba(255,255,255,0.1)',
						borderRadius: 999,
						padding: '20px 30px',
						fontSize: 34,
						color: 'white',
						display: 'flex',
						justifyContent: 'space-between',
					}}
				>
					<span>{slashing ? typed('/', frame, 95) : typed('summarize this page', frame, 30)}</span>
					<span style={{opacity: 0.6}}>▦ 🎙</span>
				</div>
				{frame > 100 &&
					commands.map(([name, label], i) => (
						<div
							key={name}
							style={{
								display: 'flex',
								gap: 20,
								padding: '12px 64px',
								fontSize: 32,
								opacity: interpolate(frame, [100 + i * 4, 108 + i * 4], [0, 1], clamp),
							}}
						>
							<span style={{fontFamily: 'Menlo, monospace', color: 'rgba(255,255,255,0.5)', width: 160}}>{name}</span>
							<span style={{color: 'white'}}>{label}</span>
						</div>
					))}
			</Notch>
			{frame < 40 && <Cursor x={cx} y={cy} />}
			<Column top={1030}>
				<Title kicker="Notch" title="Hover to open, type / for commands" emoji={['2728']} delay={10} />
			</Column>
		</>
	);
};

const Apps: React.FC = () => {
	const frame = useCurrentFrame();
	return (
		<Column top={380}>
			<Title kicker="Open apps" title="“Open Safari”" emoji={['1f680']} />
			<div style={{display: 'flex', flexWrap: 'wrap', gap: 50, marginTop: 30}}>
				{['Safari', 'Calendar', 'Notes', 'Terminal', 'Mail'].map((name, i) => {
					const s = spring({frame: frame - 12 - i * 5, fps: FPS, config: {damping: 10}});
					const bounce = i === 0 ? Math.abs(Math.sin((frame - 35) / 6)) * interpolate(frame, [35, 75], [50, 0], clamp) : 0;
					return (
						<div key={name} style={{transform: `scale(${s}) translateY(${-bounce}px)`, textAlign: 'center'}}>
							<Img src={staticFile(`apps/${name}.png`)} style={{width: 250, height: 250, borderRadius: 60, boxShadow: i === 0 ? `0 0 0 10px ${ACCENT}` : 'none'}} />
							<div style={{color: 'white', fontSize: 36, marginTop: 14}}>{name}</div>
						</div>
					);
				})}
			</div>
		</Column>
	);
};

const Agents: React.FC = () => {
	const frame = useCurrentFrame();
	const agents: [string, string][] = [
		['pi', 'working_laptop_excited_loop'],
		['omp', 'working_loop'],
		['Claude Code', 'claude_loop'],
		['Codex', 'codex_loop'],
	];
	const approved = frame > 140;
	return (
		<Column top={160} gap={34}>
			<Title kicker="Vibe coding by voice" title="Command your coding agents" emoji={['1f4bb']} />
			<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28}}>
				{agents.map(([name, clip], i) => (
					<Panel key={name} delay={20 + i * 8} style={{padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
						<div style={{background: 'black', borderRadius: 24, padding: 10}}>
							<Taby clip={clip} width={280} />
						</div>
						<div style={{color: 'white', fontSize: 42, fontWeight: 700, marginTop: 14}}>{name}</div>
					</Panel>
				))}
			</div>
			<Panel delay={70} style={{padding: '30px 36px'}}>
				<div style={{color: 'white', fontSize: 38, lineHeight: 1.35}}>
					<span style={{color: ACCENT, fontWeight: 700}}>omp</span> will fix the failing test in <span style={{fontFamily: 'Menlo, monospace'}}>~/Tibo</span>. Run it?
				</div>
				<div style={{display: 'flex', alignItems: 'center', gap: 28, marginTop: 22, height: 90}}>
					{approved ? (
						<>
							<Emoji code="2705" size={90} delay={140} />
							<div style={{color: '#5ee08a', fontSize: 40, fontWeight: 700}}>Done · 27/27 tests pass</div>
						</>
					) : (
						<>
							<div style={{background: ACCENT, color: '#1a1206', fontSize: 36, fontWeight: 700, borderRadius: 20, padding: '14px 32px', transform: `scale(${frame > 120 ? 0.92 : 1})`}}>
								Run
							</div>
							<div style={{color: 'rgba(255,255,255,0.6)', fontSize: 36}}>Cancel</div>
						</>
					)}
				</div>
			</Panel>
		</Column>
	);
};

const Screen: React.FC = () => {
	const frame = useCurrentFrame();
	const scan = interpolate(frame, [25, 90], [0, 100], clamp);
	const lines = [
		'$ cargo test',
		'error[E0308]: mismatched types',
		'  --> src/policy.rs:681:29',
		'  expected `Decision`,',
		'  found `Option<Decision>`',
	];
	return (
		<Column top={160} gap={30}>
			<Title kicker="Reads your screen" title="“What does this error mean?”" emoji={['1f440']} />
			<Panel delay={14} style={{padding: 36, position: 'relative', overflow: 'hidden'}}>
				<div style={{display: 'flex', gap: 12, marginBottom: 24}}>
					{['#ff5f57', '#febc2e', '#28c840'].map((c) => (
						<div key={c} style={{width: 20, height: 20, borderRadius: 10, background: c}} />
					))}
				</div>
				{lines.map((l, i) => (
					<div
						key={l}
						style={{
							fontFamily: 'Menlo, monospace',
							fontSize: 28,
							lineHeight: 1.6,
							whiteSpace: 'pre',
							color: i === 1 ? '#ff6b6b' : 'rgba(255,255,255,0.85)',
							background: scan > (i + 1) * 20 - 5 ? 'rgba(255,159,67,0.18)' : 'transparent',
						}}
					>
						{l}
					</div>
				))}
				<div style={{position: 'absolute', left: 0, right: 0, top: `${scan}%`, height: 5, background: ACCENT, boxShadow: `0 0 30px ${ACCENT}`, opacity: scan > 0 && scan < 100 ? 1 : 0}} />
			</Panel>
			<div style={{display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-start'}}>
				<Chip delay={35}>🔤 On-device OCR (Vision)</Chip>
				<Chip delay={50}>🖼 Pictures & charts → sent as image</Chip>
			</div>
			{frame > 105 && (
				<Panel style={{padding: 32, color: 'white', fontSize: 38, lineHeight: 1.4}}>
					<span style={{color: ACCENT, fontWeight: 700}}>Tibo: </span>
					{typed('It returns an Option, but the test expects a Decision. Try .unwrap().', frame, 105, 1)}
				</Panel>
			)}
		</Column>
	);
};

const Control: React.FC = () => {
	const frame = useCurrentFrame();
	// Cursor glides from the bottom corner onto the "Allow" button.
	const cx = interpolate(frame, [10, 50], [860, 480], {...clamp, easing: Easing.inOut(Easing.cubic)});
	const cy = interpolate(frame, [10, 50], [1500, 930], {...clamp, easing: Easing.inOut(Easing.cubic)});
	const clicked = frame > 65;
	return (
		<>
			<Column top={300}>
				<Title kicker="Controls your Mac" title="Clicks and types for you" emoji={['1f446']} />
				<Panel delay={10} style={{padding: '34px 40px', display: 'flex', alignItems: 'center', gap: 30}}>
					<div style={{background: 'black', borderRadius: 22, padding: 8}}>
						<Taby clip="confirmation" width={220} />
					</div>
					<div>
						<div style={{color: 'white', fontSize: 38}}>Open Safari and go to github.com?</div>
						<div style={{display: 'flex', gap: 24, marginTop: 18}}>
							<div style={{background: clicked ? '#5ee08a' : ACCENT, color: '#1a1206', fontSize: 34, fontWeight: 700, borderRadius: 18, padding: '12px 28px'}}>
								{clicked ? 'Allowed ✓' : 'Allow'}
							</div>
							<div style={{color: 'rgba(255,255,255,0.6)', fontSize: 34, padding: '12px 0'}}>Cancel</div>
						</div>
					</div>
				</Panel>
				<div style={{alignSelf: 'flex-start'}}>
					<Chip delay={25} highlight>🔐 Always asks before clicking</Chip>
				</div>
			</Column>
			<Cursor x={cx} y={cy} pressed={frame > 55 && frame < 65} />
		</>
	);
};

const Local: React.FC = () => (
	<Column top={240} gap={34}>
		<Title kicker="Fast & private" title="Speech stays on your Mac" emoji={['1f512', '26a1']} />
		{[
			['Whisper', 'offline speech recognition'],
			['351 ms', 'to understand a command (p50)'],
			['0%', 'wrong commands run (benchmark)'],
		].map(([value, label], i) => (
			<Panel key={value} delay={20 + i * 10} style={{padding: '26px 44px'}}>
				<div style={{color: ACCENT, fontSize: 88, fontWeight: 900}}>{value}</div>
				<div style={{color: 'rgba(255,255,255,0.8)', fontSize: 38, marginTop: 4}}>{label}</div>
			</Panel>
		))}
	</Column>
);

const Onboarding: React.FC = () => {
	const frame = useCurrentFrame();
	const steps = ['Welcome', 'Model', 'Mic', 'Listen', 'Voice', 'Wake word', 'Notch', 'Permissions', 'Try it', 'Done'];
	const at = Math.floor(interpolate(frame, [15, 130], [0, steps.length - 1], clamp));
	const pct = Math.round(interpolate(frame, [20, 115], [0, 100], clamp));
	return (
		<Column top={300} gap={50}>
			<Title kicker="Setup" title="Ready in a few steps" emoji={['1f9d0']} />
			<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18}}>
				{steps.map((step, i) => (
					<div
						key={step}
						style={{
							borderRadius: 20,
							padding: '18px 26px',
							fontSize: 36,
							fontWeight: i === at ? 800 : 500,
							color: i <= at ? '#1a1206' : 'rgba(255,255,255,0.55)',
							background: i <= at ? ACCENT : 'rgba(255,255,255,0.08)',
							transform: `scale(${i === at ? 1.04 : 1})`,
						}}
					>
						{i + 1}. {step}
					</div>
				))}
			</div>
			<Panel delay={20} style={{padding: '30px 40px'}}>
				<div style={{display: 'flex', justifyContent: 'space-between', color: 'white', fontSize: 36}}>
					<span>Downloading Whisper (picked for your RAM)</span>
					<span>{pct}%</span>
				</div>
				<div style={{height: 20, borderRadius: 10, background: 'rgba(255,255,255,0.12)', marginTop: 20}}>
					<div style={{width: `${pct}%`, height: '100%', borderRadius: 10, background: '#5ee08a'}} />
				</div>
			</Panel>
		</Column>
	);
};

const RECAP: [string, string][] = [
	['1f44b', 'Say “Tibo”'],
	['270b', 'Interrupt'],
	['2728', 'Notch + / commands'],
	['1f680', 'Open apps'],
	['1f4bb', 'Coding agents'],
	['1f440', 'Reads your screen'],
	['1f446', 'Controls your Mac'],
	['1f512', 'On-device speech'],
];

const Recap: React.FC = () => (
	<Column top={200} gap={40}>
		<Title kicker="Recap" title="What can Tibo do?" emoji={['1f389']} />
		<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24}}>
			{RECAP.map(([code, label], i) => (
				<Panel key={code} delay={8 + i * 4} style={{padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 20}}>
					<Emoji code={code} size={100} delay={8 + i * 4} />
					<div style={{color: 'white', fontSize: 34, fontWeight: 600}}>{label}</div>
				</Panel>
			))}
		</div>
	</Column>
);

const Outro: React.FC = () => {
	const s = useSpring(0, 10);
	return (
		<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', paddingBottom: 200}}>
			<div style={{transform: `scale(${s})`, background: 'black', borderRadius: 70, padding: '40px 60px'}}>
				<Taby clip="thumbs_up" width={620} />
			</div>
			<div style={{color: 'white', fontSize: 100, fontWeight: 900, textAlign: 'center', marginTop: 50, opacity: s, lineHeight: 1.05}}>
				Hey Tibo,
				<br />
				let's get started!
			</div>
			<Emoji code="1f60e" size={160} delay={10} style={{marginTop: 30}} />
		</AbsoluteFill>
	);
};

const SCENES: Record<SceneId, React.FC> = {
	intro: Intro,
	voice: Voice,
	notch: NotchScene,
	apps: Apps,
	agents: Agents,
	screen: Screen,
	control: Control,
	local: Local,
	onboarding: Onboarding,
	recap: Recap,
	outro: Outro,
};

// ---------- frame ----------

const Background: React.FC = () => {
	const frame = useCurrentFrame();
	return (
		<AbsoluteFill style={{background: '#0b0c14', overflow: 'hidden'}}>
			<div style={{position: 'absolute', width: 1300, height: 1300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,159,67,0.22), transparent 65%)', left: -500 + Math.sin(frame / 90) * 140, top: -400}} />
			<div style={{position: 'absolute', width: 1400, height: 1400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(110,90,255,0.24), transparent 65%)', right: -600, bottom: -500 + Math.cos(frame / 80) * 140}} />
		</AbsoluteFill>
	);
};

/** Subtitle that reveals words roughly in step with the narration. */
const Subtitle: React.FC<{text: string; length: number}> = ({text, length}) => {
	const frame = useCurrentFrame();
	const words = text.split(' ');
	const shown = Math.ceil(interpolate(frame, [0, length * FPS], [0, words.length], {extrapolateRight: 'clamp'}));
	return (
		<div style={{position: 'absolute', bottom: 110, left: 60, right: 60, display: 'flex', justifyContent: 'center'}}>
			<div style={{background: 'rgba(0,0,0,0.6)', borderRadius: 22, padding: '18px 30px', fontSize: 42, fontWeight: 600, color: 'white', textAlign: 'center', lineHeight: 1.3}}>
				{words.map((w, i) => (
					<span key={i} style={{opacity: i < shown ? 1 : 0.3}}>
						{w}{' '}
					</span>
				))}
			</div>
		</div>
	);
};

const SceneShell: React.FC<{id: SceneId; text: string}> = ({id, text}) => {
	const frame = useCurrentFrame();
	const length = sceneFrames(id);
	const Scene = SCENES[id];
	return (
		<AbsoluteFill style={{opacity: interpolate(frame, [0, 8, length - 8, length], [0, 1, 1, 0], clamp)}}>
			<Scene />
			<Subtitle text={text} length={seconds[id]} />
			<Audio src={staticFile(`vo/${id}.wav`)} />
		</AbsoluteFill>
	);
};

export const TiboIntro: React.FC = () => (
	<AbsoluteFill style={{fontFamily: FONT}}>
		<Background />
		{/* Music under the voice: fade in, fade out over the last 2 s. */}
		<Audio
			src={staticFile('music.mp3')}
			volume={(f) => 0.06 * interpolate(f, [0, 20, totalFrames - 60, totalFrames], [0, 1, 1, 0], clamp)}
		/>
		<Series>
			{SCRIPT.map(({id, text}) => (
				<Series.Sequence key={id} durationInFrames={sceneFrames(id)}>
					<SceneShell id={id} text={text} />
				</Series.Sequence>
			))}
		</Series>
		<div style={{position: 'absolute', left: 0, right: 0, bottom: 30, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 20, lineHeight: 1.5}}>
			Emoji: Google Noto (CC BY 4.0) · Music: “Wallpaper” Kevin MacLeod (incompetech.com), CC BY 4.0
		</div>
	</AbsoluteFill>
);
