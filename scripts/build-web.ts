import {build} from 'vite';
import {buildShowcase} from './build-showcase.ts';
await build();
await buildShowcase();
