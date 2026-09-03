import React from 'react';
import {Composition} from 'remotion';
import {ProductDemo} from './ProductDemo';
export const Root: React.FC = () => (
  <Composition id="ProductDemo" component={ProductDemo} durationInFrames={1350} fps={30} width={1920} height={1080} />
);
