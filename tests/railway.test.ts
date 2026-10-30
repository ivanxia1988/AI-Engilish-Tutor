import test from "node:test";
import assert from "node:assert/strict";
import { railwayArguments } from "../scripts/start-railway.mjs";
import { getChatGPTUser } from "../app/chatgpt-auth";

test("Railway listens on the assigned public port and restores the HTTPS origin", () => {
  const args = railwayArguments({ PORT: "3456", RAILWAY_PUBLIC_DOMAIN: "tutor.up.railway.app" });
  assert.equal(args[args.indexOf("--ip") + 1], "0.0.0.0");
  assert.equal(args[args.indexOf("--port") + 1], "3456");
  assert.equal(args[args.indexOf("--local-upstream") + 1], "tutor.up.railway.app");
  assert.equal(args[args.indexOf("--upstream-protocol") + 1], "https");
});

test("Railway uses a default port and rejects invalid port settings", () => {
  assert.equal(railwayArguments({})[railwayArguments({}).indexOf("--port") + 1], "8080");
  for (const PORT of ["0", "65536", "3000abc", "-1"]) {
    assert.throws(() => railwayArguments({ PORT }), /PORT/);
  }
});

test("Railway does not accept unverified Sites identity headers", async () => {
  const previous = process.env.LITTLELEAF_HOSTING;
  process.env.LITTLELEAF_HOSTING = "railway";
  try {
    assert.equal(await getChatGPTUser(), null);
  } finally {
    if (previous === undefined) delete process.env.LITTLELEAF_HOSTING;
    else process.env.LITTLELEAF_HOSTING = previous;
  }
});
