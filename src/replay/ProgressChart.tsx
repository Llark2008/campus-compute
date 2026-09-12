import React from 'react';
import {chartSeries,formatTime,type ReplayIndex,type ReplayState} from './model.ts';

export function ProgressChart({index,state}:{index:ReplayIndex;state:ReplayState}){
 const width=740,height=94,pad=4,total=state.progress.planned||1;
 const x=(elapsed:number)=>pad+(width-pad*2)*Math.max(0,Math.min(1,elapsed/(index.durationMs||1)));
 const y=(fresh:number)=>height-pad-(height-pad*2)*fresh/total;
 const segments=chartSeries(index,state);
 const path=(series:{elapsed:number;fresh:number}[])=>series.map((p,i)=>`${i?'L':'M'}${x(p.elapsed).toFixed(1)},${y(p.fresh).toFixed(1)}`).join(' ');
 return <section className="chart-panel" aria-label="Recorded cumulative progress">
  <div className="panel-heading"><span className="section-label">WORK ADDS UP</span><span>Cumulative fresh results <b>{state.progress.fresh.toLocaleString()}</b></span></div>
  <svg className="progress-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${state.progress.fresh} accepted results at ${formatTime(state.elapsedMs)}`}>
   <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#15957f" stopOpacity=".25"/><stop offset="1" stopColor="#15957f" stopOpacity=".01"/></linearGradient></defs>
   {[.25,.5,.75,1].map(n=><line key={n} x1="0" x2={width} y1={y(n*total)} y2={y(n*total)} className="chart-grid"/>)}
   {index.milestones.filter(m=>m.kind==='join'||m.kind==='leave').map(m=><line key={m.id} x1={x(m.at-index.startAt)} x2={x(m.at-index.startAt)} y1="0" y2={height} className={`chart-marker ${m.at>state.at?'future':''}`} />)}
   {index.gaps.filter(g=>g.from<state.at).map((g,i)=><g key={`gap-${i}`}><rect x={x(g.from-index.startAt)} y="0" width={Math.max(1,x(Math.min(g.to,state.at)-index.startAt)-x(g.from-index.startAt))} height={height} fill="#ddba77" opacity=".2"/><title>Recording gap — no observations</title></g>)}
   {segments.map((series,i)=><g key={i}><path d={`${path(series)} L${x(series.at(-1)!.elapsed)},${height} L${x(series[0].elapsed)},${height} Z`} fill="url(#chart-fill)"/><path d={path(series)} fill="none" stroke="#14816e" strokeWidth="2.5" strokeLinejoin="round"/></g>)}
   {!state.gap&&<circle cx={x(state.elapsedMs)} cy={y(state.progress.fresh)} r="4" fill="#14816e" stroke="#f7f5ef" strokeWidth="2"/>}
  </svg>
  <div className="chart-axis"><span>00:00</span><span>{index.gaps.length?'Recorded time · shaded intervals = recording gaps':'Recorded experiment time'}</span><span>{formatTime(index.durationMs)}</span></div>
 </section>;
}
