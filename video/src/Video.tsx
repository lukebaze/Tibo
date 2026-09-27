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
const PAD = 1.1; // seconds of air after each narration line
export const sceneFrames = (id: SceneId) => Math.ceil(((durations as Record<string, number>)[id] + PAD) * FPS);
export const totalFrames = SCRIPT.reduce((sum, s) => sum + sceneFrames(s.id), 0);

const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif';
const ACCENT = '#ff9f43';

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
		<div style={{width: size, height: size, transform: `scale(${s}) rotate(${(1 - s) * -25}deg)`, ...style}}>
			<Gif src={staticFile(`emoji/${code}.gif`)} width={size} height={size} fit="contain" />
		</div>
	);
};

const Title: React.FC<{kicker: string; title: string; delay?: number}> = ({kicker, title, delay = 0}) => {
	const s = useSpring(delay, 14);
	return (
		<div style={{opacity: s, transform: `translateY(${(1 - s) * 40}px)`}}>
			<div style={{color: ACCENT, fontSize: 30, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase'}}>{kicker}</div>
			<div style={{color: 'white', fontSize: 78, fontWeight: 800, lineHeight: 1.08, marginTop: 10, maxWidth: 900}}>{title}</div>
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
				borderRadius: 22,
				padding: '18px 28px',
				fontSize: 34,
				fontWeight: 600,
			}}
		>
			{children}
		</div>
	);
};

/** The black notch pill, flush with the top edge like the real one. */
const Notch: React.FC<{open: number; clip: string; children?: React.ReactNode}> = ({open, clip, children}) => {
	const width = interpolate(open, [0, 1], [230, 760]);
	const radius = interpolate(open, [0, 1], [18, 44]);
	return (
		<div
			style={{
				position: 'absolute',
				top: 0,
				left: '50%',
				transform: 'translateX(-50%)',
				width,
				background: 'black',
				borderBottomLeftRadius: radius,
				borderBottomRightRadius: radius,
				boxShadow: '0 20px 80px rgba(0,0,0,0.6)',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				paddingTop: 12,
				paddingBottom: interpolate(open, [0, 1], [8, 26]),
				overflow: 'hidden',
			}}
		>
			<Taby clip={clip} width={interpolate(open, [0, 1], [70, 300])} />
			<div style={{opacity: open, width: '100%'}}>{children}</div>
		</div>
	);
};

