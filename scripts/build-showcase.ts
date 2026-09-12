import {build} from 'vite';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {ExperimentTrace} from '../src/shared/contracts.ts';
import type {ReplayTiming} from '../src/replay/model.ts';

export async function buildShowcase(){
 const trace=JSON.parse(await readFile('data/showcase/join-and-out.json','utf8')) as ExperimentTrace;
 const timing=JSON.parse(await readFile('data/showcase/join-and-out-timing.json','utf8')) as ReplayTiming;
 const built=await build({configFile:false,root:process.cwd(),logLevel:'warn',build:{write:false,minify:'esbuild',cssCodeSplit:false,rollupOptions:{input:resolve('src/replay/standalone.tsx'),output:{format:'iife',inlineDynamicImports:true}}}});
 if(!('output' in built))throw new Error('Expected one standalone showcase bundle.');
 const javascript=built.output.filter(o=>o.type==='chunk').map(o=>o.code).join('\n').replace(/<\/script/gi,'<\\/script');
 const css=built.output.flatMap(o=>o.type==='asset'&&o.fileName.endsWith('.css')?[o.source]:[]).join('\n').replace(/<\/style/gi,'<\\/style');
 const data=JSON.stringify({trace,timing}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const html=`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="description" content="A real Campus Compute experiment: watch laptops join, contribute, and leave while the work continues."><title>Campus Compute — Every laptop moves us forward</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%23187964'/%3E%3Cpath d='M13 21v5m7-14v16m7-11v8' stroke='white' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E"><style>${css}</style></head><body><div id="root"></div><noscript>This interactive replay requires JavaScript.</noscript><script type="application/json" id="recording-data">${data}</script><script>${javascript}</script></body></html>`;
 for(const path of ['output/showcase/campus-compute-replay.html','dist/web/showcase.html']){await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,html);}
 console.log(`Replay showcase built: ${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MB, ${trace.events.length} real events. Offline HTML: output/showcase/campus-compute-replay.html`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildShowcase();
