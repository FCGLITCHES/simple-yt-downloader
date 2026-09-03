import React from 'react';
import {AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame} from 'remotion';

const W = 1920;
const H = 1080;
const SOURCE_W = 1286;
const SOURCE_H = 972;
const red = '#c9152d';
const ink = '#151515';
const paper = '#f7f7f5';
const clamp = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};

const fontCss = `@font-face{font-family:ManropeLocal;src:url('${staticFile('manrope-latin.woff2')}') format('woff2');font-weight:200 800;font-style:normal;font-display:swap;}`;

const Shell: React.FC<{children: React.ReactNode; background?: string; color?: string}> = ({children, background = paper, color = ink}) => (
  <AbsoluteFill style={{background, color, fontFamily: 'ManropeLocal, Segoe UI, sans-serif', overflow: 'hidden'}}>
    <style>{fontCss}</style>
    {children}
  </AbsoluteFill>
);

type Camera = {cx: number; cy: number; zoom: number};
const cameraTransform = (camera: Camera) => ({
  left: W / 2 - camera.cx * camera.zoom,
  top: H / 2 - camera.cy * camera.zoom,
});

const SourceStage: React.FC<{src: 'Pic1.png' | 'Pic2.png' | 'Pic3.png' | 'Pic4.png'; camera: Camera; opacity?: number}> = ({src, camera, opacity = 1}) => {
  const p = cameraTransform(camera);
  return (
    <div style={{position: 'absolute', left: p.left, top: p.top, width: SOURCE_W, height: SOURCE_H, transform: `scale(${camera.zoom})`, transformOrigin: '0 0', opacity}}>
      <Img src={staticFile(src)} style={{width: SOURCE_W, height: SOURCE_H, display: 'block'}} />
    </div>
  );
};

const mapPoint = (x: number, y: number, camera: Camera) => {
  const p = cameraTransform(camera);
  return {x: p.left + x * camera.zoom, y: p.top + y * camera.zoom};
};

const Cursor: React.FC<{x: number; y: number; down?: number}> = ({x, y, down = 0}) => (
  <div style={{position: 'absolute', left: x, top: y, width: 34, height: 46, transform: `scale(${1 - down * 0.1})`, transformOrigin: '3px 3px', filter: 'drop-shadow(0 5px 7px rgba(0,0,0,.28))'}}>
    <svg viewBox="0 0 28 38" width="34" height="46"><path d="M2 2l22 21-11 1 6 11-5 2-6-11-7 8z" fill="white" stroke="#111" strokeWidth="2"/></svg>
  </div>
);

const FocusRing: React.FC<{x: number; y: number; w: number; h: number; camera: Camera; opacity?: number}> = ({x, y, w, h, camera, opacity = 1}) => {
  const p = mapPoint(x, y, camera);
  return <div style={{position: 'absolute', left: p.x, top: p.y, width: w * camera.zoom, height: h * camera.zoom, border: `3px solid ${red}`, borderRadius: 14, boxSizing: 'border-box', boxShadow: '0 0 0 7px rgba(201,21,45,.10)', opacity}} />;
};

const Caption: React.FC<{kicker?: string; title: string; body?: string; dark?: boolean; align?: 'left' | 'right'}> = ({kicker, title, body, dark = false, align = 'left'}) => (
  <div style={{position: 'absolute', top: 72, [align]: 76, width: 570, padding: '22px 26px', borderRadius: 22, background: dark ? 'rgba(8,8,8,.82)' : 'rgba(255,255,255,.90)', color: dark ? 'white' : ink, boxShadow: '0 18px 48px rgba(0,0,0,.14)', backdropFilter: 'blur(12px)'}}>
    {kicker ? <div style={{fontSize: 17, fontWeight: 800, letterSpacing: 2, color: red, marginBottom: 8}}>{kicker}</div> : null}
    <div style={{fontSize: 38, fontWeight: 800, lineHeight: 1.08, letterSpacing: -1.6}}>{title}</div>
    {body ? <div style={{fontSize: 21, lineHeight: 1.45, marginTop: 11, color: dark ? '#d8d8d8' : '#555'}}>{body}</div> : null}
  </div>
);

const Scene1 = () => {
  const f = useCurrentFrame();
  const enter = spring({frame: f - 6, fps: 30, config: {damping: 20, stiffness: 90}});
  return <Shell background="#fff"><div style={{margin: 'auto', textAlign: 'center', opacity: enter, transform: `translateY(${(1-enter)*26}px)`}}><Img src={staticFile('Logo.png')} style={{width: 132, height: 132, objectFit: 'contain', marginBottom: 24}}/><div style={{fontSize: 84, fontWeight: 800, letterSpacing: -4.5}}>GetVideosLocally</div><div style={{fontSize: 30, marginTop: 16, color: '#626262'}}>Paste a link. Choose your quality. Keep the file.</div><div style={{width: 96, height: 7, borderRadius: 99, background: red, margin: '32px auto 0'}}/></div></Shell>;
};

