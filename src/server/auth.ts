import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
export const token=()=>randomBytes(32).toString('base64url');
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const tokenMatches=(value:string,hash:string)=>timingSafeEqual(Buffer.from(digest(value),'hex'),Buffer.from(hash,'hex'));
