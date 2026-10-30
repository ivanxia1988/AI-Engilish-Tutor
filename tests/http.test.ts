import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, readJson, readLimitedBody } from "../lib/http.ts";
const request = (body:string, type="application/json") => new Request("https://example.test",{method:"POST",headers:{"Content-Type":type},body});
test("parses valid JSON and rejects invalid or mismatched content types",async()=>{
  assert.deepEqual(await readJson(request('{"age":7}')),{age:7});
  await assert.rejects(readJson(request("bad")),e=>e instanceof ApiError&&e.status===400);
  await assert.rejects(readJson(request("{}","text/plain")),e=>e instanceof ApiError&&e.status===415);
});
test("enforces streaming request limits without relying on content-length",async()=>{
  await assert.rejects(readLimitedBody(request("x".repeat(1024)),100),e=>e instanceof ApiError&&e.status===413);
  assert.equal((await readLimitedBody(request("abc"),3)).byteLength,3);
});
