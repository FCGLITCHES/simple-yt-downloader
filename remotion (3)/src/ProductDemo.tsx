import React from 'react';
import {AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {BrandMark, Cursor, ScreenshotCrop} from './components';
import {copy, theme} from './theme';

const font="'Manrope', 'Inter', Arial, sans-serif";

const Problem:React.FC=()=>{
  const f=useCurrentFrame();
  const keyIn=interpolate(f,[18,32],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const cascade=interpolate(f,[74,118],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const out=interpolate(f,[128,150],[1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  return <AbsoluteFill style={{background:theme.red,color:theme.white,fontFamily:font,justifyContent:'center',alignItems:'center',opacity:out}}>
    <div style={{width:1420,fontSize:76,lineHeight:1.08,fontWeight:750,letterSpacing:-3,textAlign:'center'}}>
      <div style={{opacity:keyIn}}>{copy.problemTop}</div>
      <div style={{position:'relative',marginTop:18,opacity:keyIn}}>
        <span>{copy.problemKey}</span>
        {[1,2,3].map(i=><span key={i} style={{position:'absolute',left:0,right:0,top:0,transform:`translateY(${cascade*i*64}px)`,opacity:(1-cascade)*.34,color:'rgba(255,255,255,.55)'}}>{copy.problemKey}</span>)}
      </div>
    </div>
  </AbsoluteFill>
};

const PasteAndAnalyze:React.FC=()=>{
  const f=useCurrentFrame();
  const urlChars=Math.floor(interpolate(f,[55,105],[0,copy.inputUrl.length],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}));
  const zoom=interpolate(f,[0,35],[1.04,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  return <AbsoluteFill style={{background:theme.paper,fontFamily:font,alignItems:'center',justifyContent:'center'}}>
    <div style={{position:'absolute',top:70,left:120,fontSize:54,fontWeight:760,letterSpacing:-2,color:theme.ink}}>One link. No account maze.</div>
    <div style={{transform:`scale(${zoom})`,position:'relative'}}>
      <ScreenshotCrop src="Pic1.png" scale={1.08} x={50} y={42} width={1480} height={760}/>
      <div style={{position:'absolute',left:185,top:172,width:1040,height:72,borderRadius:14,background:'rgba(255,255,255,.96)',border:`2px solid ${theme.red}`,display:'flex',alignItems:'center',padding:'0 24px',fontSize:24,color:theme.ink,boxSizing:'border-box'}}>
        {copy.inputUrl.slice(0,urlChars)}<span style={{width:2,height:30,background:theme.ink,marginLeft:2,opacity:Math.floor(f/10)%2}}/>
      </div>
      <Cursor x={1270} y={195} clickAt={112}/>
    </div>
    <div style={{position:'absolute',bottom:64,fontSize:28,fontWeight:600,color:theme.muted}}>Paste a video URL and let GetVideosLocally inspect what is available.</div>
  </AbsoluteFill>
};

const Command:React.FC=()=>{
  const f=useCurrentFrame();
  const text=copy.action;
  const chars=Math.floor(interpolate(f,[18,82],[0,text.length],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}));
  const send=spring({frame:f-92,fps:30,config:{damping:13,stiffness:150}});
  return <AbsoluteFill style={{background:theme.white,fontFamily:font,justifyContent:'center',alignItems:'center'}}>
    <div style={{position:'absolute',top:78,left:120,fontSize:58,fontWeight:780,letterSpacing:-2,color:theme.ink}}>Choose what you want to keep.</div>
    <ScreenshotCrop src="Pic2.png" scale={1.18} x={48} y={52} width={1450} height={730}/>
    <div style={{position:'absolute',left:330,bottom:158,width:1050,height:86,borderRadius:18,border:`1px solid ${theme.border}`,background:'rgba(255,255,255,.98)',boxShadow:'0 14px 40px rgba(17,19,24,.10)',display:'flex',alignItems:'center',padding:'0 18px 0 28px',boxSizing:'border-box'}}>
      <div style={{fontSize:25,color:theme.ink,flex:1}}>{text.slice(0,chars)}<span style={{opacity:Math.floor(f/9)%2}}>|</span></div>
      <div style={{width:58,height:58,borderRadius:14,background:theme.red,display:'grid',placeItems:'center',transform:`scale(${.82+.18*Math.max(0,send)})`,color:'#fff',fontSize:30}}>↑</div>
    </div>
    <Cursor x={1370} y={838} clickAt={102}/>
  </AbsoluteFill>
};

const Outcome:React.FC=()=>{
  const f=useCurrentFrame();
  const {fps}=useVideoConfig();
  const card=spring({frame:f-12,fps,config:{damping:15,stiffness:115}});
  const progress=interpolate(f,[20,90],[0,100],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const done=interpolate(f,[88,104],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  return <AbsoluteFill style={{background:theme.ink,fontFamily:font,color:'#fff',justifyContent:'center',alignItems:'center'}}>
    <div style={{display:'flex',gap:88,alignItems:'center',width:1540}}>
      <div style={{position:'relative'}}>
        <ScreenshotCrop src="Pic3.png" scale={1.28} x={50} y={62} width={900} height={600}/>
        <div style={{position:'absolute',left:95,bottom:88,width:690,height:122,borderRadius:18,background:done>.5?theme.green:theme.red,padding:'22px 28px',boxSizing:'border-box',transform:`scale(${.96+card*.04})`}}>
          <div style={{fontSize:25,fontWeight:800}}>{done>.5?copy.result:'Downloading'}</div>
          <div style={{height:8,borderRadius:8,background:'rgba(255,255,255,.24)',margin:'14px 0 10px',overflow:'hidden'}}><div style={{width:`${progress}%`,height:'100%',background:'#fff'}}/></div>
          <div style={{fontSize:16,opacity:.86}}>{done>.5?copy.resultDetail:`${Math.round(progress)}% • processing locally`}</div>
        </div>
      </div>
      <div style={{width:520,opacity:interpolate(f,[72,100],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),transform:`translateX(${interpolate(f,[72,100],[35,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}px)`}}>
        <div style={{fontSize:68,fontWeight:800,lineHeight:1.02,letterSpacing:-3}}>From link to local file.</div>
        <div style={{fontSize:29,lineHeight:1.45,color:'#cfd4dc',marginTop:28}}>Up to 8K, highest bitrate prioritised, with progress, speed and ETA visible while it works.</div>
      </div>
    </div>
  </AbsoluteFill>
};

const CTA:React.FC=()=>{
  const f=useCurrentFrame();
  const {fps}=useVideoConfig();
  const logo=spring({frame:f,fps,config:{damping:13,stiffness:110}});
  const button=spring({frame:f-28,fps,config:{damping:15,stiffness:120}});
  const url=interpolate(f,[52,72],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  return <AbsoluteFill style={{background:theme.white,fontFamily:font,justifyContent:'center',alignItems:'center',color:theme.ink}}>
    <div style={{transform:`scale(${logo})`,opacity:logo}}><BrandMark size={126}/></div>
    <div style={{fontSize:72,fontWeight:820,letterSpacing:-3,marginTop:30}}>Get Videos Locally</div>
    <div style={{fontSize:30,color:theme.muted,marginTop:14}}>{copy.promise}</div>
    <div style={{marginTop:42,background:theme.red,color:'#fff',fontSize:26,fontWeight:800,padding:'20px 34px',borderRadius:16,transform:`scale(${button})`,opacity:button,boxShadow:'0 18px 50px rgba(239,51,64,.25)'}}>{copy.cta}</div>
    <div style={{fontSize:25,fontWeight:700,marginTop:24,opacity:url}}>{copy.url}</div>
    <div style={{position:'absolute',bottom:34,fontSize:17,color:'#98a2b3'}}>Free • Open source • Windows</div>
  </AbsoluteFill>
};

export const ProductDemo:React.FC=()=>(
  <AbsoluteFill>
    <Sequence from={0} durationInFrames={165}><Problem/></Sequence>
    <Sequence from={165} durationInFrames={210}><PasteAndAnalyze/></Sequence>
    <Sequence from={375} durationInFrames={180}><Command/></Sequence>
    <Sequence from={555} durationInFrames={195}><Outcome/></Sequence>
    <Sequence from={750} durationInFrames={150}><CTA/></Sequence>
  </AbsoluteFill>
);
