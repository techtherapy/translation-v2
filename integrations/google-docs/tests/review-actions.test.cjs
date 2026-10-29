const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
function load() {
  const c = vm.createContext({});
  for (const file of ["ReviewState.js", "Document.js", "Code.js"])
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
      c,
    );
  return c;
}

test("minimal replacements preserve Unicode boundaries and unaffected wording", () => {
  const c = load();
  for (const [before, after] of [
    ["as soon as you", "as long as you"],
    ["😀 same", "😁 same"],
    ["a😀b", "ab"],
    ["ab", "a😀b"],
    ["echo echo", "echo new"],
  ]) {
    const p = c.textPatch_(before, after);
    assert.equal(
      before.slice(0, p.start) +
        p.insert +
        before.slice(p.start + p.remove.length),
      after,
    );
    assert.equal(/[\uD800-\uDBFF]$/.test(before.slice(0, p.start)), false);
    assert.equal(
      /^[\uDC00-\uDFFF]/.test(before.slice(p.start + p.remove.length)),
      false,
    );
  }
  assert.equal(c.textPatch_("same", "same"), null);
});

test("suggestion replacement uses the stored occurrence and rejects changed paragraphs", () => {
  const c = load();
  const base = { blocks: [{ block_id: "b", text: "😀 echo echo" }] };
  const item = {
    target_spans: [{ block_id: "b", quote: "echo", occurrence: 1 }],
    proposed_correction: "new",
  };
  const p = c.suggestionPlan_(base, base, item);
  assert.equal(p.after, "😀 echo new");
  assert.equal(p.index, 0);
  assert.equal(
    c.suggestionPlan_(
      base,
      { blocks: [{ block_id: "b", text: "changed echo echo" }] },
      item,
    ),
    null,
  );
  assert.equal(
    c.suggestionPlan_(base, base, {
      ...item,
      proposed_correction: "two\nparagraphs",
    }),
    null,
  );
  assert.equal(
    c.suggestionPlan_(base, base, {
      ...item,
      target_spans: [...item.target_spans, ...item.target_spans],
    }),
    null,
  );
});

test("document patch preserves surrounding formatting and Undo refuses intervening edits", () => {
  const c = load();
  let text = "pre old post";
  let attrs = Array.from(text, (_, i) => ({ BOLD: i < 3, ITALIC: i >= 8 }));
  let writes = 0;
  const el = {
    getText: () => text,
    getAttributes: (i) => ({ ...attrs[i] }),
    getTextAttributeIndices: () => attrs.map((_, i) => i),
    deleteText(a, b) {
      writes++;
      text = text.slice(0, a) + text.slice(b + 1);
      attrs.splice(a, b - a + 1);
      return this;
    },
    insertText(a, value) {
      writes++;
      text = text.slice(0, a) + value + text.slice(a);
      attrs.splice(a, 0, ...Array.from(value, () => ({})));
      return this;
    },
    setAttributes(a, b, value) {
      for (let i = a; i <= b; i++) attrs[i] = { ...value };
      return this;
    },
  };
  const patch = c.capturePatch_(el, "pre old post", "pre new word post");
  c.writePatch_(el, patch, false);
  assert.equal(text, "pre new word post");
  assert.equal(attrs[0].BOLD, true);
  assert.equal(attrs.at(-1).ITALIC, true);
  const count = writes;
  text += " typed";
  assert.throws(() => c.writePatch_(el, patch, true), /changed/);
  assert.equal(writes, count);
  text = "pre new word post";
  c.writePatch_(el, patch, true);
  assert.equal(text, "pre old post");
  assert.equal(attrs[4].BOLD, false);
  assert.equal(attrs.at(-1).ITALIC, true);
});

test("latest decision is used for state; deferral and reopening are not reviewed", () => {
  const c = load();
  const decisions = [
    { item_id: "a", disposition: "corrected" },
    { item_id: "a", disposition: "reopened" },
    { item_id: "b", disposition: "deferred" },
    { item_id: "c", disposition: "no_issue" },
  ];
  assert.equal(c.itemReviewState_("a", decisions), "pending");
  assert.equal(c.itemReviewState_("b", decisions), "later");
  assert.equal(c.itemReviewState_("c", decisions), "reviewed");
});