const Scene2 = () => {
  const f = useCurrentFrame();
  const t = interpolate(f, [0, 95], [0, 1], clamp);
  const camera = {cx: interpolate(t, [0,1], [643, 285]), cy: interpolate(t, [0,1], [486, 466]), zoom: interpolate(t, [0,1], [1.12, 2.02])};
  const from = mapPoint(1010, 760, camera);
  const to = mapPoint(305, 467, camera);
  const move = interpolate(f, [42, 86], [0, 1], clamp);
  const x = interpolate(move, [0,1], [from.x, to.x]);
  const y = interpolate(move, [0,1], [from.y, to.y]);
  return <Shell background="#171717"><SourceStage src="Pic2.png" camera={camera}/><Caption kicker="01  PASTE" title="Start with the real URL field." body="The camera moves into the product's own input. Nothing is redrawn." dark/><FocusRing x={35} y={441} w={505} h={56} camera={camera} opacity={interpolate(f,[66,88],[0,1],clamp)}/><Cursor x={x} y={y}/></Shell>;
};

const Scene3 = () => {
  const f = useCurrentFrame();
  const ease = spring({frame: f, fps: 30, config: {damping: 24, stiffness: 80}});
  const camera = {cx: 310, cy: 585, zoom: 2.0 + ease * .12};
  const a = mapPoint(160, 579, camera);
  const b = mapPoint(420, 579, camera);
  const move = interpolate(f, [44, 92], [0,1], clamp);
  const x = interpolate(move,[0,1],[a.x,b.x]);
  const y = interpolate(move,[0,1],[a.y,b.y]);
  const ringX = move < .5 ? 36 : 295;
  const ringW = move < .5 ? 244 : 242;
  return <Shell background="#171717"><SourceStage src="Pic2.png" camera={camera}/><Caption kicker="02  CHOOSE" title="Format and quality stay in context." body="MP4 and Best available (up to 8K) are shown exactly where the product places them." dark align="right"/><FocusRing x={ringX} y={553} w={ringW} h={55} camera={camera}/><Cursor x={x} y={y}/></Shell>;
};

const Scene4 = () => {
  const f = useCurrentFrame();
  const camera = {cx: 286, cy: 714, zoom: 2.0};
  const c = mapPoint(300, 714, camera);
  const click = interpolate(f,[44,52,60],[0,1,0],clamp);
  const radius = interpolate(f,[58,102],[0,2200],clamp);
  return <Shell background="#171717"><SourceStage src="Pic2.png" camera={camera}/><Caption kicker="03  DOWNLOAD" title="One clear primary action." body="The cursor clicks the authentic Download Now button; its own red becomes the transition." dark/><FocusRing x={35} y={686} w={505} h={59} camera={camera}/><Cursor x={c.x} y={c.y} down={click}/><div style={{position:'absolute', left:c.x-radius/2, top:c.y-radius/2, width:radius, height:radius, borderRadius:'50%', background:red, opacity: interpolate(f,[58,72,110],[0,.98,1],clamp)}}/></Shell>;
};

const Scene5 = () => {
  const f = useCurrentFrame();
  const reveal = interpolate(f,[0,18],[0,1],clamp);
  const t = interpolate(f,[18,135],[0,1],clamp);
  const camera = {cx: interpolate(t,[0,1],[900,930]), cy: interpolate(t,[0,1],[420,365]), zoom: interpolate(t,[0,1],[1.32,1.62])};
  return <Shell background="#fff"><div style={{position:'absolute',inset:0,background:red,opacity:1-reveal}}/><SourceStage src="Pic1.png" camera={camera} opacity={reveal}/><Caption kicker="04  PROGRESS" title="The result is visible immediately." body="The captured source screen shows a real download in progress, bitrate, status, and queue state."/><FocusRing x={615} y={323} w={624} h={175} camera={camera} opacity={interpolate(f,[32,55],[0,1],clamp)}/></Shell>;
};

const Scene6 = () => {
  const f = useCurrentFrame();
  const items = ['MP4 · up to 8K', 'MKV · WEBM · MOV', 'MP3 · WAV · FLAC', 'M4A · OPUS', '1000+ supported sites'];
  const offset = -((f * 2.15) % 490);
  return <Shell background="#fff"><div style={{display:'flex', height:'100%', alignItems:'center', padding:'0 180px', gap:120}}><div style={{width:820}}><div style={{fontSize:20,fontWeight:800,letterSpacing:2.8,color:red}}>FLEXIBLE BY DESIGN</div><div style={{fontSize:72,fontWeight:800,letterSpacing:-3.8,lineHeight:1.02,marginTop:18}}>The format you need.<br/>The quality you want.</div><div style={{fontSize:24,lineHeight:1.5,color:'#666',marginTop:24,width:690}}>This is an editorial capability beat, not fake product UI. Every claim comes from GetVideosLocally's own product description.</div></div><div style={{width:610,height:540,overflow:'hidden',maskImage:'linear-gradient(transparent,black 17%,black 83%,transparent)'}}><div style={{transform:`translateY(${offset}px)`}}>{[...items,...items,...items].map((item,i)=><div key={`${item}-${i}`} style={{height:112,margin:12,borderRadius:24,border:'1px solid #ddd',background:paper,display:'flex',alignItems:'center',padding:'0 30px',boxSizing:'border-box',fontSize:27,fontWeight:750,boxShadow:'0 16px 34px rgba(0,0,0,.07)'}}><span style={{width:15,height:15,borderRadius:'50%',background:red,marginRight:22}}/>{item}</div>)}</div></div></div></Shell>;
};

