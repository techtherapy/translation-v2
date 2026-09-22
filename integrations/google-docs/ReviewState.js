/* Pure functions: no Google services or module wrapper. */
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
