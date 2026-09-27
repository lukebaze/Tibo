import {Composition} from 'remotion';
import {FPS, TiboIntro, totalFrames} from './Video';

export const Root: React.FC = () => (
	<Composition id="TiboIntro" component={TiboIntro} durationInFrames={totalFrames} fps={FPS} width={1920} height={1080} />
);
