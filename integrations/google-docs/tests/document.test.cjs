const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function load(globals = {}) {
  const c = vm.createContext(globals);
  for (const file of ["ReviewState.js", "Document.js", "Code.js"]) {
    const p = path.join(__dirname, "..", file);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, "utf8"), c);
  }
  return c;
}
function response(text = "hello\n") {
  return {
    revisionId: "r1",
    tabs: [
      {
        tabProperties: { tabId: "tab" },
        documentTab: {
          body: {
            content: [
              { sectionBreak: {} },
              { paragraph: { elements: [{ textRun: { content: text } }] } },
            ],
          },
        },
      },
    ],
  };
}
test("Docs API must use selected tab and reject pending insert/delete/style suggestions", () => {
  const c = load();
  assert.equal(typeof c.apiTabSnapshot_, "function");
  assert.equal(c.apiTabSnapshot_(response(), "tab").text, "hello");
  for (const field of [
    "suggestedInsertionIds",
    "suggestedDeletionIds",
    "suggestedTextStyleChanges",
  ]) {
    const r = response();
    r.tabs[0].documentTab.body.content[1].paragraph.elements[0].textRun[field] =
      ["s"];
    assert.throws(() => c.apiTabSnapshot_(r, "tab"), /Resolve.*suggestions/);
  }
  assert.throws(() => c.apiTabSnapshot_(response(), "other"), /tab/);
  const r = response();
  r.tabs[0].documentTab.body.content.push({ table: {} });
  assert.throws(() => c.apiTabSnapshot_(r, "tab"), /Unsupported/);
  const foot = response();
  foot.tabs[0].documentTab.footnotes = { foot: { content: [] } };
  assert.throws(() => c.apiTabSnapshot_(foot, "tab"), /Unsupported/);
});
test("deleted, duplicated, moved, split and merged paragraph anchors cannot be guessed", () => {
  const c = load();
  assert.equal(typeof c.validateAnchorShape_, "function");
  const good = {
    id: "r",
    name: "bits-review:p:b",
    parts: [{ index: 2, wholeParagraph: true }],
  };
  assert.equal(
    c.validateAnchorShape_(good, [good], {
      id: "r",
      name: good.name,
      index: 2,
    }),
    true,
  );
  assert.throws(
    () => c.validateAnchorShape_(null, [], { id: "r" }),
    /reassociate/i,
  );
  assert.throws(
    () =>
      c.validateAnchorShape_(good, [good, good], {
        id: "r",
        name: good.name,
        index: 2,
      }),
    /reassociate/i,
  );
  for (const parts of [
    [
      { index: 2, wholeParagraph: true },
      { index: 3, wholeParagraph: true },
    ],
    [{ index: 1, wholeParagraph: true }],
    [{ index: 2, wholeParagraph: false }],
  ])
    assert.throws(
      () =>
        c.validateAnchorShape_({ ...good, parts }, [good], {
          id: "r",
          name: good.name,
          index: 2,
        }),
      /reassociate/i,
    );
});
test("checkpoint refuses wrong active tab, API read failure and concurrent text mismatch", () => {
  let active = "tab",
    fail = false,
    apiText = "hello\n";
  let options;
  const child = {
    getType: () => "PARAGRAPH",
    getText: () => "hello",
    getNumChildren: () => 1,
    getChild: () => ({ getType: () => "TEXT" }),
    getHeading: () => "NORMAL",
  };
  const body = { getNumChildren: () => 1, getChild: () => child };
  const doc = {
    getId: () => "doc",
    getActiveTab: () => ({ getId: () => active }),
    getTab: () => ({ asDocumentTab: () => ({ getBody: () => body }) }),
  };
  const c = load({
    DocumentApp: { getActiveDocument: () => doc },
    Docs: {
      Documents: {
        get: (id, o) => {
          options = o;
          if (fail) throw Error("remote");
          return response(apiText);
        },
      },
    },
  });
  assert.equal(typeof c.readCheckpoint_, "function");
  const binding = { documentId: "doc", tabId: "tab" };
  assert.equal(c.readCheckpoint_(binding).text, "hello");
  assert.equal(options.includeTabsContent, true);
  assert.equal(options.suggestionsViewMode, "SUGGESTIONS_INLINE");
  active = "other";
  assert.throws(() => c.readCheckpoint_(binding), /selected tab/);
  active = "tab";
  fail = true;
  assert.throws(() => c.readCheckpoint_(binding), /suggestions.*unavailable/);
  fail = false;
  apiText = "changed\n";
  assert.throws(() => c.readCheckpoint_(binding), /changed.*Refresh/i);
});
test("explicit chapter load is the only manuscript write and refuses nonempty tabs", () => {
  let writes = 0;
  const c = load();
  assert.equal(typeof c.loadEmptyTab_, "function");
  const body = {
    getText: () => "existing",
    setText: () => writes++,
    getNumChildren: () => 1,
    getChild: () => ({
      getType: () => "PARAGRAPH",
      getNumChildren: () => 0,
      getText: () => "",
      getHeading: () => "NORMAL",
    }),
  };
  assert.throws(() => c.loadEmptyTab_(body, "chapter"), /empty/);
  assert.equal(writes, 0);
  body.getText = () => "";
  c.loadEmptyTab_(body, "chapter");
  assert.equal(writes, 1);
});

