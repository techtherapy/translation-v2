function onOpen() {
  DocumentApp.getUi()
    .createAddonMenu()
    .addItem("Open BITS review", "showSidebar")
    .addToUi();
}
function onInstall() {
  onOpen();
}
function showSidebar() {
  DocumentApp.getUi().showSidebar(
    HtmlService.createHtmlOutputFromFile("Sidebar").setTitle(
      "BITS · Chapter review",
    ),
  );
}

function binding_() {
  userToken_();
  var raw = PropertiesService.getUserProperties().getProperty("bits.binding");
  if (!raw)
    throw new Error("Preview and start an example chapter review first.");
  var binding = JSON.parse(raw);
  boundDocument_(binding);
  return binding;
}
function saveBinding_(binding) {
  var serialized = JSON.stringify(binding);
  if (serialized.length > 8000)
    throw new Error("Review binding is too large for this prototype.");
  PropertiesService.getUserProperties().setProperty("bits.binding", serialized);
}
function projectPath_(binding) {
  return "/api/docs-review/projects/" + binding.projectId;
}
function baseSnapshot_(binding) {
  return apiRequest_(
    projectPath_(binding) + "/snapshots/" + binding.baseId,
    "get",
  );
}
function reviewRun_(binding) {
  return apiRequest_(projectPath_(binding) + "/runs/" + binding.runId, "get");
}
function selectedItem_(run, itemId) {
  var item = run.items.find(function (value) {
    return value.id === itemId;
  });
  if (!item)
    throw new Error(
      "This card is not in the current review. Refresh explicitly.",
    );
  return item;
}

function previewFixture() {
  var fixture = apiRequest_("/api/docs-review/development-fixture", "get");
  var binding = activeBinding_();
  return {
    documentId: binding.documentId,
    tabId: binding.tabId,
    title: fixture.english_title,
    text: fixture.target_blocks
      .map(function (b) {
        return b.text;
      })
      .join("\n"),
    source: fixture.raw_chinese_section,
    cards: fixture.analyst_cards,
  };
}

function loadChapter(documentId, tabId) {
  var binding = { documentId: documentId, tabId: tabId };
  var fixture = apiRequest_("/api/docs-review/development-fixture", "get");
  // Fail closed even before the single explicit manuscript-writing action.
  readCheckpoint_(binding);
  var bound = boundDocument_(binding);
  loadEmptyTab_(
    bound.tab.getBody(),
    fixture.target_blocks
      .map(function (b) {
        return b.text;
      })
      .join("\n"),
  );
  return beginExampleReview_(binding, fixture);
}

function startExampleReview(documentId, tabId) {
  return beginExampleReview_(
    { documentId: documentId, tabId: tabId },
    apiRequest_("/api/docs-review/development-fixture", "get"),
  );
}

function beginExampleReview_(binding, fixture) {
  var current = readCheckpoint_(binding);
  var canonical = fixture.target_blocks
    .map(function (b) {
      return b.text;
    })
    .join("\n");
  if (
    current.text !== canonical ||
    current.blocks.length !== fixture.target_blocks.length
  ) {
    throw new Error(
      "Example findings require the supplied chapter. Start in an empty test tab, or request a fresh live review when available.",
    );
  }
  var project = apiRequest_("/api/docs-review/projects", "post", {
    client_request_id: Utilities.getUuid(),
    document_id: binding.documentId,
    tab_id: binding.tabId,
    book_label: fixture.book_label,
    chapter_label: fixture.chapter_label,
    source_language: fixture.source_language,
    target_language: fixture.target_language,
    source_text: fixture.raw_chinese_section,
    english_status: "unknown",
  });
  binding.projectId = project.id;
  binding.blockAnchors = createBlockAnchors_(binding, fixture.target_blocks);
  var snapshot = apiRequest_(projectPath_(binding) + "/snapshots", "post", {
    client_request_id: Utilities.getUuid(),
    observed_revision_id: current.revisionId,
    suggestions_pending: false,
    blocks: fixture.target_blocks.map(function (block, index) {
      return {
        block_id: block.block_id,
        text: block.text,
        kind: current.blocks[index].kind,
        named_range_id: binding.blockAnchors[index],
      };
    }),
  });
  binding.baseId = snapshot.id;
  var run = apiRequest_(projectPath_(binding) + "/runs", "post", {
    client_request_id: Utilities.getUuid(),
    snapshot_id: snapshot.id,
    mode: "fixture",
  });
  binding.runId = run.id;
  // Recheck text after remote calls before binding any exact-quote selections.
  if (readCheckpoint_(binding).text !== snapshot.canonical_text)
    throw new Error("The chapter changed during setup. Refresh explicitly.");
  binding.itemAnchors = createItemAnchors_(binding, snapshot, run.items);
  saveBinding_(binding);
  PropertiesService.getUserProperties().deleteProperty("bits.pending");
  return refreshReview();
}

