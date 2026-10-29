const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { JSDOM } = createRequire(
  path.join(__dirname, "../../../frontend/package.json"),
)("jsdom");
const html = fs.readFileSync(path.join(__dirname, "../Sidebar.html"), "utf8");
function setup() {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://example.test",
  });
  const w = dom.window,
    calls = [];
  let ok, fail;
  const run = new Proxy(
    {},
    {
      get(_, key) {
        if (key === "withSuccessHandler")
          return (fn) => {
            ok = fn;
            return run;
          };
        if (key === "withFailureHandler")
          return (fn) => {
            fail = fn;
            return run;
          };
        return (...args) => calls.push({ name: key, args, ok, fail });
      },
    },
  );
  w.google = { script: { run } };
  w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const review = {
    status: "completed",
    example: true,
    items: [
      {
        id: "one",
        kind: "finding",
        title: "Check the condition",
        target: "as soon as",
        source: "只要",
        summary: "Check the condition.",
        state: "pending",
        order: 0,
      },
      {
        id: "two",
        kind: "finding",
        title: "Check the term",
        target: "<script>bad()</script>",
        source: "本尊",
        summary: "Verify this term.",
        state: "pending",
        order: 1,
      },
      {
        id: "three",
        kind: "audit",
        title: "Check the list",
        target: "One, two",
        source: "一、二",
        summary: "Check coverage.",
        state: "pending",
        order: 2,
      },
    ],
  };
  w.displayReview(review);
  return { w, doc: w.document, calls, review, close: () => w.close() };
}
test("compact queue opens one point with source and a literal proposed diff", () => {
  const t = setup();
  assert.equal(t.doc.querySelectorAll(".point-toggle").length, 3);
  assert.equal(t.doc.querySelectorAll(".point-body").length, 0);
  t.doc.querySelector(".point-toggle").click();
  assert.equal(t.calls.at(-1).name, "openReviewItem");
  t.calls.at(-1).ok({
    id: "one",
    contextId: "context",
    currentTarget: "as soon as",
    suggestion: "as long as",
  });
  assert.equal(t.doc.querySelectorAll(".point-body").length, 1);
  assert.equal(t.doc.querySelector(".source-quote").textContent, "只要");
  assert.equal(t.doc.querySelector("del").textContent, "soon");
  assert.equal(t.doc.querySelector("ins").textContent, "long");
  assert.ok(
    [...t.doc.querySelectorAll("button")].some(
      (b) => b.textContent === "Use suggestion",
    ),
  );
  assert.equal(t.doc.querySelectorAll("#cards script").length, 0);
  t.close();
});
test("apply saves across two calls, stays on passage, and Next explicitly opens another point", () => {
  const t = setup();
  t.w.chooseItem("one");
  t.calls.at(-1).ok({
    id: "one",
    contextId: "context",
    currentTarget: "as soon as",
    suggestion: "as long as",
  });
  t.doc.querySelector(".point-body textarea").value = "Meaning note";
  [...t.doc.querySelectorAll("button")]
    .find((b) => b.textContent === "Use suggestion")
    .click();
  assert.equal(t.calls.at(-1).name, "applyReviewSuggestion");
  assert.deepEqual(Array.from(t.calls.at(-1).args), [
    "one",
    "context",
    "Meaning note",
  ]);
  t.calls.at(-1).ok({ pending: true, itemId: "one" });
  assert.equal(t.calls.at(-1).name, "finishReviewSuggestion");
  const review = structuredClone(t.review);
  review.items[0].state = "reviewed";
  review.items[0].canUndo = true;
  t.calls.at(-1).ok({
    itemId: "one",
    decision: { id: "decision", disposition: "corrected" },
    review,
  });
  assert.equal(t.calls.filter((c) => c.name === "openReviewItem").length, 1);
  [...t.doc.querySelectorAll("button")]
    .find((b) => b.textContent === "Next")
    .click();
  assert.equal(t.calls.at(-1).name, "openReviewItem");
  assert.equal(t.calls.at(-1).args[0], "two");
  t.close();
});
test("failed save exposes retry without applying twice; reviewed and later groups remain distinct", () => {
  const t = setup();
  t.review.pendingAction = { itemId: "one" };
  t.review.items[1].state = "later";
  t.review.items[2].state = "reviewed";
  t.w.displayReview(t.review);
  [...t.doc.querySelectorAll("button")]
    .find((b) => b.textContent === "Retry saving")
    .click();
  assert.equal(t.calls.at(-1).name, "finishReviewSuggestion");
  assert.ok(t.doc.querySelector("#cards").textContent.includes("Do later"));
  assert.ok(t.doc.querySelector("#cards").textContent.includes("Reviewed"));
  t.close();
});
