import React from 'react';
import {Composition} from 'remotion';
import {ProductDemo} from './ProductDemo';

export const Root: React.FC = () => (
  <Composition
    id="GetVideosLocallyDemo"
    component={ProductDemo}
    durationInFrames={900}
    fps={30}
    width={1920}
    height={1080}
  />
);
