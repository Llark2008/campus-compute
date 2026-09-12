import {afterEach, describe, expect, test, vi} from "vitest";
import {ApiError, createApi} from "../../src/web/api.ts";

afterEach(() => vi.unstubAllGlobals());

describe("createApi", () => {
  test("sends credentials only to the fixed platform API namespace", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ok:true}), {
      status: 200,
      headers: {"content-type":"application/json"},
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createApi("group secret").post("/api/experiments", {name:"trial"}))
      .resolves.toEqual({ok:true});
    expect(fetchMock).toHaveBeenCalledWith("/api/experiments", expect.objectContaining({
      method:"POST",
      headers: {authorization:"Bearer group secret", "content-type":"application/json"},
      body:JSON.stringify({name:"trial"}),
    }));

    await expect(createApi("group secret").get("https://example.test/api/experiments"))
      .rejects.toThrow("Only platform API paths are allowed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("preserves structured validation details from the server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error:{code:"VALIDATION",message:"Invalid JSON",line:17},
    }), {status:400,headers:{"content-type":"application/json"}})));

    const error = await createApi("group secret").post("/api/datasets", {}).catch(value => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({status:400,code:"VALIDATION",line:17,message:"Invalid JSON"});
  });

  test("turns an unreachable server into a readable connection error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(createApi("token").get("/api/local/status"))
      .rejects.toThrow("Unable to reach Campus Compute");
  });
});
