import {Composition} from 'remotion';
import {FPS, HEIGHT, TiboIntro, WIDTH, totalFrames} from './Video';

export const Root: React.FC = () => (
	<Composition id="TiboIntro" component={TiboIntro} durationInFrames={totalFrames} fps={FPS} width={WIDTH} height={HEIGHT} />
);