const InputRow: React.FC<{text: string; placeholder?: string}> = ({text, placeholder = 'Hỏi Tibo hoặc gõ /'}) => (
	<div
		style={{
			margin: '10px 30px 0',
			background: 'rgba(255,255,255,0.1)',
			borderRadius: 999,
			padding: '16px 26px',
			fontSize: 28,
			color: text ? 'white' : 'rgba(255,255,255,0.4)',
			display: 'flex',
			justifyContent: 'space-between',
		}}
	>
		<span>{text || placeholder}</span>
		<span style={{opacity: 0.6}}>▦ 🎙</span>
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
				borderRadius: 28,
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

// ---------- scenes ----------

const Intro: React.FC = () => {
	const frame = useCurrentFrame();
	const s = useSpring(0, 11);
	const t = useSpring(18, 14);
	return (
		<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
			<div style={{transform: `scale(${s})`, background: 'black', borderRadius: 60, padding: '40px 70px'}}>
				<Taby clip={frame < 55 ? 'startup' : 'idle_01_loop'} width={520} />
			</div>
			<div style={{display: 'flex', alignItems: 'center', gap: 24, marginTop: 40, opacity: t}}>
				<div style={{color: 'white', fontSize: 150, fontWeight: 900, letterSpacing: -4}}>Tibo</div>
				<Emoji code="1f44b" size={140} delay={28} />
			</div>
			<div style={{color: 'rgba(255,255,255,0.75)', fontSize: 44, opacity: t, marginTop: 6}}>
				Trợ lý giọng nói sống trên notch của Mac
			</div>
		</AbsoluteFill>
	);
};

const Waveform: React.FC = () => {
	const frame = useCurrentFrame();
	return (
		<div style={{display: 'flex', gap: 10, alignItems: 'center', height: 140}}>
			{Array.from({length: 24}, (_, i) => (
				<div
					key={i}
					style={{
						width: 14,
						borderRadius: 7,
						background: ACCENT,
						height: 20 + 110 * Math.abs(Math.sin(frame / 5 + i * 0.7) * Math.sin(frame / 13 + i)),
					}}
				/>
			))}
		</div>
	);
};

const Voice: React.FC = () => {
	const frame = useCurrentFrame();
	const listening = frame > 20;
	return (
		<AbsoluteFill style={{padding: '0 140px', justifyContent: 'center'}}>
			<Notch open={spring({frame: frame - 14, fps: FPS, config: {damping: 14}})} clip={listening ? 'listening_loop' : 'idle_01_loop'}>
				<div style={{color: 'rgba(255,255,255,0.72)', fontSize: 26, textAlign: 'center', marginTop: 6}}>
					{frame < 120 ? 'Đang nghe… ngừng nói để gửi' : 'Đã ngắt, mời bạn nói tiếp'}
				</div>
			</Notch>
			<div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 200}}>
				<div>
					<Title kicker="Giọng nói" title="“Tibo ơi…”" />
					<div style={{display: 'flex', flexDirection: 'column', gap: 18, marginTop: 34, alignItems: 'flex-start'}}>
						<Chip delay={40}>🗣 Gọi tên: wake word</Chip>
						<Chip delay={60}>⏸ Smart-turn: tự gửi khi ngừng nói</Chip>
						<Chip delay={80}>🎙 Bấm để nói, bấm lại để gửi</Chip>
						<Chip delay={120} highlight>✋ Ngắt lời bất cứ lúc nào</Chip>
					</div>
				</div>
				<div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30}}>
					<Emoji code={frame < 120 ? '1f4ac' : '270b'} size={170} delay={frame < 120 ? 10 : 120} key={frame < 120 ? 'a' : 'b'} />
					<Waveform />
				</div>
			</div>
		</AbsoluteFill>
	);
};

