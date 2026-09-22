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