test("decision preview captures both checkpoints; later typing cannot be certified or silently corrected", () => {
  const saved = {};
  const posts = [];
  const base = {
    id: "base",
    target_sha256: "old",
    canonical_text: "old chapter",
    blocks: [{ block_id: "b", text: "old chapter", kind: "paragraph" }],
  };
  const run = { id: "run", items: [{ id: "item", kind: "finding" }] };
  let current = "new chapter";
  const binding = {
    documentId: "doc",
    tabId: "tab",
    projectId: "project",
    baseId: "base",
    runId: "run",
  };
  const c = load({
    PropertiesService: {
      getUserProperties: () => ({
        getProperty: (k) => saved[k] || null,
        setProperty: (k, v) => (saved[k] = v),
        deleteProperty: (k) => delete saved[k],
      }),
    },
    Utilities: {
      getUuid: () => "nonce",
      newBlob: (value) => ({
        getBytes: () => Array.from(Buffer.from(value, "utf8")),
      }),
    },
  });
  assert.equal(typeof c.prepareDecision, "function");
  c.binding_ = () => binding;
  c.boundDocument_ = () => ({ tab: {} });
  c.verifyBlockAnchors_ = () => {};
  c.readCheckpoint_ = () => ({
    text: current,
    blocks: [{ text: current, kind: "paragraph" }],
    revisionId: "r",
  });
  c.apiRequest_ = (path, method, payload) => {
    if (path.endsWith("/snapshots/base")) return base;
    if (path.endsWith("/runs/run")) return run;
    if (path.endsWith("/snapshots") && method === "post") {
      posts.push(payload);
      return { id: "after", canonical_text: current, target_sha256: "new" };
    }
    if (path.endsWith("/snapshots/after"))
      return {
        id: "after",
        canonical_text: "new chapter",
        target_sha256: "new",
      };
    if (path.endsWith("/decisions")) {
      posts.push(payload);
      return { id: "decision", ...payload };
    }
  };
  assert.throws(
    () => c.prepareDecision("item", "no_issue", ""),
    /changed|refresh/i,
  );
  assert.equal(posts.length, 1); // A fresh checkpoint, never a decision.
  const preview = c.prepareDecision("item", "corrected", "Reviewed manually");
  assert.equal(preview.before, "old chapter");
  assert.equal(preview.after, "new chapter");
  assert.equal(preview.baseId, "base");
  assert.equal(preview.reviewedId, "after");
  current = "typed later";
  assert.throws(() => c.recordDecision(preview.nonce), /changed|preview/i);
  assert.equal(posts.filter((p) => p.disposition).length, 0);
  current = "new chapter";
  const decision = c.recordDecision(preview.nonce);
  assert.equal(decision.base_snapshot_id, "base");
  assert.equal(decision.reviewed_snapshot_id, "after");
  assert.equal(decision.disposition, "corrected");
  assert.equal(decision.note, "Reviewed manually");
  assert.throws(() => c.recordDecision("wrong"), /preview/i);
});

test("focus refuses stale whole-chapter evidence before attempting selection", () => {
  const c = load();
  assert.equal(typeof c.focusItem, "function");
  let selections = 0;
  c.binding_ = () => ({ projectId: "p", baseId: "b", runId: "r" });
  c.apiRequest_ = (p) =>
    p.endsWith("/snapshots/b")
      ? { canonical_text: "base" }
      : { items: [{ id: "i" }] };
  c.readCheckpoint_ = () => ({ text: "edited elsewhere" });
  c.selectItem_ = () => selections++;
  assert.throws(() => c.focusItem("i"), /changed|refresh/i);
  assert.equal(selections, 0);
});