const Scene7 = () => {
  const f = useCurrentFrame();
  const t = interpolate(f,[0,120],[0,1],clamp);
  const camera = {cx: interpolate(t,[0,1],[643,350]), cy: interpolate(t,[0,1],[500,410]), zoom: interpolate(t,[0,1],[1.08,1.72])};
  const start = mapPoint(1080,700,camera);
  const target = mapPoint(382,427,camera);
  const move = interpolate(f,[48,104],[0,1],clamp);
  return <Shell background="#0d1838"><SourceStage src="Pic3.png" camera={camera}/><Caption kicker="05  HISTORY" title="Downloaded files stay actionable." body="The shot reframes a real history card and moves toward its actual folder control." dark align="right"/><FocusRing x={12} y={358} w={402} h={185} camera={camera} opacity={interpolate(f,[68,96],[0,1],clamp)}/><Cursor x={interpolate(move,[0,1],[start.x,target.x])} y={interpolate(move,[0,1],[start.y,target.y])}/></Shell>;
};

const Scene8 = () => {
  const f = useCurrentFrame();
  const cards = [
    {big:'8K',small:'quality support',x:150,y:150},
    {big:'1000+',small:'supported sites',x:1420,y:170},
    {big:'Free',small:'no subscription',x:190,y:775},
    {big:'Local',small:'desktop workflow',x:1410,y:760},
  ];
  return <Shell background="#f5f5f2"><div style={{margin:'auto',textAlign:'center',width:900}}><div style={{fontSize:72,fontWeight:800,letterSpacing:-3.8,lineHeight:1.03}}>High quality.<br/>Without the paywall.</div><div style={{fontSize:25,color:'#666',marginTop:20}}>Download, process, convert, and keep control of your files.</div></div>{cards.map((c,i)=>{const s=spring({frame:f-i*8,fps:30,config:{damping:17,stiffness:85}});const dx=(i%2===0?-1:1)*(1-s)*80;const dy=(i<2?-1:1)*(1-s)*65;return <div key={c.big} style={{position:'absolute',left:c.x+dx,top:c.y+dy,width:320,height:148,borderRadius:26,background:'#fff',border:'1px solid #ddd',boxShadow:'0 20px 55px rgba(0,0,0,.09)',padding:'26px 28px',boxSizing:'border-box',opacity:s,transform:`scale(${.92+s*.08})`}}><div style={{fontSize:46,fontWeight:800,color:red,lineHeight:1}}>{c.big}</div><div style={{fontSize:21,color:'#686868',marginTop:10}}>{c.small}</div></div>})}</Shell>;
};

const Scene9 = () => {
  const f = useCurrentFrame();
  const enter = spring({frame:f-4,fps:30,config:{damping:22,stiffness:82}});
  return <Shell background="#090909" color="#fff"><div style={{margin:'auto',textAlign:'center',opacity:enter,transform:`scale(${.96+enter*.04})`}}><Img src={staticFile('Logo.png')} style={{width:150,height:150,objectFit:'contain',filter:'drop-shadow(0 20px 45px rgba(0,0,0,.45))'}}/><div style={{fontSize:60,fontWeight:800,letterSpacing:-2.7,marginTop:24}}>GetVideosLocally</div><div style={{fontSize:25,color:'#aaa',marginTop:10}}>Free. Local. Up to 8K.</div><div style={{fontSize:18,color:'#696969',marginTop:28}}>Download responsibly. Keep control locally.</div></div></Shell>;
};

export const ProductDemo: React.FC = () => (
  <AbsoluteFill>
    <Sequence from={0} durationInFrames={120}><Scene1/></Sequence>
    <Sequence from={120} durationInFrames={150}><Scene2/></Sequence>
    <Sequence from={270} durationInFrames={120}><Scene3/></Sequence>
    <Sequence from={390} durationInFrames={120}><Scene4/></Sequence>
    <Sequence from={510} durationInFrames={180}><Scene5/></Sequence>
    <Sequence from={690} durationInFrames={180}><Scene6/></Sequence>
    <Sequence from={870} durationInFrames={180}><Scene7/></Sequence>
    <Sequence from={1050} durationInFrames={180}><Scene8/></Sequence>
    <Sequence from={1230} durationInFrames={120}><Scene9/></Sequence>
  </AbsoluteFill>
);