test("editing a reviewed passage makes that point pending without reopening unrelated points", () => {
  const c = load();
  c.reviewProperty_ = () => null;
  const base = {
    blocks: [
      { block_id: "b", text: "old" },
      { block_id: "c", text: "other" },
    ],
  };
  const run = {
    mode: "live",
    status: "succeeded",
    items: [
      { id: "a", target_spans: [{ block_id: "b" }], source_spans: [] },
      { id: "b", target_spans: [{ block_id: "c" }], source_spans: [] },
    ],
    decisions: [
      {
        id: "d1",
        item_id: "a",
        disposition: "corrected",
        reviewed_target_blocks: [{ block_id: "b", text: "corrected" }],
      },
      {
        id: "d2",
        item_id: "b",
        disposition: "no_issue",
        reviewed_target_blocks: [{ block_id: "c", text: "other" }],
      },
    ],
  };
  const view = c.enrichReview_(
    { items: [{ id: "a" }, { id: "b" }] },
    { runId: "r" },
    base,
    run,
    { blocks: [{ text: "edited again" }, { text: "other" }] },
  );
  assert.equal(view.items[0].state, "pending");
  assert.equal(view.items[0].reviewedChanged, true);
  assert.equal(view.items[1].state, "reviewed");
});

function workflow() {
  const c = load(),
    properties = {},
    decisions = [],
    snapshots = {};
  let uuid = 0,
    writes = 0,
    loseResponse = false;
  const texts = ["pre old post", "another passage"];
  const base = {
    id: "base",
    blocks: texts.map((text, i) => ({
      block_id: "b" + i,
      text,
      kind: "paragraph",
    })),
    canonical_text: texts.join("\n"),
  };
  snapshots.base = base;
  const items = [
    {
      id: "one",
      kind: "finding",
      target_spans: [{ block_id: "b0", quote: "old", occurrence: 0 }],
      proposed_correction: "new",
    },
    {
      id: "two",
      kind: "finding",
      target_spans: [
        { block_id: "b1", quote: "another passage", occurrence: 0 },
      ],
    },
  ];
  c.PropertiesService = {
    getUserProperties: () => ({
      getProperty: (k) => properties[k] || null,
      setProperty: (k, v) => (properties[k] = v),
      deleteProperty: (k) => delete properties[k],
    }),
  };
  c.LockService = {
    getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
  };
  c.Utilities = {
    getUuid: () => String(++uuid),
    newBlob: (v) => ({ getBytes: () => Buffer.from(v) }),
  };
  c.checkpointHash_ = (v) =>
    crypto.createHash("sha256").update(v).digest("hex");
  c.binding_ = () => ({
    projectId: "p",
    runId: "run",
    baseId: "base",
    blockAnchors: ["a", "b"],
  });
  c.baseSnapshot_ = () => base;
  c.reviewRun_ = () => ({ items, decisions });
  c.verifyBlockAnchors_ = () => {};
  c.selectCurrentPassage_ = () => {};
  c.readCheckpoint_ = () => ({
    text: texts.join("\n"),
    revisionId: "r",
    blocks: texts.map((text) => ({ text, kind: "paragraph" })),
  });
  c.refreshReview = () => ({
    items: items.map((i) => ({
      ...i,
      state: c.itemReviewState_(i.id, decisions),
    })),
  });
  c.boundDocument_ = () => ({
    doc: { setSelection: () => {} },
    tab: {
      newRange: () => ({
        addElement() {
          return this;
        },
        build: () => ({}),
      }),
      getBody: () => ({
        getChild: (i) => ({
          editAsText: () => ({
            getText: () => texts[i],
            getAttributes: () => ({ BOLD: false }),
            getTextAttributeIndices: () => [0],
            deleteText(a, b) {
              writes++;
              texts[i] = texts[i].slice(0, a) + texts[i].slice(b + 1);
            },
            insertText(a, text) {
              writes++;
              texts[i] = texts[i].slice(0, a) + text + texts[i].slice(a);
            },
            setAttributes: () => {},
          }),
        }),
      }),
    },
  });
  c.apiRequest_ = (url, method, payload) => {
    if (url.endsWith("/snapshots") && method === "post") {
      const id = "s" + payload.client_request_id;
      return (snapshots[id] ||= {
        id,
        ...payload,
        canonical_text: payload.blocks.map((b) => b.text).join("\n"),
      });
    }
    if (url.includes("/snapshots/")) return snapshots[url.split("/").pop()];
    if (url.endsWith("/decisions")) {
      let d = decisions.find(
        (d) => d.client_request_id === payload.client_request_id,
      );
      if (!d) {
        d = { id: "d" + decisions.length, ...payload };
        decisions.push(d);
      }
      if (loseResponse) {
        loseResponse = false;
        throw Error("lost response");
      }
      return d;
    }
    throw Error("unexpected request " + url);
  };
  return {
    c,
    texts,
    decisions,
    properties,
    writes: () => writes,
    loseResponse: () => (loseResponse = true),
  };
}

