function activeBinding_() {
  var doc = DocumentApp.getActiveDocument();
  if (!doc) throw new Error("Open a Google document first.");
  return { documentId: doc.getId(), tabId: doc.getActiveTab().getId() };
}

function boundDocument_(binding) {
  var doc = DocumentApp.getActiveDocument();
  if (
    !doc ||
    doc.getId() !== binding.documentId ||
    doc.getActiveTab().getId() !== binding.tabId
  ) {
    throw new Error(
      "Return to the selected tab for this review. A different tab cannot be rebound automatically.",
    );
  }
  return { doc: doc, tab: doc.getTab(binding.tabId).asDocumentTab() };
}

function hasSuggestions_(value) {
  if (!value || typeof value !== "object") return false;
  return Object.keys(value).some(function (key) {
    var child = value[key];
    if (
      /^suggested/.test(key) &&
      child &&
      typeof child === "object" &&
      Object.keys(child).length
    )
      return true;
    return hasSuggestions_(child);
  });
}

function findApiTab_(tabs, id) {
  for (var i = 0; i < (tabs || []).length; i++) {
    if (tabs[i].tabProperties.tabId === id) return tabs[i];
    var nested = findApiTab_(tabs[i].childTabs, id);
    if (nested) return nested;
  }
  return null;
}

function apiTabSnapshot_(response, tabId) {
  var selected = findApiTab_(response.tabs, tabId);
  if (!selected || !selected.documentTab)
    throw new Error("The selected tab is unavailable. Refresh explicitly.");
  var content = selected.documentTab;
  if (hasSuggestions_(content) || hasSuggestions_(response.documentStyle)) {
    throw new Error(
      "Resolve pending Google Docs suggestions, including style suggestions, then Refresh.",
    );
  }
  if (
    [
      "headers",
      "footers",
      "footnotes",
      "inlineObjects",
      "positionedObjects",
    ].some(function (key) {
      return content[key] && Object.keys(content[key]).length;
    })
  )
    throw new Error(
      "Unsupported headers, footnotes or embedded objects. Use a plain chapter test tab.",
    );
  var paragraphs = [];
  (content.body.content || []).forEach(function (entry, index) {
    if (entry.sectionBreak && index === 0) return;
    if (!entry.paragraph)
      throw new Error(
        "Unsupported structure (for example, a table). Use plain paragraphs or lists.",
      );
    var paragraph = entry.paragraph;
    if (paragraph.positionedObjectIds && paragraph.positionedObjectIds.length)
      throw new Error("Unsupported positioned object.");
    var text = (paragraph.elements || [])
      .map(function (element) {
        if (!element.textRun || typeof element.textRun.content !== "string")
          throw new Error("Unsupported text-bearing structure.");
        return element.textRun.content;
      })
      .join("");
    if (!text.endsWith("\n"))
      throw new Error("Unsupported paragraph boundary. Refresh explicitly.");
    paragraphs.push(text.slice(0, -1));
  });
  return {
    text: paragraphs.join("\n"),
    paragraphs: paragraphs,
    revisionId: response.revisionId || null,
  };
}

function documentParagraphs_(body) {
  var blocks = [];
  for (var i = 0; i < body.getNumChildren(); i++) {
    var child = body.getChild(i);
    var type = String(child.getType());
    if (type !== "PARAGRAPH" && type !== "LIST_ITEM")
      throw new Error("Unsupported structure. Use plain paragraphs or lists.");
    for (var j = 0; j < child.getNumChildren(); j++) {
      if (String(child.getChild(j).getType()) !== "TEXT")
        throw new Error("Unsupported inline object or text-bearing structure.");
    }
    blocks.push({
      text: child.getText(),
      kind:
        type === "LIST_ITEM"
          ? "list_item"
          : String(child.getHeading()) === "NORMAL"
            ? "paragraph"
            : "heading",
    });
  }
  return blocks;
}

