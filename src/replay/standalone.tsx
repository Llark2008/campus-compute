import React from 'react';
import {createRoot} from 'react-dom/client';
import {Replay} from './Replay.tsx';
import type {ExperimentTrace} from '../shared/contracts.ts';
import type {ReplayTiming} from './model.ts';
const element=document.getElementById('root')!;
try{
 const data=JSON.parse(document.getElementById('recording-data')!.textContent!) as {trace:ExperimentTrace;timing:ReplayTiming};
 createRoot(element).render(<Replay trace={data.trace} timing={data.timing}/>);
}catch{
 element.textContent='This recording could not be opened. Please use a complete copy of the Campus Compute replay HTML file.';
}
