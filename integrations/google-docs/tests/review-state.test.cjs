const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function load(file, globals = {}) {
  const context = vm.createContext(globals);
  const name = path.join(__dirname, "..", file);
  if (fs.existsSync(name))
    vm.runInContext(fs.readFileSync(name, "utf8"), context);
  return context;
}
test("any chapter edit invalidates approval; correction requires explicit before/after", () => {
  const c = load("ReviewState.js");
  assert.equal(typeof c.decisionState, "function");
  assert.equal(c.decisionState("a", "a", false, "no_issue"), "ready");
  assert.equal(c.decisionState("a", "b", false, "no_issue"), "needs_refresh");
  assert.equal(
    c.decisionState("a", "b", false, "corrected"),
    "needs_before_after",
  );
  for (const disposition of ["no_issue", "corrected"])
    assert.equal(
      c.decisionState("a", "b", true, disposition),
      "resolve_suggestions",
    );
});
test("quote occurrence uses UTF-16 offsets and never guesses a duplicate", () => {
  const c = load("ReviewState.js");
  assert.equal(typeof c.quoteOffsets_, "function");
  assert.equal(
    JSON.stringify(c.quoteOffsets_("😀 echo echo", "echo", 1)),
    '{"start":8,"end":11}',
  );
  assert.throws(
    () => c.quoteOffsets_("echo echo", "echo", undefined),
    /occurrence/,
  );
  assert.throws(() => c.quoteOffsets_("echo echo", "echo", 2), /quote/);
});
test("credentials only go to the exact configured HTTPS deployment; expiry and 401 clear user token", () => {
  let user = 0;
  const stores = [{}, {}];
  const requests = [];
  let status = 200;
  const token =
    "e30." +
    Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 }),
    ).toString("base64url") +
    ".sig";
  const c = load("Api.js", {
    PropertiesService: {
      getUserProperties: () => ({
        getProperty: (k) => stores[user][k] || null,
        setProperty: (k, v) => (stores[user][k] = v),
        deleteProperty: (k) => delete stores[user][k],
      }),
    },
    Utilities: {
      base64DecodeWebSafe: (s) => Buffer.from(s, "base64url"),
      newBlob: (b) => ({ getDataAsString: () => b.toString() }),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        requests.push({ url, opts });
        return {
          getResponseCode: () => status,
          getContentText: () => JSON.stringify({ access_token: token }),
        };
      },
    },
  });
  assert.equal(typeof c.signIn, "function");
  assert.throws(() => c.apiRequest_("https://evil.test/path", "get"), /path/);
  c.signIn("reviewer", "secret");
  assert.equal(Object.values(stores[0]).includes("secret"), false);
  assert.equal(Object.keys(stores[0]).length, 1);
  assert.equal(requests[0].opts.followRedirects, false);
  assert.equal(
    requests[0].url,
    "https://translation-production-c3ad.up.railway.app/api/auth/login",
  );
  user = 1;
  assert.throws(
    () => c.apiRequest_("/api/docs-review/development-fixture", "get"),
    /Sign in/,
  );
  user = 0;
  status = 401;
  assert.throws(
    () => c.apiRequest_("/api/docs-review/development-fixture", "get"),
    /Sign in/,
  );
  assert.equal(Object.keys(stores[0]).length, 0);
  status = 200;
  c.signIn("reviewer", "secret");
  c.signOut();
  assert.equal(Object.keys(stores[0]).length, 0);
  stores[0]["bits.jwt"] =
    "e30." + Buffer.from('{"exp":1}').toString("base64url") + ".sig";
  assert.throws(
    () => c.apiRequest_("/api/docs-review/development-fixture", "get"),
    /Sign in/,
  );
  assert.equal(Object.keys(stores[0]).length, 0);
});
test("sidebar renders hostile concern as literal text and clears password immediately", () => {
  const name = path.join(__dirname, "..", "Sidebar.html");
  const html = fs.existsSync(name) ? fs.readFileSync(name, "utf8") : "";
  assert.ok(html.includes("<script>"));
  assert.equal(
    /innerHTML|insertAdjacentHTML|document\.write/.test(html),
    false,
  );
  const elements = new Map();
  function element() {
    return {
      textContent: "",
      value: "",
      children: [],
      appendChild(e) {
        this.children.push(e);
      },
      replaceChildren() {
        this.children = [];
      },
      addEventListener() {},
      setAttribute() {},
    };
  }
  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  let passwordDuringCall;
  const runner = new Proxy(
    {},
    {
      get: (_, key) =>
        key.startsWith("with")
          ? () => runner
          : (...args) => {
              if (key === "signIn")
                passwordDuringCall = document.getElementById("password").value;
            },
    },
  );
  const c = vm.createContext({
    document,
    window: { addEventListener() {} },
    google: { script: { run: runner } },
    console,
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], c);
  const malicious = "<img src=x onerror=alert(1)>";
  const target = element();
  c.appendText(target, "p", malicious);
  assert.equal(target.children[0].textContent, malicious);
  document.getElementById("password").value = "secret";
  c.login();
  assert.equal(passwordDuringCall, "");
});

test("HTTPS allowlist rejects changed origins and redirects without forwarding credentials", () => {
  let calls = 0;
  const c = load("Api.js", {
    UrlFetchApp: {
      fetch: () => {
        calls++;
        return { getResponseCode: () => 302 };
      },
    },
  });
  for (const base of [
    "http://translation-production-c3ad.up.railway.app",
    "https://evil.test",
    "https://translation-production-c3ad.up.railway.app@evil.test",
  ]) {
    c.BITS_BASE_URL = base;
    assert.throws(
      () =>
        c.apiRequest_("/api/auth/login", "post", { password: "secret" }, true),
      /HTTPS/,
    );
  }
  assert.equal(calls, 0);
  c.BITS_BASE_URL = "https://translation-production-c3ad.up.railway.app";
  assert.throws(
    () =>
      c.apiRequest_("/api/auth/login", "post", { password: "secret" }, true),
    /302/,
  );
  assert.equal(calls, 1);
});
