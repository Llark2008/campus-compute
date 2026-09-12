import {expect,test} from 'vitest';
import {comparisonRecord,comparisonCsv,csvCell,formatElapsed} from '../../src/web/report-export.ts';
import {fixture,testRegistration,submission} from '../fixtures/core.ts';
import {isReport} from '../../src/web/view-model.ts';
import type {Report} from '../../src/shared/contracts.ts';

test('elapsed display preserves seconds and handles older missing fields',()=>{
 expect(formatElapsed(62345)).toBe('1m 02.3s');expect(formatElapsed(3600000)).toBe('1h 00m 00.0s');
 expect(formatElapsed(0)).toBe('0.0s');for(const value of [undefined,null,-1,NaN])expect(formatElapsed(value)).toBe('—');
});
test('CSV exports comparable timings, workload identity and current contributors',()=>{
 const f=fixture();try{
  const w=f.store.register(testRegistration),e=f.store.create({...f.input,name:'Run, "one"\ncontinued'});
  f.advance(2000);const l=f.store.claim(w.workerId)!;f.advance(1500);f.store.accept(w.workerId,submission(l));
  const report=f.store.report(e.experimentId),row=comparisonRecord(report);
  expect(row).toMatchObject({question_count:1,prompt_count:1,contributing_devices:1,total_elapsed_seconds:3.5,execution_elapsed_seconds:1.5,fresh_results:1,cached_results:0,workload_fingerprint:report.snapshot.workloadFingerprint});
  expect(comparisonCsv(report)).toContain('"Run, ""one""\ncontinued"');
  expect(comparisonCsv(report)).toContain('"total_elapsed_seconds"');
 }finally{f.store.close();}
});
test('CSV neutralizes spreadsheet formulas and preserves numeric types',()=>{
 for(const text of ['=SUM(1,2)','+cmd','-danger','@SUM(A1)',' \t=cmd','\r=cmd'])expect(csvCell(text)).toBe('"\''+text.replaceAll('"','""')+'"');
 expect(csvCell(12.3)).toBe('"12.3"');expect(csvCell(null)).toBe('""');
});
test('accepted legacy report without timing or metadata exports blanks without inventing time',()=>{
 const report={snapshot:{experimentId:'old',name:'Archive'},samples:[],variants:[],rows:[]} as unknown as Report;
 expect(isReport(report)).toBe(true);expect(()=>comparisonCsv(report)).not.toThrow();
 expect(comparisonRecord(report)).toMatchObject({total_elapsed_seconds:null,execution_elapsed_seconds:null,model:null,workload_fingerprint:null});
});