function refreshReview() {
  var binding = binding_();
  PropertiesService.getUserProperties().deleteProperty("bits.pending");
  var base = baseSnapshot_(binding);
  var run = reviewRun_(binding);
  var current = readCheckpoint_(binding);
  verifyBlockAnchors_(binding, base, boundDocument_(binding).tab);
  var cards = run.input_bundle.fixture.analyst_cards;
  return {
    baseId: base.id,
    changed: current.text !== base.canonical_text,
    message:
      current.text !== base.canonical_text
        ? "Chapter changed. Example findings are stale for approval. Corrected requires an explicit before/after review; other decisions need a new assessment."
        : "Example findings · analyst development material · English approval status unknown.",
    items: run.items.map(function (item) {
      var evidence = item.evidence_ids[0];
      var card = cards.find(function (candidate) {
        return evidence === "analyst_development_example:" + candidate.id;
      });
      return {
        id: item.id,
        kind: item.kind,
        title: card.title,
        source:
          card.source ||
          item.source_spans
            .map(function (span) {
              return span.quote;
            })
            .join("\n"),
        target: item.target_spans
          .map(function (span) {
            return span.quote;
          })
          .join("\n\n"),
        concern: item.explanation,
        provenance: card.provenance,
        humanConfirmed: card.human_confirmed,
        evidence:
          card.reference || "Supplied chapter and analyst development example",
        action:
          card.reviewer_action ||
          card.desired_behavior ||
          card.possible_direction ||
          "",
      };
    }),
  };
}

function focusItem(itemId) {
  var binding = binding_();
  var base = baseSnapshot_(binding);
  var item = selectedItem_(reviewRun_(binding), itemId);
  if (readCheckpoint_(binding).text !== base.canonical_text)
    throw new Error("The chapter changed. Refresh before selecting a finding.");
  selectItem_(binding, base, item);
  return { focused: true };
}

function prepareDecision(itemId, disposition, note) {
  var binding = binding_();
  PropertiesService.getUserProperties().deleteProperty("bits.pending");
  var base = baseSnapshot_(binding);
  var item = selectedItem_(reviewRun_(binding), itemId);
  var allowed =
    item.kind === "audit"
      ? ["audit_no_issue", "audit_found_issue"]
      : ["confirmed_issue", "no_issue", "corrected", "needs_another_opinion"];
  if (
    allowed.indexOf(disposition) < 0 ||
    typeof note !== "string" ||
    note.length > 5000
  )
    throw new Error(
      "Choose a valid decision and a note of at most 5,000 characters.",
    );
  if (disposition === "audit_found_issue" && !note.trim())
    throw new Error(
      "Describe the source-grounded issue before recording an audit decision.",
    );
  var pending = {
    nonce: Utilities.getUuid(),
    projectId: binding.projectId,
    runId: binding.runId,
    itemId: itemId,
    baseId: base.id,
    // Backend EvidenceRecord IDs are UUID strings (36 ASCII characters).
    // Reserve their exact serialized size before creating the checkpoint.
    reviewedId: "00000000-0000-0000-0000-000000000000",
    disposition: disposition,
    note: note,
  };
  // Leave a small margin under Apps Script's 9 KB per-property limit.
  // JSON escaping and UTF-8 encoding can both make a note larger than its character count.
  if (Utilities.newBlob(JSON.stringify(pending)).getBytes().length > 9000) {
    throw new Error(
      "Review note is too large to save. Shorten it and preview the decision again. No checkpoint was created.",
    );
  }
  var current = readCheckpoint_(binding);
  verifyBlockAnchors_(binding, base, boundDocument_(binding).tab);
  var reviewed = apiRequest_(projectPath_(binding) + "/snapshots", "post", {
    client_request_id: Utilities.getUuid(),
    observed_revision_id: current.revisionId,
    suggestions_pending: false,
    blocks: current.blocks.map(function (block, index) {
      return {
        block_id: base.blocks[index].block_id,
        text: block.text,
        kind: block.kind,
        named_range_id: base.blocks[index].named_range_id || null,
      };
    }),
  });
  var state = decisionState(
    base.target_sha256,
    reviewed.target_sha256,
    false,
    disposition,
  );
  if (state === "needs_refresh")
    throw new Error(
      "The chapter changed. Refresh and obtain a new assessment before approving findings.",
    );
  if (disposition === "corrected" && state === "ready")
    throw new Error(
      "Corrected requires a changed chapter and explicit before/after review.",
    );
  pending.reviewedId = reviewed.id;
  PropertiesService.getUserProperties().setProperty(
    "bits.pending",
    JSON.stringify(pending),
  );
  return {
    nonce: pending.nonce,
    disposition: disposition,
    before: base.canonical_text,
    after: reviewed.canonical_text,
    baseId: base.id,
    reviewedId: reviewed.id,
    changed: state === "needs_before_after",
  };
}

function recordDecision(nonce) {
  var binding = binding_();
  var raw = PropertiesService.getUserProperties().getProperty("bits.pending");
  if (!raw) throw new Error("Preview the decision before recording it.");
  var pending = JSON.parse(raw);
  if (
    pending.nonce !== nonce ||
    pending.projectId !== binding.projectId ||
    pending.runId !== binding.runId ||
    pending.baseId !== binding.baseId
  ) {
    throw new Error("This decision preview expired. Preview it again.");
  }
  var reviewed = apiRequest_(
    projectPath_(binding) + "/snapshots/" + pending.reviewedId,
    "get",
  );
  var current = readCheckpoint_(binding);
  verifyBlockAnchors_(
    binding,
    baseSnapshot_(binding),
    boundDocument_(binding).tab,
  );
  if (current.text !== reviewed.canonical_text)
    throw new Error(
      "The chapter changed after preview. Preview the decision again.",
    );
  var decision = apiRequest_(projectPath_(binding) + "/decisions", "post", {
    client_request_id: pending.nonce,
    item_id: pending.itemId,
    base_snapshot_id: pending.baseId,
    reviewed_snapshot_id: pending.reviewedId,
    disposition: pending.disposition,
    note: pending.note,
  });
  PropertiesService.getUserProperties().deleteProperty("bits.pending");
  // This event certifies only reviewedId. It cannot certify later typing.
  return decision;
}
