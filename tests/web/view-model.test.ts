import {describe, expect, test} from "vitest";
import type {DatasetMeta, Report} from "../../src/shared/contracts.ts";
import {LatestRequest, exitIsDisabled, isReport, percentage, rowsForSample, sampleIdsForRun} from "../../src/web/view-model.ts";

const dataset:DatasetMeta = {
  id:"arc",name:"ARC",sha256:"hash",source:"source",revision:"rev",license:"license",
  sampleIds:Array.from({length:25}, (_,index) => `q${index + 1}`),
};

describe("web view models", () => {
  test("uses the server-pinned sample order for full and twenty-question runs", () => {
    expect(sampleIdsForRun(dataset, 25)).toEqual(dataset.sampleIds);
    expect(sampleIdsForRun(dataset, 20)).toEqual(dataset.sampleIds.slice(0,20));
  });

  test("does not invent a percentage when the common denominator is empty", () => {
    expect(percentage(0,0)).toBe("—");
    expect(percentage(2,3)).toBe("66.7%");
  });

  test("associates raw answers by sample and variant IDs rather than array position", () => {
    const report = {
      samples:[{id:"q2"},{id:"q1"}],
      variants:[{id:"B"},{id:"A"}],
      rows:[
        {sampleId:"q1",variantId:"A",taskId:"t-a"},
        {sampleId:"q2",variantId:"B",taskId:"t-b"},
        {sampleId:"q1",variantId:"B",taskId:"t-c"},
      ],
    } as unknown as Report;
    expect(rowsForSample(report,"q1").map(row => row.taskId)).toEqual(["t-c","t-a"]);
  });

  test("rejects unrelated JSON when importing a prior report", () => {
    expect(isReport({snapshot:{experimentId:"e1",name:"Archived"},samples:[],variants:[],rows:[]})).toBe(true);
    expect(isReport({snapshot:{experimentId:"e1",name:"Archived"},samples:[null],variants:[],rows:[]})).toBe(false);
    expect(isReport({snapshot:{experimentId:"e1",name:"Archived"},samples:[],variants:[]})).toBe(false);
    expect(isReport(null)).toBe(false);
  });

  test("rejects report fields that would crash or mislabel the raw answer renderer", () => {
    const base = {
      snapshot:{experimentId:"e1",name:"Archived"},samples:[],variants:[],
      rows:[{taskId:"t1",sampleId:"q1",variantId:"A",state:"completed",source:"computed",backend:"cpu",output:null,score:null,error:null}],
    };
    expect(isReport(base)).toBe(true);
    expect(isReport({...base,rows:[{...base.rows[0],backend:123}]})).toBe(false);
    expect(isReport({...base,rows:[{...base.rows[0],source:"remote"}]})).toBe(false);
    expect(isReport({...base,rows:[{...base.rows[0],error:{message:"bad"}}]})).toBe(false);
  });

  test("invalidates stale async work when input or navigation advances", () => {
    const requests = new LatestRequest();
    const experimentA = requests.begin();
    expect(experimentA.isCurrent()).toBe(true);
    requests.invalidate();
    expect(experimentA.isCurrent()).toBe(false);
    const experimentB = requests.begin();
    expect(experimentB.isCurrent()).toBe(true);
    expect(experimentA.isCurrent()).toBe(false);
  });

  test("keeps Exit available for a stopped snapshot while Start is still pending", () => {
    expect(exitIsDisabled("stopped",new Set())).toBe(true);
    expect(exitIsDisabled("stopped",new Set(["start"]))).toBe(false);
    expect(exitIsDisabled("initializing",new Set())).toBe(false);
    expect(exitIsDisabled("computing",new Set(["exit"]))).toBe(true);
  });
});


test("question count supports the expanded pinned list and rejects invalid counts",()=>{
 const large={...dataset,sampleIds:Array.from({length:1172},(_,i)=>`test-${i}`)};
 for(const n of [20,200,500,1000,1172])expect(sampleIdsForRun(large,n)).toEqual(large.sampleIds.slice(0,n));
 for(const n of [0,-1,1.5,1173,NaN,Infinity])expect(sampleIdsForRun(large,n)).toEqual([]);
});