test("selection uses the stored unique range and exact duplicate occurrence without manuscript writes", () => {
  const selections = [];
  const paragraph = { getType: () => "PARAGRAPH" };
  const text = {
    getType: () => "TEXT",
    getParent: () => paragraph,
    getText: () => "😀 echo echo",
  };
  const body = {
    getNumChildren: () => 1,
    getChildIndex: (p) => (p === paragraph ? 0 : -1),
  };
  const blockRange = {
    getRangeElements: () => [
      { getElement: () => paragraph, isPartial: () => false },
    ],
  };
  let start = 8,
    end = 11;
  const itemRange = {
    getRangeElements: () => [
      {
        getElement: () => text,
        isPartial: () => true,
        getStartOffset: () => start,
        getEndOffsetInclusive: () => end,
      },
    ],
  };
  const block = {
    getId: () => "block-range",
    getName: () => "bits-review:p:b",
    getRange: () => blockRange,
  };
  const item = {
    getId: () => "item-range",
    getName: () => "bits-review:r:i",
    getRange: () => itemRange,
  };
  let duplicate = false,
    deleted = false;
  const tab = {
    getBody: () => body,
    getNamedRangeById: (id) =>
      id === "block-range" ? block : deleted ? null : item,
    getNamedRanges: (name) =>
      name === "bits-review:p:b" ? [block] : duplicate ? [item, item] : [item],
  };
  const doc = {
    getId: () => "doc",
    getActiveTab: () => ({ getId: () => "tab" }),
    getTab: () => ({ asDocumentTab: () => tab }),
    setActiveTab: (id) => selections.push(id),
    setSelection: (range) => selections.push(range),
  };
  const c = load({ DocumentApp: { getActiveDocument: () => doc } });
  const binding = {
    documentId: "doc",
    tabId: "tab",
    projectId: "p",
    runId: "r",
    blockAnchors: ["block-range"],
    itemAnchors: { i: "item-range" },
  };
  const base = { blocks: [{ block_id: "b", text: "😀 echo echo" }] };
  const finding = {
    id: "i",
    target_spans: [{ block_id: "b", quote: "echo", occurrence: 1 }],
  };
  c.selectItem_(binding, base, finding);
  assert.equal(selections[0], "tab");
  assert.equal(selections[1], itemRange);
  start = 3;
  end = 6;
  assert.throws(() => c.selectItem_(binding, base, finding), /occurrence/);
  start = 8;
  end = 11;
  duplicate = true;
  assert.throws(() => c.selectItem_(binding, base, finding), /duplicated/);
  duplicate = false;
  deleted = true;
  assert.throws(() => c.selectItem_(binding, base, finding), /missing/);
  assert.equal(selections.length, 2);
});

test("chapter-loading rejects whitespace-only content and empty embedded structures", () => {
  const c = load();
  let writes = 0;
  const body = {
    getText: () => " ",
    getNumChildren: () => 1,
    setText: () => writes++,
    getChild: () => ({
      getType: () => "PARAGRAPH",
      getText: () => "",
      getNumChildren: () => 1,
      getChild: () => ({ getType: () => "INLINE_IMAGE" }),
    }),
  };
  assert.throws(() => c.loadEmptyTab_(body, "chapter"), /empty/);
  body.getText = () => "";
  assert.throws(() => c.loadEmptyTab_(body, "chapter"), /Unsupported/);
  assert.equal(writes, 0);
});

test("whole-Text named ranges select full-block quotes with sentinel offsets", () => {
  const c = load();
  const selections = [];
  const paragraph = {};
  let textValue = "😀 complete passage";
  let paragraphIndex = 0;
  let rangeId = "whole-range";
  const element = {
    getType: () => "TEXT",
    getParent: () => paragraph,
    getText: () => textValue,
  };
  const range = {
    getRangeElements: () => [
      {
        getElement: () => element,
        isPartial: () => false,
        getStartOffset: () => -1,
        getEndOffsetInclusive: () => -1,
      },
    ],
  };
  const named = {
    getId: () => rangeId,
    getName: () => "bits-review:run:item",
    getRange: () => range,
  };
  c.boundDocument_ = () => ({
    doc: {
      setActiveTab: (id) => selections.push(id),
      setSelection: (value) => selections.push(value),
    },
    tab: {
      getNamedRangeById: (id) => (id === "whole-range" ? named : null),
      getNamedRanges: () => [named],
      getBody: () => ({ getChildIndex: () => paragraphIndex }),
    },
  });
  c.verifyBlockAnchors_ = () => {};
  const binding = {
    tabId: "tab",
    runId: "run",
    itemAnchors: { item: "whole-range" },
  };
  const base = { blocks: [{ block_id: "block", text: "😀 complete passage" }] };
  const item = {
    id: "item",
    target_spans: [
      { block_id: "block", quote: "😀 complete passage", occurrence: 0 },
    ],
  };
  c.selectItem_(binding, base, item);
  assert.deepEqual(selections, ["tab", range]);
  textValue = "changed";
  assert.throws(() => c.selectItem_(binding, base, item), /quote|passage/);
  textValue = "😀 complete passage";
  paragraphIndex = 1;
  assert.throws(() => c.selectItem_(binding, base, item), /quote|passage/);
  paragraphIndex = 0;
  item.target_spans[0].occurrence = 1;
  assert.throws(() => c.selectItem_(binding, base, item), /quote|occurrence/);
  item.target_spans[0].occurrence = 0;
  rangeId = "other-range";
  assert.throws(() => c.selectItem_(binding, base, item), /anchor/);
  assert.equal(selections.length, 2);
});

