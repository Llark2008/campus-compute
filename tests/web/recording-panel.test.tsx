import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {RecordingPanel} from '../../src/web/RecordingPanel.tsx';
import {createApi} from '../../src/web/api.ts';
const api=createApi('test-only');
const base={available:true,startedAt:1000,endedAt:null,eventCount:12,frameCount:3,hasGaps:false};
test('new recording explains automatic capture and exposes a separate replay download',()=>{
 const html=renderToStaticMarkup(<RecordingPanel api={api} id="test" status={base}/>);
 expect(html).toContain('Recording automatically');expect(html).toContain('Export replay JSON');expect(html).toContain('12 events');expect(html).toContain('3 frames');
});
test('legacy reports never imply a retrospective recording exists',()=>{
 const html=renderToStaticMarkup(<RecordingPanel api={api} id="legacy"/>);
 expect(html).toContain('No process recording');expect(html).not.toContain('Export replay JSON');
});
test('completed recordings display gaps explicitly',()=>{
 const html=renderToStaticMarkup(<RecordingPanel api={api} id="test" status={{...base,endedAt:10000,hasGaps:true}}/>);
 expect(html).toContain('Recording complete');expect(html).toContain('observation gap');
});
