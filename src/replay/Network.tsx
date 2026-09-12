import React from 'react';
import {deviceColor,type ReplayState} from './model.ts';

export function Network({state,playing}:{state:ReplayState;playing:boolean}){
 const container=React.useRef<HTMLDivElement>(null);
 const [geometry,setGeometry]=React.useState({width:780,height:300,hub:{x:390,y:110},nodes:[] as {x:number;y:number}[]});
 const complete=state.progress.queued===0&&state.progress.leased===0;
 const count=Math.max(3,state.devices.length);
 React.useLayoutEffect(()=>{
  const element=container.current;if(!element)return;
  const measure=()=>{
   const bounds=element.getBoundingClientRect(),hub=element.querySelector('.coordinator')!.getBoundingClientRect();
   const nodes=[...element.querySelectorAll('[data-connector]')].map(node=>{const r=node.getBoundingClientRect();return {x:r.x+r.width/2-bounds.x,y:r.y-bounds.y-5};});
   setGeometry({width:bounds.width,height:bounds.height,hub:{x:hub.x+hub.width/2-bounds.x,y:hub.bottom-bounds.y+2},nodes});
  };
  measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
 },[count,state.devices.length]);
 return <div ref={container} className={`network ${playing&&!state.gap?'motion-on':''}`} aria-label="Recorded compute network">
  <div className="network-heading"><span className="section-label">THE COMPUTE POOL</span><span className="network-caption">{state.devices.filter(d=>d.connected).length} connected <i/> {complete?'Run complete':'Tasks assigned on demand'}</span></div>
  <svg className="network-lines" viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none" aria-hidden="true">
   <defs><radialGradient id="hub-glow"><stop stopColor="#64dac0" stopOpacity=".1"/><stop offset="1" stopColor="#64dac0" stopOpacity="0"/></radialGradient></defs>
   <ellipse cx={geometry.hub.x} cy={geometry.hub.y-25} rx="170" ry="95" fill="url(#hub-glow)"/>
   {Array.from({length:count},(_,i)=>{
    const node=geometry.nodes[i]??{x:geometry.width*(i+.5)/count,y:geometry.height*.6},device=state.devices[i];
    const mid=(geometry.hub.y+node.y)/2;
    const path=`M${geometry.hub.x} ${geometry.hub.y} C${geometry.hub.x} ${mid} ${node.x} ${mid} ${node.x} ${node.y}`;
    return <g key={i} style={{color:deviceColor(i)}}>
     <path d={path} className={`connection ${device?.connected?'connected':''}`} />
     {device?.connected&&device.activeTaskIds.length>0&&!complete&&<path d={path} className="work-flow"/>}
    </g>;
   })}
  </svg>
  <div className="coordinator"><span className="coordinator-icon" aria-hidden="true"><i/><i/><i/></span><div><strong>Shared task queue</strong><span>{state.progress.queued.toLocaleString()} waiting <b>·</b> {state.progress.leased} in flight</span></div></div>
  <div className="network-devices" style={{gridTemplateColumns:`repeat(${count},1fr)`}}>
   {Array.from({length:count},(_,i)=>{
    const device=state.devices[i];
    if(!device)return <div className="network-slot" key={i}><div className="empty-laptop" data-connector>＋</div><span>Open to join</span></div>;
    const recent=state.at-device.joinedAt<8_000&&device.joinedAt>state.at-state.elapsedMs;
    return <div key={device.id} className={`network-device ${!device.connected?'departed':''} ${recent?'just-joined':''} ${device.activeTaskIds.length&&!complete?'is-working':''}`} style={{'--device-color':deviceColor(i)} as React.CSSProperties}>
     <div className="laptop"><div className="laptop-screen" data-connector><span>{!device.connected?'LEFT':complete?'DONE':device.activeTaskIds.length?'WORKING':'READY'}</span><div className="mini-bars">{[1,2,3,4,5,6,7].map(n=><i key={n} style={{height:`${18+(n*17)%47}%`,animationDelay:`${n*-.19}s`}}/>)}</div></div><div className="laptop-base"/></div>
     <strong>{device.name}</strong><span className="device-hardware">{device.cpu.replace('Apple ','')} · {Math.round(device.memoryBytes/2**30)} GB</span>
     <div className="node-count"><b>{device.completed.toLocaleString()}</b><span>accepted</span></div>
    </div>;
   })}
  </div>
  <div className="network-footnote"><span><i className="legend-dot"/> Accepted work stays credited after a device leaves.</span><span>Activity diagram · recorded task counts</span></div>
 </div>;
}