const NotchScene: React.FC = () => {
	const frame = useCurrentFrame();
	const open = spring({frame: frame - 8, fps: FPS, config: {damping: 14}});
	const question = typed('tóm tắt trang này giúp tôi', frame, 30);
	const slash = frame > 100 ? typed('/', frame, 100) : '';
	const commands: [string, string][] = [
		['/caidat', 'Mở Cài đặt'],
		['/mic', 'Tắt microphone'],
		['/dung', 'Ngắt câu đang nói'],
		['/giong', 'Tắt giọng trả lời'],
		['/thoat', 'Thoát'],
	];
	// Hover cursor gliding up into the notch.
	const cx = interpolate(frame, [0, 14], [1250, 990], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
	const cy = interpolate(frame, [0, 14], [620, 30], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
	return (
		<AbsoluteFill>
			<Notch open={open} clip={frame > 100 ? 'searching_loop' : 'talking_default_loop'}>
				<InputRow text={frame > 100 ? slash : question} />
				{frame > 104 &&
					commands.map(([name, label], i) => (
						<div
							key={name}
							style={{
								display: 'flex',
								gap: 18,
								padding: '10px 56px',
								fontSize: 26,
								opacity: interpolate(frame, [104 + i * 4, 112 + i * 4], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
							}}
						>
							<span style={{fontFamily: 'Menlo, monospace', color: 'rgba(255,255,255,0.5)', width: 130}}>{name}</span>
							<span style={{color: 'white'}}>{label}</span>
						</div>
					))}
			</Notch>
			<div style={{position: 'absolute', left: cx, top: cy, fontSize: 60, opacity: frame < 40 ? 1 : 0}}>➤</div>
			<div style={{position: 'absolute', left: 140, bottom: 250}}>
				<Title kicker="Notch" title="Rê chuột là mở, gõ / là có lệnh" delay={10} />
			</div>
			<Emoji code="2728" size={150} delay={20} style={{position: 'absolute', right: 180, bottom: 280}} />
		</AbsoluteFill>
	);
};

const Apps: React.FC = () => {
	const apps = ['Safari', 'Calendar', 'Notes', 'Terminal', 'Mail'];
	return (
		<AbsoluteFill style={{padding: '0 140px', justifyContent: 'center'}}>
			<div style={{display: 'flex', alignItems: 'center', gap: 40}}>
				<Title kicker="Mở app" title="“Mở Safari”" />
				<Emoji code="1f680" size={180} delay={12} />
			</div>
			<div style={{display: 'flex', gap: 34, marginTop: 70}}>
				{apps.map((name, i) => (
					<AppTile key={name} name={name} delay={16 + i * 6} active={i === 0} />
				))}
			</div>
		</AbsoluteFill>
	);
};

const AppTile: React.FC<{name: string; delay: number; active: boolean}> = ({name, delay, active}) => {
	const frame = useCurrentFrame();
	const s = useSpring(delay, 10);
	const bounce = active ? Math.abs(Math.sin((frame - 40) / 6)) * interpolate(frame, [40, 80], [40, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 0;
	return (
		<div style={{transform: `scale(${s}) translateY(${-bounce}px)`, textAlign: 'center'}}>
			<Img src={staticFile(`apps/${name}.png`)} style={{width: 190, height: 190, borderRadius: 48, boxShadow: active ? `0 0 0 8px ${ACCENT}` : 'none'}} />
			<div style={{color: 'white', fontSize: 28, marginTop: 14}}>{name}</div>
		</div>
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
	const approved = frame > 150;
	return (
		<AbsoluteFill style={{padding: '110px 140px'}}>
			<div style={{display: 'flex', alignItems: 'center', gap: 36}}>
				<Title kicker="Vibe coding bằng giọng nói" title="Ra lệnh cho coding agent" />
				<Emoji code="1f4bb" size={150} delay={10} />
			</div>
			<div style={{display: 'flex', gap: 30, marginTop: 50}}>
				{agents.map(([name, clip], i) => (
					<Panel key={name} delay={20 + i * 8} style={{padding: 26, alignItems: 'center', display: 'flex', flexDirection: 'column', width: 380}}>
						<div style={{background: 'black', borderRadius: 24, padding: 10}}>
							<Taby clip={clip} width={300} />
						</div>
						<div style={{color: 'white', fontSize: 38, fontWeight: 700, marginTop: 14}}>{name}</div>
					</Panel>
				))}
			</div>
			<Panel delay={75} style={{marginTop: 40, padding: '26px 36px', display: 'flex', alignItems: 'center', gap: 30}}>
				<div style={{color: 'white', fontSize: 34, flex: 1}}>
					<span style={{color: ACCENT, fontWeight: 700}}>omp</span> sẽ sửa test đang lỗi trong <span style={{fontFamily: 'Menlo, monospace'}}>~/Tibo</span>. Chạy nhé?
				</div>
				{approved ? (
					<>
						<div style={{color: '#5ee08a', fontSize: 34, fontWeight: 700}}>Đã xong · 27/27 test pass</div>
						<Emoji code="2705" size={90} delay={150} />
					</>
				) : (
					<>
						<div style={{background: ACCENT, color: '#1a1206', fontSize: 30, fontWeight: 700, borderRadius: 18, padding: '12px 26px', transform: `scale(${frame > 130 ? 0.92 : 1})`}}>Đồng ý</div>
						<div style={{color: 'rgba(255,255,255,0.6)', fontSize: 30}}>Huỷ</div>
					</>
				)}
			</Panel>
		</AbsoluteFill>
	);
};

const Screen: React.FC = () => {
	const frame = useCurrentFrame();
	const scan = interpolate(frame, [30, 100], [0, 100], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	const lines = [
		'$ cargo test',
		'error[E0308]: mismatched types',
		'  --> src/policy.rs:681:29',
		'   expected `Decision`, found `Option<Decision>`',
		'help: consider using `Option::expect`',
	];
	const answer = typed('Hàm trả về Option, còn test chờ Decision. Thêm .unwrap() hoặc so với Some(...).', frame, 120, 1.1);
	return (
		<AbsoluteFill style={{padding: '110px 140px'}}>
			<div style={{display: 'flex', alignItems: 'center', gap: 36}}>
				<Title kicker="Đọc màn hình" title="“Lỗi này nghĩa là gì?”" />
				<Emoji code="1f440" size={150} delay={10} />
			</div>
			<div style={{display: 'flex', gap: 40, marginTop: 50}}>
				<Panel delay={14} style={{flex: 1.2, padding: 36, position: 'relative', overflow: 'hidden'}}>
					<div style={{display: 'flex', gap: 10, marginBottom: 24}}>
						{['#ff5f57', '#febc2e', '#28c840'].map((c) => (
							<div key={c} style={{width: 18, height: 18, borderRadius: 9, background: c}} />
						))}
					</div>
					{lines.map((l, i) => (
						<div
							key={l}
							style={{
								fontFamily: 'Menlo, monospace',
								fontSize: 28,
								lineHeight: 1.7,
								color: i === 1 ? '#ff6b6b' : 'rgba(255,255,255,0.85)',
								background: scan > (i + 1) * 20 - 5 ? 'rgba(255,159,67,0.18)' : 'transparent',
							}}
						>
							{l}
						</div>
					))}
					<div style={{position: 'absolute', left: 0, right: 0, top: `${scan}%`, height: 4, background: ACCENT, boxShadow: `0 0 30px ${ACCENT}`, opacity: scan > 0 && scan < 100 ? 1 : 0}} />
				</Panel>
				<div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: 24}}>
					<Chip delay={40}>🔤 OCR ngay trên máy (Vision)</Chip>
					<Chip delay={60}>🖼 Hỏi về hình, màu, biểu đồ → gửi ảnh cho model</Chip>
					{frame > 120 && (
						<Panel style={{padding: 28, color: 'white', fontSize: 32, lineHeight: 1.4}}>
							<span style={{color: ACCENT, fontWeight: 700}}>Tibo: </span>
							{answer}
						</Panel>
					)}
				</div>
			</div>
		</AbsoluteFill>
	);
};

const Control: React.FC = () => {
	const frame = useCurrentFrame();
	const cx = interpolate(frame, [20, 70], [300, 1180], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
	const cy = interpolate(frame, [20, 70], [820, 560], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
	const clicked = frame > 95;
	return (
		<AbsoluteFill style={{padding: '110px 140px'}}>
			<div style={{display: 'flex', alignItems: 'center', gap: 36}}>
				<Title kicker="Điều khiển máy" title="Bấm, gõ, mở trang thay bạn" />
				<Emoji code="1f446" size={150} delay={8} />
			</div>
			<Panel delay={10} style={{position: 'absolute', left: 900, top: 470, padding: '30px 40px', display: 'flex', alignItems: 'center', gap: 26}}>
				<div style={{background: 'black', borderRadius: 20, padding: 6}}>
					<Taby clip="confirmation" width={180} />
				</div>
				<div>
					<div style={{color: 'white', fontSize: 32}}>Mở Safari rồi vào github.com?</div>
					<div style={{display: 'flex', gap: 20, marginTop: 16}}>
						<div style={{background: clicked ? '#5ee08a' : ACCENT, color: '#1a1206', fontSize: 28, fontWeight: 700, borderRadius: 16, padding: '10px 24px'}}>
							{clicked ? 'Đã cho phép ✓' : 'Cho phép'}
						</div>
						<div style={{color: 'rgba(255,255,255,0.6)', fontSize: 28, padding: '10px 0'}}>Huỷ</div>
					</div>
				</div>
			</Panel>
			<div style={{position: 'absolute', left: cx, top: cy, fontSize: 70, transform: `scale(${frame > 85 && frame < 95 ? 0.8 : 1})`, filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.5))'}}>
				➤
			</div>
			<div style={{position: 'absolute', left: 140, bottom: 250}}>
				<Chip delay={30} highlight>🔐 Luôn hỏi trước khi bấm</Chip>
			</div>
		</AbsoluteFill>
	);
};

const Stat: React.FC<{value: string; label: string; delay: number}> = ({value, label, delay}) => (
	<Panel delay={delay} style={{padding: '36px 44px', flex: 1}}>
		<div style={{color: ACCENT, fontSize: 84, fontWeight: 900}}>{value}</div>
		<div style={{color: 'rgba(255,255,255,0.8)', fontSize: 32, marginTop: 6}}>{label}</div>
	</Panel>
);

const Local: React.FC = () => (
	<AbsoluteFill style={{padding: '130px 140px'}}>
		<div style={{display: 'flex', alignItems: 'center', gap: 36}}>
			<Title kicker="Nhanh & riêng tư" title="Giọng nói xử lý ngay trên máy" />
			<Emoji code="1f512" size={140} delay={8} />
			<Emoji code="26a1" size={140} delay={16} />
		</div>
		<div style={{display: 'flex', gap: 34, marginTop: 70}}>
			<Stat value="Whisper" label="nhận giọng nói offline" delay={20} />
			<Stat value="351 ms" label="hiểu lệnh (p50 benchmark)" delay={30} />
			<Stat value="0%" label="chạy nhầm lệnh (benchmark)" delay={40} />
		</div>
	</AbsoluteFill>
);

const Onboarding: React.FC = () => {
	const frame = useCurrentFrame();
	const steps = ['Chào', 'Model', 'Micro', 'Nghe thử', 'Giọng đọc', 'Từ gọi', 'Notch', 'Quyền', 'Thử ngay', 'Xong'];
	const at = Math.min(steps.length - 1, Math.floor(interpolate(frame, [15, 140], [0, steps.length - 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})));
	const pct = Math.round(interpolate(frame, [20, 120], [0, 100], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
	return (
		<AbsoluteFill style={{padding: '130px 140px'}}>
			<div style={{display: 'flex', alignItems: 'center', gap: 36}}>
				<Title kicker="Cài đặt" title="Vài bước là xong" />
				<Emoji code="1f9d0" size={140} delay={10} />
			</div>
			<div style={{display: 'flex', gap: 14, marginTop: 70}}>
				{steps.map((step, i) => (
					<div key={step} style={{flex: 1, textAlign: 'center'}}>
						<div style={{height: 14, borderRadius: 7, background: i <= at ? ACCENT : 'rgba(255,255,255,0.15)'}} />
						<div style={{color: i === at ? 'white' : 'rgba(255,255,255,0.5)', fontSize: 24, marginTop: 14, fontWeight: i === at ? 700 : 400}}>{step}</div>
					</div>
				))}
			</div>
			<Panel delay={20} style={{marginTop: 60, padding: '30px 40px', display: 'flex', alignItems: 'center', gap: 30}}>
				<div style={{color: 'white', fontSize: 32, width: 520}}>Tải Whisper (đề xuất theo RAM máy)</div>
				<div style={{flex: 1, height: 18, borderRadius: 9, background: 'rgba(255,255,255,0.12)'}}>
					<div style={{width: `${pct}%`, height: '100%', borderRadius: 9, background: '#5ee08a'}} />
				</div>
				<div style={{color: 'white', fontSize: 32, width: 90, textAlign: 'right'}}>{pct}%</div>
			</Panel>
		</AbsoluteFill>
	);
};

const RECAP: [string, string][] = [
	['1f44b', 'Gọi “Tibo”'],
	['270b', 'Ngắt lời'],
	['2728', 'Notch + lệnh /'],
	['1f680', 'Mở app'],
	['1f4bb', 'Điều khiển coding agent'],
	['1f440', 'Đọc màn hình'],
	['1f446', 'Điều khiển máy'],
	['1f512', 'Chạy trên máy'],
];

const Recap: React.FC = () => (
	<AbsoluteFill style={{padding: '110px 140px'}}>
		<div style={{display: 'flex', alignItems: 'center', gap: 36}}>
			<Title kicker="Tóm lại" title="Tibo làm được gì?" />
			<Emoji code="1f389" size={150} delay={6} />
		</div>
		<div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 28, marginTop: 50}}>
			{RECAP.map(([code, label], i) => (
				<Panel key={code} delay={10 + i * 5} style={{padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
					<Emoji code={code} size={110} delay={10 + i * 5} />
					<div style={{color: 'white', fontSize: 30, fontWeight: 600, marginTop: 14, textAlign: 'center'}}>{label}</div>
				</Panel>
			))}
		</div>
	</AbsoluteFill>
);

const Outro: React.FC = () => {
	const s = useSpring(0, 10);
	return (
		<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
			<div style={{transform: `scale(${s})`, background: 'black', borderRadius: 60, padding: '30px 60px'}}>
				<Taby clip="thumbs_up" width={440} />
			</div>
			<div style={{display: 'flex', alignItems: 'center', gap: 20, marginTop: 30, opacity: s}}>
				<div style={{color: 'white', fontSize: 90, fontWeight: 900}}>Tibo ơi, bắt đầu thôi!</div>
				<Emoji code="1f60e" size={120} delay={10} />
			</div>
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
			<div style={{position: 'absolute', width: 1100, height: 1100, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,159,67,0.22), transparent 65%)', left: -300 + Math.sin(frame / 90) * 120, top: -350}} />
			<div style={{position: 'absolute', width: 1200, height: 1200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(110,90,255,0.22), transparent 65%)', right: -400, bottom: -500 + Math.cos(frame / 80) * 120}} />
		</AbsoluteFill>
	);
};

/** Subtitle that reveals words roughly in step with the narration. */
const Subtitle: React.FC<{text: string; seconds: number}> = ({text, seconds}) => {
	const frame = useCurrentFrame();
	const words = text.split(' ');
	const shown = Math.ceil(interpolate(frame, [0, seconds * FPS], [0, words.length], {extrapolateRight: 'clamp'}));
	return (
		<div style={{position: 'absolute', bottom: 60, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
			<div style={{background: 'rgba(0,0,0,0.55)', borderRadius: 18, padding: '14px 30px', fontSize: 34, color: 'white', maxWidth: 1500, textAlign: 'center'}}>
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
	const fade = interpolate(frame, [0, 8, length - 8, length], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	return (
		<AbsoluteFill style={{opacity: fade}}>
			<Scene />
			<Subtitle text={text} seconds={(durations as Record<string, number>)[id]} />
			<Audio src={staticFile(`vo/${id}.wav`)} />
		</AbsoluteFill>
	);
};

export const TiboIntro: React.FC = () => (
	<AbsoluteFill style={{fontFamily: FONT}}>
		<Background />
		<Series>
			{SCRIPT.map(({id, text}) => (
				<Series.Sequence key={id} durationInFrames={sceneFrames(id)}>
					<SceneShell id={id} text={text} />
				</Series.Sequence>
			))}
		</Series>
		<div style={{position: 'absolute', right: 30, top: 24, color: 'rgba(255,255,255,0.35)', fontSize: 18}}>
			Animated emoji: Google Noto (CC BY 4.0)
		</div>
	</AbsoluteFill>
);