test("oversize serialized notes are rejected before creating any checkpoint", () => {
  const properties = {};
  const posts = [];
  let documentReads = 0;
  const c = load({
    PropertiesService: {
      getUserProperties: () => ({
        deleteProperty: (key) => delete properties[key],
        setProperty: (key, value) => {
          if (Buffer.byteLength(value, "utf8") > 9216)
            throw new Error("Google property quota exceeded");
          properties[key] = value;
        },
      }),
    },
    Utilities: {
      getUuid: () => "00000000-0000-0000-0000-000000000000",
      newBlob: (value) => ({
        getBytes: () => Array.from(Buffer.from(value, "utf8")),
      }),
    },
  });
  c.binding_ = () => ({ projectId: "project", baseId: "base", runId: "run" });
  c.baseSnapshot_ = () => ({
    id: "base",
    canonical_text: "old",
    target_sha256: "old",
    blocks: [{ block_id: "block" }],
  });
  c.reviewRun_ = () => ({ items: [{ id: "item", kind: "finding" }] });
  c.boundDocument_ = () => ({ tab: {} });
  c.verifyBlockAnchors_ = () => {};
  c.readCheckpoint_ = () => {
    documentReads++;
    return {
      text: "new",
      revisionId: "r",
      blocks: [{ text: "new", kind: "paragraph" }],
    };
  };
  c.apiRequest_ = (path, method, payload) => {
    posts.push({ path, method, payload });
    return {
      id: "00000000-0000-0000-0000-000000000000",
      canonical_text: "new",
      target_sha256: "new",
    };
  };
  // Each is within the advertised 5,000-character bound, but cannot fit as JSON UTF-8.
  for (const note of ["佛".repeat(3100), '"'.repeat(5000), "😀".repeat(2500)]) {
    assert.throws(
      () => c.prepareDecision("item", "corrected", note),
      /note.*too large.*[Ss]horten/,
    );
    assert.equal(posts.length, 0);
    assert.equal(documentReads, 0);
    assert.equal(properties["bits.pending"], undefined);
  }
  const accepted = "a".repeat(5000);
  c.prepareDecision("item", "corrected", accepted);
  assert.equal(posts.length, 1);
  assert.equal(JSON.parse(properties["bits.pending"]).note, accepted);
  assert.ok(Buffer.byteLength(properties["bits.pending"], "utf8") <= 9000);
});

function sidebar(globals = {}) {
  const elements = new Map();
  function element(tagName) {
    return {
      tagName,
      dataset: {},
      handlers: {},
      set innerHTML(_value) {
        throw new Error("Unsafe HTML rendering");
      },
      textContent: "",
      value: "",
      children: [],
      addEventListener(name, handler) {
        this.handlers[name] = handler;
      },
      appendChild(n) {
        this.children.push(n);
      },
      replaceChildren() {
        this.children = [];
      },
    };
  }
  const listeners = {};
  const document = {
    hidden: false,
    createElement: element,
    querySelectorAll: () => [],
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    addEventListener: (name, fn) => (listeners[name] = fn),
  };
  const window = { addEventListener: (name, fn) => (listeners[name] = fn) };
  const c = vm.createContext({ document, window, ...globals });
  const html = fs.readFileSync(
    path.join(__dirname, "..", "Sidebar.html"),
    "utf8",
  );
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], c);
  return { c, document, listeners };
}

