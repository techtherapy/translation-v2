/* Pure functions: no Google services or module wrapper. */
function textPatch_(before, after) {
  if (before === after) return null;
  // Compare code points, then convert back to the UTF-16 offsets used by Docs.
  var a = Array.from(before),
    b = Array.from(after),
    start = 0,
    tail = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    tail < a.length - start &&
    tail < b.length - start &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  return {
    start: a.slice(0, start).join("").length,
    remove: a.slice(start, a.length - tail).join(""),
    insert: b.slice(start, b.length - tail).join(""),
  };
}

function suggestionPlan_(base, current, item) {
  if (
    item.target_spans.length !== 1 ||
    typeof item.proposed_correction !== "string" ||
    !item.proposed_correction.trim() ||
    /[\r\n]/.test(item.proposed_correction)
  )
    return null;
  var span = item.target_spans[0];
  var index = base.blocks.findIndex(function (b) {
    return b.block_id === span.block_id;
  });
  if (
    index < 0 ||
    !current.blocks[index] ||
    current.blocks[index].text !== base.blocks[index].text
  )
    return null;
  var before = current.blocks[index].text;
  var offsets = quoteOffsets_(before, span.quote, span.occurrence);
  var after =
    before.slice(0, offsets.start) +
    item.proposed_correction +
    before.slice(offsets.end + 1);
  return before === after
    ? null
    : { index: index, before: before, after: after };
}

function latestDecision_(itemId, decisions) {
  return (
    (decisions || [])
      .filter(function (d) {
        return d.item_id === itemId;
      })
      .pop() || null
  );
}
function itemReviewState_(itemId, decisions) {
  var latest = latestDecision_(itemId, decisions);
  if (!latest || latest.disposition === "reopened") return "pending";
  if (
    latest.disposition === "deferred" ||
    latest.disposition === "needs_another_opinion"
  )
    return "later";
  return "reviewed";
}

function decisionState(baseHash, currentHash, pendingSuggestions, disposition) {
  if (pendingSuggestions) return "resolve_suggestions";
  if (baseHash === currentHash) return "ready";
  return disposition === "corrected" ? "needs_before_after" : "needs_refresh";
}

function quoteOffsets_(text, quote, occurrence) {
  if (!Number.isInteger(occurrence) || occurrence < 0)
    throw new Error("An explicit quote occurrence is required.");
  if (!quote) throw new Error("Empty quote; refresh and reassociate.");
  var start = -1;
  var next = 0;
  for (var i = 0; i <= occurrence; i++) {
    start = text.indexOf(quote, next);
    if (start < 0)
      throw new Error("The quoted text changed; refresh and reassociate.");
    next = start + quote.length;
  }
  // JavaScript string offsets are already UTF-16, as required by DocumentApp.
  return { start: start, end: next - 1 };
}

function validateAnchorShape_(anchor, matches, expected) {
  if (
    !anchor ||
    matches.length !== 1 ||
    anchor.id !== expected.id ||
    anchor.name !== expected.name ||
    anchor.parts.length !== 1 ||
    anchor.parts[0].index !== expected.index ||
    !anchor.parts[0].wholeParagraph
  ) {
    throw new Error(
      "Passage anchor is missing, duplicated, split or merged. Refresh and reassociate.",
    );
  }
  return true;
}
