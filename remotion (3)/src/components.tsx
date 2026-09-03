import React from 'react';
import {Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from './theme';

export const ScreenshotCrop: React.FC<{
  src:'Pic1.png'|'Pic2.png'|'Pic3.png'|'Pic4.png';
  x?:number;y?:number;scale?:number;width?:number;height?:number;radius?:number;
}> = ({src,x=50,y=50,scale=1,width=1260,height=720,radius=28}) => {
  const f=useCurrentFrame();
  const {fps}=useVideoConfig();
  const enter=spring({frame:f,fps,config:{damping:18,stiffness:105,mass:.8}});
  return <div style={{width,height,overflow:'hidden',borderRadius:radius,background:theme.white,boxShadow:'0 28px 90px rgba(0,0,0,.20)',transform:`translateY(${(1-enter)*42}px) scale(${.97+enter*.03})`,opacity:enter,position:'relative'}}>
    <Img src={staticFile(src)} style={{position:'absolute',width:`${100*scale}%`,height:'auto',left:`${-(x*(scale-1))}%`,top:`${-(y*(scale-1))}%`}}/>
  </div>;
};

export const Cursor: React.FC<{x:number;y:number;clickAt?:number}> = ({x,y,clickAt=999}) => {
  const f=useCurrentFrame();
  const pulse=f>=clickAt && f<clickAt+8 ? interpolate(f,[clickAt,clickAt+4,clickAt+8],[0,1,0]) : 0;
  return <div style={{position:'absolute',left:x,top:y,zIndex:20}}>
    <div style={{position:'absolute',width:42,height:42,borderRadius:99,border:'3px solid rgba(239,51,64,.45)',transform:`translate(-16px,-16px) scale(${1+pulse*.8})`,opacity:pulse}}/>
    <svg width="34" height="42" viewBox="0 0 34 42"><path d="M3 2L29 25H17L11 39L4 36L10 23H3Z" fill="#fff" stroke="#111318" strokeWidth="2"/></svg>
  </div>;
};

export const BrandMark:React.FC<{size?:number}>=({size=112})=>(
  <div style={{width:size,height:size,borderRadius:size*.24,overflow:'hidden',boxShadow:'0 18px 50px rgba(239,51,64,.25)'}}>
    <Img src={staticFile('Logo1.ico')} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
  </div>
);