test("lost save response retries frozen evidence once, then a later point can be reviewed", () => {
  const t = workflow(),
    opened = t.c.openReviewItem("one");
  t.c.applyReviewSuggestion(
    "one",
    opened.contextId,
    "Preserve the conditional meaning.",
  );
  assert.equal(t.texts[0], "pre new post");
  const writes = t.writes();
  t.loseResponse();
  assert.throws(() => t.c.finishReviewSuggestion(), /lost response/);
  assert.equal(t.decisions.length, 1);
  assert.equal(t.decisions[0].note, "Preserve the conditional meaning.");
  t.c.finishReviewSuggestion();
  assert.equal(t.decisions.length, 1);
  assert.equal(t.writes(), writes);
  const second = t.c.openReviewItem("two");
  t.c.completeReviewItem("two", second.contextId, "keep", "");
  assert.equal(t.decisions[1].disposition, "no_issue");
  assert.notEqual(t.decisions[1].context_snapshot_id, "base");
  assert.equal(t.decisions[1].base_snapshot_id, "base");
});
test("later typing prevents apply; manual editing cannot be attributed to another point", () => {
  const t = workflow(),
    opened = t.c.openReviewItem("one");
  t.texts[1] = "edited elsewhere";
  assert.throws(
    () => t.c.applyReviewSuggestion("one", opened.contextId, ""),
    /changed/,
  );
  assert.throws(
    () => t.c.completeReviewItem("one", opened.contextId, "done", ""),
    /Edit this passage/,
  );
  assert.equal(t.writes(), 0);
  assert.equal(t.decisions.length, 0);
  t.texts[0] = "manual new wording";
  t.c.completeReviewItem("one", opened.contextId, "done", "My correction");
  assert.equal(t.decisions[0].disposition, "corrected");
});
test("undo restores exact text and reopens; changed text can only be reopened without overwriting", () => {
  const t = workflow(),
    opened = t.c.openReviewItem("one");
  t.c.applyReviewSuggestion("one", opened.contextId, "");
  t.c.finishReviewSuggestion();
  t.c.undoReviewAction("one");
  t.c.finishReviewSuggestion();
  assert.equal(t.texts[0], "pre old post");
  assert.equal(t.decisions.at(-1).disposition, "reopened");
  const again = t.c.openReviewItem("one");
  t.c.applyReviewSuggestion("one", again.contextId, "");
  t.c.finishReviewSuggestion();
  t.texts[0] += " later";
  const count = t.writes();
  assert.throws(() => t.c.undoReviewAction("one"), /changed/);
  assert.equal(t.writes(), count);
  t.c.reopenReviewItem("one");
  assert.equal(t.texts[0], "pre new post later");
  assert.equal(t.decisions.at(-1).disposition, "reopened");
});