function readCheckpoint_(binding) {
  var bound = boundDocument_(binding);
  var before = documentParagraphs_(bound.tab.getBody());
  var response;
  try {
    response = Docs.Documents.get(binding.documentId, {
      includeTabsContent: true,
      suggestionsViewMode: "SUGGESTIONS_INLINE",
    });
  } catch (_error) {
    throw new Error(
      "Google suggestions inspection is unavailable. No checkpoint was accepted. Refresh explicitly.",
    );
  }
  var api = apiTabSnapshot_(response, binding.tabId);
  var after = documentParagraphs_(bound.tab.getBody());
  if (
    JSON.stringify(before) !== JSON.stringify(after) ||
    after
      .map(function (b) {
        return b.text;
      })
      .join("\n") !== api.text ||
    after.length !== api.paragraphs.length
  ) {
    throw new Error(
      "The chapter changed during reading. Refresh explicitly and retry.",
    );
  }
  boundDocument_(binding);
  return { text: api.text, blocks: after, revisionId: api.revisionId };
}

function loadEmptyTab_(body, text) {
  if (
    body.getText() !== "" ||
    body.getNumChildren() !== 1 ||
    String(body.getChild(0).getType()) !== "PARAGRAPH"
  )
    throw new Error("Load chapter requires an otherwise empty selected tab.");
  documentParagraphs_(body);
  body.setText(text); // Whole-tab writes are allowed only for explicit loading into an empty tab.
}

function anchorDescriptor_(named, body) {
  if (!named) return null;
  return {
    id: named.getId(),
    name: named.getName(),
    parts: named
      .getRange()
      .getRangeElements()
      .map(function (part) {
        var element = part.getElement();
        var type = String(element.getType());
        var paragraph = type === "TEXT" ? element.getParent() : element;
        var index = body.getChildIndex(paragraph);
        return {
          index: index,
          wholeParagraph:
            !part.isPartial() && (type === "PARAGRAPH" || type === "LIST_ITEM"),
        };
      }),
  };
}

function verifyBlockAnchors_(binding, base, tab) {
  var body = tab.getBody();
  if (
    body.getNumChildren() !== base.blocks.length ||
    binding.blockAnchors.length !== base.blocks.length
  ) {
    throw new Error(
      "Paragraphs were split, merged or added. Refresh and reassociate before continuing.",
    );
  }
  base.blocks.forEach(function (block, index) {
    var name = "bits-review:" + binding.projectId + ":" + block.block_id;
    var id = binding.blockAnchors[index];
    validateAnchorShape_(
      anchorDescriptor_(tab.getNamedRangeById(id), body),
      tab.getNamedRanges(name),
      { id: id, name: name, index: index },
    );
  });
}

function createBlockAnchors_(binding, blocks) {
  var tab = boundDocument_(binding).tab;
  var body = tab.getBody();
  return blocks.map(function (block, index) {
    var name = "bits-review:" + binding.projectId + ":" + block.block_id;
    if (tab.getNamedRanges(name).length)
      throw new Error("Duplicate passage anchor. Refresh and reassociate.");
    return tab
      .addNamedRange(
        name,
        tab.newRange().addElement(body.getChild(index)).build(),
      )
      .getId();
  });
}

function createItemAnchors_(binding, base, items) {
  var tab = boundDocument_(binding).tab;
  var result = {};
  items.forEach(function (item) {
    var range = tab.newRange();
    item.target_spans.forEach(function (span) {
      var index = base.blocks.findIndex(function (b) {
        return b.block_id === span.block_id;
      });
      if (index < 0)
        throw new Error("Unknown passage. Refresh and reassociate.");
      var offsets = quoteOffsets_(
        base.blocks[index].text,
        span.quote,
        span.occurrence,
      );
      range.addElement(
        tab.getBody().getChild(index).editAsText(),
        offsets.start,
        offsets.end,
      );
    });
    var name = "bits-review:" + binding.runId + ":" + item.id;
    if (tab.getNamedRanges(name).length)
      throw new Error("Duplicate finding anchor. Refresh and reassociate.");
    result[item.id] = tab.addNamedRange(name, range.build()).getId();
  });
  return result;
}