test("open-sidebar polling backs off, ignores late callbacks and stops on terminal or queue retry state", () => {
  const timers = new Map();
  const delays = [];
  let next = 0;
  const globals = {
    setTimeout: (fn, delay) => {
      delays.push(delay);
      timers.set(++next, fn);
      return next;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const { c } = sidebar(globals);
  assert.equal(typeof c.createReviewPoller, "function");
  const calls = [],
    seen = [],
    errors = [];
  const poll = c.createReviewPoller(
    (ok, fail) => calls.push({ ok, fail }),
    (value) => seen.push(value.status),
    (e) => errors.push(e),
  );
  function tick() {
    const [id, fn] = timers.entries().next().value;
    timers.delete(id);
    fn();
  }
  poll.start("queued");
  for (let i = 0; i < 10; i++) {
    tick();
    calls.at(-1).ok({ status: "running" });
  }
  assert.ok(delays[1] > delays[0]);
  assert.ok(Math.max(...delays) <= 15000);
  tick();
  calls.at(-1).ok({ status: "succeeded" });
  assert.equal(timers.size, 0);
  for (const terminal of [
    "failed",
    "interrupted",
    "pending_enqueue",
    "completed",
  ]) {
    poll.start("queued");
    tick();
    calls.at(-1).ok({ status: terminal });
    assert.equal(timers.size, 0);
  }
  poll.start("running");
  tick();
  const pending = calls.at(-1);
  poll.stop();
  const before = seen.length;
  pending.ok({ status: "succeeded" });
  assert.equal(seen.length, before);
  assert.equal(timers.size, 0);
  poll.start("running");
  tick();
  calls.at(-1).fail(Error("offline"));
  assert.equal(errors.length, 1);
  assert.equal(timers.size, 0);
});

test("closing or hiding sidebar cancels polling and prevents an in-flight response from rendering", () => {
  const timers = new Map();
  let next = 0,
    ok;
  const runner = {
    withSuccessHandler(fn) {
      ok = fn;
      return this;
    },
    withFailureHandler() {
      return this;
    },
    pollReview() {},
  };
  const { c, document, listeners } = sidebar({
    google: { script: { run: runner } },
    setTimeout: (fn) => {
      timers.set(++next, fn);
      return next;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  c.renderReview({
    status: "queued",
    baseId: "b",
    message: "Queued",
    items: [],
  });
  assert.equal(timers.size, 1);
  const [id, fn] = timers.entries().next().value;
  timers.delete(id);
  fn();
  listeners.pagehide();
  ok({ status: "succeeded", baseId: "b", message: "Late result", items: [] });
  assert.equal(document.getElementById("status").textContent, "Queued");
  assert.equal(timers.size, 0);
  c.renderReview({
    status: "queued",
    baseId: "b",
    message: "Queued",
    items: [],
  });
  document.hidden = true;
  listeners.visibilitychange();
  assert.equal(timers.size, 0);
});

test("live presentation marks earlier versions and retryable queue states without modifying document or binding", () => {
  const crypto = require("node:crypto");
  const c = load({
    PropertiesService: { getUserProperties: () => ({ deleteProperty() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_a, value) => [
        ...crypto.createHash("sha256").update(value).digest(),
      ],
    },
  });
  const hash = (value) =>
    crypto.createHash("sha256").update(value).digest("hex");
  const binding = {
    projectId: "p",
    baseId: "base",
    runId: "run",
    itemAnchors: {},
  };
  let anchorWrites = 0,
    bindingWrites = 0;
  c.binding_ = () => binding;
  c.baseSnapshot_ = () => ({
    id: "base",
    target_sha256: hash("old"),
    canonical_text: "old",
    blocks: [],
  });
  c.readCheckpoint_ = () => ({ text: "newer manuscript" });
  c.verifyBlockAnchors_ = () => {};
  c.boundDocument_ = () => ({ tab: {} });
  c.createItemAnchors_ = () => {
    anchorWrites++;
    return {};
  };
  c.saveBinding_ = () => bindingWrites++;
  let run = {
    mode: "live",
    status: "succeeded",
    items: [],
    finding_count: 0,
    audit_count: 0,
  };
  c.reviewRun_ = () => run;
  assert.equal(typeof c.pollReview, "function");
  const result = c.pollReview();
  assert.match(result.message, /Review of an earlier version/);
  assert.equal(result.changed, true);
  assert.equal(result.status, "succeeded");
  run = {
    ...run,
    status: "pending_enqueue",
    queue_retryable: true,
    error_code: "queue_unavailable",
  };
  const retry = c.pollReview();
  assert.equal(retry.queueRetryable, true);
  assert.match(retry.message, /retry/i);
  assert.equal(anchorWrites, 0);
  assert.equal(bindingWrites, 0);
});

test("live submission retries the frozen request after uncertain network delivery", () => {
  const c = load();
  const saved = [];
  const binding = {
    projectId: "p",
    baseId: "snapshot",
    pendingRunRequest: {
      client_request_id: "stable-request",
      snapshot_id: "snapshot",
      mode: "live",
      model: "anthropic/test",
    },
  };
  c.binding_ = () => binding;
  c.saveBinding_ = (value) => saved.push(JSON.parse(JSON.stringify(value)));
  const requests = [];
  c.apiRequest_ = (_path, _method, body) => {
    requests.push(JSON.parse(JSON.stringify(body)));
    if (requests.length === 1) throw Error("unknown network delivery");
    return { id: "run" };
  };
  c.refreshReview = () => ({ status: "queued" });
  assert.equal(typeof c.startLiveReview, "function");
  assert.throws(() => c.startLiveReview({}), /network/);
  assert.equal(c.startLiveReview({}).status, "queued");
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(binding.runId, "run");
  assert.equal(binding.baseId, "snapshot");
  assert.equal(binding.pendingRunRequest, undefined);
});

test("completed live review metadata cannot overwrite a newer checkpoint binding", () => {
  const c = load();
  const old = {
    projectId: "p",
    baseId: "base",
    runId: "old-run",
    itemAnchors: {},
  };
  const fresh = { ...old, baseId: "new-base", runId: "new-run" };
  let saves = 0;
  c.checkpointHash_ = () => "hash";
  c.binding_ = () => fresh;
  c.saveBinding_ = () => saves++;
  c.verifyBlockAnchors_ = () => {};
  c.boundDocument_ = () => ({ tab: {} });
  c.createItemAnchors_ = () => ({ item: "range" });
  assert.throws(
    () =>
      c.liveReviewPresentation_(
        old,
        { id: "base", target_sha256: "hash" },
        { status: "succeeded", items: [{ id: "item" }] },
        { text: "current" },
      ),
    /newer review/i,
  );
  assert.equal(saves, 0);
  assert.equal(fresh.baseId, "new-base");
});

test("pending live request refuses oversized guidance before creating a new checkpoint", () => {
  const c = load({
    Utilities: {
      newBlob: (value) => ({ getBytes: () => [...Buffer.from(value)] }),
    },
  });
  let reads = 0;
  c.binding_ = () => ({ projectId: "p" });
  c.readCheckpoint_ = () => {
    reads++;
    throw Error("checkpoint read happened");
  };
  assert.throws(
    () =>
      c.startLiveReview({
        model: "anthropic/test",
        limits: {},
        guidance: [{ id: "g", content: "😀".repeat(3000) }],
      }),
    /guidance.*large|shorten/i,
  );
  assert.equal(reads, 0);
});

test("zero live limits create no checkpoint and corrected limits can start", () => {
  const c = load({
    Utilities: {
      newBlob: (value) => ({ getBytes: () => [...Buffer.from(value)] }),
      getUuid: () => "request-id",
    },
  });
  const binding = { projectId: "p" };
  let reads = 0;
  const posts = [];
  c.binding_ = () => binding;
  c.readCheckpoint_ = () => {
    reads++;
    return { revisionId: "r", blocks: [{ text: "text", kind: "paragraph" }] };
  };
  c.createBlockAnchors_ = () => ["anchor"];
  c.saveBinding_ = () => {};
  c.refreshReview = () => ({ status: "queued" });
  c.apiRequest_ = (path, method, payload) => {
    posts.push({ path, payload: JSON.parse(JSON.stringify(payload)) });
    return { id: path.endsWith("/snapshots") ? "snapshot" : "run" };
  };
  const options = {
    model: "anthropic/test",
    limits: { max_input_tokens: 0, max_output_tokens: 2000, max_cost_usd: 0.1 },
  };
  assert.throws(() => c.startLiveReview(options), /limits|positive|tokens/i);
  assert.equal(reads, 0);
  assert.equal(posts.length, 0);
  assert.equal(binding.pendingRunRequest, undefined);
  options.limits.max_input_tokens = 20000;
  assert.equal(c.startLiveReview(options).status, "queued");
  assert.equal(posts.length, 2);
  assert.equal(posts[1].payload.limits.max_input_tokens, 20000);
});

test("definitive 422 rejects and releases a frozen submission so corrected options are used", () => {
  let reject = true;
  const sent = [];
  const c = load({
    Utilities: {
      newBlob: (value) => ({ getBytes: () => [...Buffer.from(value)] }),
      getUuid: () => "new-request",
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        const body = options.payload ? JSON.parse(options.payload) : undefined;
        sent.push({ url, body });
        return {
          getResponseCode: () => (reject ? 422 : 201),
          getContentText: () =>
            JSON.stringify({
              id: url.endsWith("/snapshots") ? "new-snapshot" : "new-run",
            }),
        };
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "Api.js"), "utf8"),
    c,
  );
  c.userToken_ = () => "fake-token";
  const binding = {
    projectId: "p",
    baseId: "old-snapshot",
    pendingRunRequest: {
      client_request_id: "rejected",
      snapshot_id: "old-snapshot",
      mode: "live",
      model: "anthropic/test",
      limits: {
        max_input_tokens: 0,
        max_output_tokens: 2000,
        max_cost_usd: 0.1,
      },
    },
  };
  c.binding_ = () => binding;
  c.saveBinding_ = () => {};
  c.readCheckpoint_ = () => ({
    revisionId: "r",
    blocks: [{ text: "text", kind: "paragraph" }],
  });
  c.createBlockAnchors_ = () => ["anchor"];
  c.refreshReview = () => ({ status: "queued" });
  const corrected = {
    model: "anthropic/test",
    limits: {
      max_input_tokens: 20000,
      max_output_tokens: 2000,
      max_cost_usd: 0.1,
    },
  };
  assert.throws(() => c.startLiveReview(corrected), /422|rejected|request/i);
  assert.equal(binding.pendingRunRequest, undefined);
  reject = false;
  assert.equal(c.startLiveReview(corrected).status, "queued");
  assert.equal(sent.at(-1).body.client_request_id, "new-request");
  assert.equal(sent.at(-1).body.limits.max_input_tokens, 20000);
});

test("uncertain HTTP outcomes keep the identical frozen run request", () => {
  for (const httpStatus of [408, 500, 200]) {
    let rejected = true;
    const posts = [];
    const c = load({
      UrlFetchApp: {
        fetch: (_url, options) => {
          posts.push(JSON.parse(options.payload));
          return {
            getResponseCode: () => (rejected ? httpStatus : 201),
            getContentText: () =>
              rejected ? "unreadable response" : JSON.stringify({ id: "run" }),
          };
        },
      },
    });
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", "Api.js"), "utf8"),
      c,
    );
    c.userToken_ = () => "fake-token";
    const original = {
      client_request_id: "frozen",
      snapshot_id: "base",
      mode: "live",
      model: "anthropic/test",
      limits: {
        max_input_tokens: 20000,
        max_output_tokens: 2000,
        max_cost_usd: 0.1,
      },
    };
    const binding = {
      projectId: "p",
      baseId: "base",
      pendingRunRequest: original,
    };
    c.binding_ = () => binding;
    c.saveBinding_ = () => {};
    c.refreshReview = () => ({ status: "queued" });
    assert.throws(() => c.startLiveReview({}));
    assert.equal(binding.pendingRunRequest, original);
    rejected = false;
    c.startLiveReview({ model: "changed-must-not-apply" });
    assert.deepEqual(posts, [original, original]);
    assert.equal(binding.pendingRunRequest, undefined);
  }
});

test("lesson proposal and exact-hash confirmation are separate from local correction", () => {
  const c = load({ Utilities: { getUuid: () => "request" } });
  c.binding_ = () => ({ projectId: "p" });
  const calls = [];
  c.lessonRequest_ = (_binding, suffix, method, payload) => {
    calls.push({ suffix, method, payload });
    if (method === "get")
      return { id: "l", content_hash: "exact", conflict_hash: "conflicts" };
    return payload;
  };
  assert.equal(typeof c.proposeReviewLesson, "function");
  const scope = {
    source_language: "zh",
    target_language: "en",
    construction: "term",
    positive_example: "yes",
    counterexample: "no",
    edition_restriction: null,
  };
  c.proposeReviewLesson(
    "decision",
    { client_request_id: "proposal", scope, guidance: "Scoped guidance" },
    null,
  );
  assert.equal(calls[0].suffix, "");
  assert.equal(calls[0].payload.originating_decision_id, "decision");
  assert.equal(calls[0].payload.supersedes_id, null);
  assert.throws(
    () => c.confirmReviewLesson("l", "wrong", "conflicts", {}, "confirm"),
    /changed/,
  );
  assert.equal(calls.filter((c) => c.suffix.endsWith("confirm")).length, 0);
  c.confirmReviewLesson(
    "l",
    "exact",
    "conflicts",
    { older: "Different edition" },
    "confirm",
  );
  const sent = calls.at(-1).payload;
  assert.equal(sent.expected_content_hash, "exact");
  assert.equal(sent.expected_conflict_hash, "conflicts");
  assert.equal(sent.conflict_resolutions.older, "Different edition");
  assert.equal(sent.client_request_id, "confirm");
});

test("sidebar lesson preview renders scope, hostile strings, conflicts, and immutable confirmation hash", () => {
  const { c, document } = sidebar();
  assert.equal(typeof c.renderLesson, "function");
  const calls = [];
  c.call = (name, args) => calls.push({ name, args });
  c.newActionId = () => "confirm-id";
  const hostile = '<img src=x onerror="throw 1">';
  c.renderLesson({
    id: "lesson",
    status: "proposed",
    originating_decision_id: "decision",
    content_hash: "abc123",
    conflict_hash: "conflict-sha",
    guidance: hostile,
    scope: {
      source_language: "zh",
      target_language: "en",
      construction: "Yidam",
      positive_example: "use",
      counterexample: "except",
      edition_restriction: null,
    },
    evidence: [],
    conflicts: [
      { id: "old", guidance: hostile, scope: { construction: "Other scope" } },
    ],
  });
  function all(node) {
    return [node, ...node.children.flatMap(all)];
  }
  const nodes = all(document.getElementById("lessonPanel"));
  assert.ok(nodes.some((n) => n.textContent === hostile));
  assert.ok(nodes.some((n) => n.textContent.includes("abc123")));
  assert.ok(nodes.some((n) => n.textContent.includes("Potential conflict")));
  const resolution = nodes.find(
    (n) =>
      n.tagName === "textarea" && n.dataset && n.dataset.conflictId === "old",
  );
  assert.ok(resolution);
  resolution.value = "Specific exception";
  nodes
    .find((n) => n.textContent === "Confirm experimental lesson")
    .handlers.click();
  assert.equal(calls[0].name, "confirmReviewLesson");
  assert.equal(calls[0].args[1], "abc123");
  assert.equal(calls[0].args[2], "conflict-sha");
  assert.equal(calls[0].args[3].old, "Specific exception");
});

test("sidebar local-decision choice never confirms or activates guidance", () => {
  const { c, document } = sidebar();
  assert.equal(typeof c.renderLearningChoice, "function");
  c.call = () =>
    assert.fail("Keeping a correction local must not call lesson confirmation");
  c.renderLearningChoice({
    id: "d",
    disposition: "corrected",
    note: "Local correction",
  });
  function all(node) {
    return [node, ...node.children.flatMap(all)];
  }
  const nodes = all(document.getElementById("lessonPanel"));
  nodes
    .find((n) => n.textContent === "Keep this decision local")
    .handlers.click();
  assert.match(
    document.getElementById("status").textContent,
    /No reusable lesson/,
  );
});

test("experiment bridge sends blinded labels without invented reviewer identity and refreshes reveal", () => {
  const c = load();
  c.binding_ = () => ({ projectId: "p" });
  const calls = [];
  c.experimentRequest_ = (_binding, suffix, method, payload) => {
    calls.push({ suffix, method, payload });
    return method === "get"
      ? { examples: [{ arm_key: { A: "candidate", B: "baseline" } }] }
      : { id: "label" };
  };
  assert.equal(typeof c.submitExperimentLabel, "function");
  const label = {
    client_request_id: "label",
    example_id: "e",
    phase: "judgment",
    arms: { A: {}, B: {} },
    note: "Checked",
  };
  const revealed = c.submitExperimentLabel("experiment", label);
  assert.equal(calls[0].suffix, "/experiment/labels");
  assert.equal(calls[0].payload.reviewer_id, undefined);
  assert.equal(calls[1].method, "get");
  assert.equal(revealed.examples[0].arm_key.A, "candidate");
});

test("active review timer excludes explicit pauses, hidden time, and inactivity", () => {
  const { c } = sidebar();
  assert.equal(typeof c.createActiveReviewClock, "function");
  let time = 0;
  const timer = c.createActiveReviewClock(() => time, 60);
  timer.start();
  time = 10;
  timer.touch();
  time = 100;
  timer.pause();
  time = 500;
  timer.start();
  time = 512;
  timer.pause();
  assert.equal(
    timer.intervals().reduce((n, i) => n + i.end - i.start, 0),
    82,
  );
});