function selectItem_(binding, base, item) {
  var bound = boundDocument_(binding);
  verifyBlockAnchors_(binding, base, bound.tab);
  var name = "bits-review:" + binding.runId + ":" + item.id;
  var named = bound.tab.getNamedRangeById(binding.itemAnchors[item.id]);
  if (
    !named ||
    named.getId() !== binding.itemAnchors[item.id] ||
    named.getName() !== name ||
    bound.tab.getNamedRanges(name).length !== 1
  ) {
    throw new Error(
      "Finding anchor is missing or duplicated. Refresh and reassociate.",
    );
  }
  var parts = named.getRange().getRangeElements();
  if (parts.length !== item.target_spans.length)
    throw new Error("Finding was split or merged. Refresh and reassociate.");
  parts.forEach(function (part, index) {
    var element = part.getElement();
    var span = item.target_spans[index];
    var blockIndex = base.blocks.findIndex(function (block) {
      return block.block_id === span.block_id;
    });
    if (
      String(element.getType()) !== "TEXT" ||
      bound.tab.getBody().getChildIndex(element.getParent()) !== blockIndex
    ) {
      throw new Error(
        "Finding quote or passage changed. Refresh and reassociate.",
      );
    }
    // Whole Text elements use -1 sentinel offsets; their selected text is the full element.
    var selectedText = element.getText();
    var start = part.isPartial() ? part.getStartOffset() : 0;
    var end = part.isPartial()
      ? part.getEndOffsetInclusive()
      : selectedText.length - 1;
    if (selectedText.slice(start, end + 1) !== span.quote) {
      throw new Error(
        "Finding quote or passage changed. Refresh and reassociate.",
      );
    }
    var offsets = quoteOffsets_(
      base.blocks[blockIndex].text,
      span.quote,
      span.occurrence,
    );
    if (start !== offsets.start || end !== offsets.end) {
      throw new Error("Finding occurrence changed. Refresh and reassociate.");
    }
  });
  bound.doc.setActiveTab(binding.tabId);
  bound.doc.setSelection(named.getRange());
}

function capturePatch_(element, before, after) {
  if (element.getText() !== before)
    throw new Error("The passage changed. Open it again.");
  var patch = textPatch_(before, after);
  if (!patch) throw new Error("This suggestion already matches the document.");
  patch.before = before;
  patch.after = after;
  patch.attributes = element.getAttributes(
    Math.min(patch.start, before.length - 1),
  );
  patch.originalStyles = [];
  var end = patch.start + patch.remove.length;
  var starts = [patch.start].concat(
    element.getTextAttributeIndices().filter(function (i) {
      return i > patch.start && i < end;
    }),
  );
  starts.forEach(function (start, i) {
    if (start < end)
      patch.originalStyles.push({
        start: start - patch.start,
        end: (starts[i + 1] || end) - patch.start - 1,
        attributes: element.getAttributes(start),
      });
  });
  return patch;
}

function writePatch_(element, patch, undo) {
  if (element.getText() !== (undo ? patch.after : patch.before))
    throw new Error(
      "The passage changed. Your later edits have been kept. Open the point again.",
    );
  var remove = undo ? patch.insert : patch.remove;
  var insert = undo ? patch.remove : patch.insert;
  if (remove.length)
    element.deleteText(patch.start, patch.start + remove.length - 1);
  if (insert.length) {
    element.insertText(patch.start, insert);
    element.setAttributes(
      patch.start,
      patch.start + insert.length - 1,
      patch.attributes,
    );
    if (undo)
      patch.originalStyles.forEach(function (style) {
        element.setAttributes(
          patch.start + style.start,
          patch.start + style.end,
          style.attributes,
        );
      });
  }
}

function selectCurrentPassage_(binding, base, item, current) {
  var bound = boundDocument_(binding);
  verifyBlockAnchors_(binding, base, bound.tab);
  var range = bound.tab.newRange();
  item.target_spans.forEach(function (span) {
    var index = base.blocks.findIndex(function (b) {
      return b.block_id === span.block_id;
    });
    if (index < 0) throw new Error("Passage missing. Start a fresh review.");
    var paragraph = bound.tab.getBody().getChild(index);
    // An edited block is shown whole. Never guess a quote's new location.
    if (current.blocks[index].text === base.blocks[index].text) {
      var offsets = quoteOffsets_(
        current.blocks[index].text,
        span.quote,
        span.occurrence,
      );
      range.addElement(paragraph.editAsText(), offsets.start, offsets.end);
    } else range.addElement(paragraph);
  });
  bound.doc.setActiveTab(binding.tabId);
  bound.doc.setSelection(range.build());
}
