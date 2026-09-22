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
  if (Utilities.newBlob(serialized).getBytes().length > 8000)
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

function checkpointHash_(text) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8,
  )
    .map(function (byte) {
      return ("0" + ((byte + 256) % 256).toString(16)).slice(-2);
    })
    .join("");
}

function startLiveReview(options) {
  var binding = binding_();
  // A lost HTTP response must reuse the exact action, even if typing has continued.
  if (!binding.pendingRunRequest) {
    if (!options.model || !options.model.trim())
      throw new Error("Choose an explicit model for live review.");
    if (
      Utilities.newBlob(JSON.stringify(options.guidance || [])).getBytes()
        .length > 3000
    )
      throw new Error(
        "Live review guidance is too large. Shorten it before starting a new checkpoint.",
      );
    var limits = options.limits;
    if (
      !limits ||
      !Number.isInteger(limits.max_input_tokens) ||
      limits.max_input_tokens <= 0 ||
      !Number.isInteger(limits.max_output_tokens) ||
      limits.max_output_tokens <= 0 ||
      typeof limits.max_cost_usd !== "number" ||
      !Number.isFinite(limits.max_cost_usd) ||
      limits.max_cost_usd <= 0
    )
      throw new Error(
        "Review limits must use positive whole token counts and a positive cost limit.",
      );
    var current = readCheckpoint_(binding);
    var blocks = current.blocks.map(function (block) {
      return {
        block_id: Utilities.getUuid(),
        text: block.text,
        kind: block.kind,
      };
    });
    binding.blockAnchors = createBlockAnchors_(binding, blocks);
    var snapshot = apiRequest_(projectPath_(binding) + "/snapshots", "post", {
      client_request_id: Utilities.getUuid(),
      observed_revision_id: current.revisionId,
      suggestions_pending: false,
      blocks: blocks.map(function (block, index) {
        block.named_range_id = binding.blockAnchors[index];
        return block;
      }),
    });
    binding.baseId = snapshot.id;
    binding.pendingRunRequest = {
      client_request_id: Utilities.getUuid(),
      snapshot_id: snapshot.id,
      mode: "live",
      model: options.model.trim(),
      limits: options.limits,
      guidance: options.guidance || [],
    };
    binding.itemAnchors = {};
    delete binding.runId;
    delete binding.itemAnchorRunId;
    saveBinding_(binding);
  }
  var run;
  try {
    run = apiRequest_(
      projectPath_(binding) + "/runs",
      "post",
      binding.pendingRunRequest,
    );
  } catch (error) {
    // A definitive rejection created no run. Let corrected options start a new
    // action; only uncertain transport/server outcomes retain the frozen request.
    // HTTP 401 already signs out and removes the binding in the transport layer.
    if (error.requestRejected) {
      delete binding.pendingRunRequest;
      saveBinding_(binding);
    }
    throw error;
  }
  binding.runId = run.id;
  delete binding.pendingRunRequest;
  saveBinding_(binding);
  return refreshReview();
}

function retryReviewQueue() {
  var binding = binding_();
  retryReviewRun_(binding);
  return refreshReview();
}

function pollReview() {
  // No timers or triggers run in Apps Script. Only the open sidebar requests status.
  return refreshReview();
}

function liveReviewPresentation_(binding, base, run, current) {
  var changed = checkpointHash_(current.text) !== base.target_sha256;
  var message =
    {
      pending_enqueue:
        "Queue unavailable or unconfirmed. Retry queue delivery for this saved review.",
      queued: "Review queued. Your checkpoint has been saved.",
      running:
        "Review in progress. You can keep editing; this review stays tied to its checkpoint.",
      succeeded:
        "AI candidates and random audits are ready. Unflagged passages remain unreviewed.",
      failed:
        "Review failed (" +
        run.error_code +
        "). No chapter approval or partial findings were recorded.",
      interrupted:
        "Review interrupted; provider completion is unknown. This run will not make another paid call. Ask the maintainer to inspect it.",
    }[run.status] || "Review state unavailable. Refresh explicitly.";
  if (changed) message = "Review of an earlier version. " + message;
  if (
    !changed &&
    run.status === "succeeded" &&
    run.items.length &&
    binding.itemAnchorRunId !== binding.runId
  ) {
    verifyBlockAnchors_(binding, base, boundDocument_(binding).tab);
    var anchors = createItemAnchors_(binding, base, run.items);
    // A newer explicit checkpoint binding must never be replaced by this completion.
    var latest = binding_();
    if (latest.runId !== binding.runId || latest.baseId !== binding.baseId)
      throw new Error("A newer review is open. Refresh to see it.");
    latest.itemAnchors = anchors;
    latest.itemAnchorRunId = binding.runId;
    saveBinding_(latest);
  }
  return {
    baseId: base.id,
    status: run.status,
    changed: changed,
    message: message,
    queueRetryable: run.queue_retryable === true,
    findingCount: run.finding_count || 0,
    auditCount: run.audit_count || 0,
    items: run.items.map(function (item) {
      return {
        id: item.id,
        kind: item.kind,
        title:
          item.kind === "audit"
            ? "Random audit passage"
            : "Review " + item.category,
        source: item.source_spans
          .map(function (s) {
            return s.quote;
          })
          .join("\n"),
        target: item.target_spans
          .map(function (s) {
            return s.quote;
          })
          .join("\n\n"),
        concern: item.explanation,
        provenance:
          item.kind === "audit" ? "Recorded random sample" : "AI candidate",
        humanConfirmed: false,
        evidence:
          item.evidence_ids.join(", ") || "Supplied source and translation",
        action: "Review the whole chapter context before recording a decision.",
      };
    }),
  };
}

function refreshReview() {
  var binding = binding_();
  PropertiesService.getUserProperties().deleteProperty("bits.pending");
  var base = baseSnapshot_(binding);
  var run = reviewRun_(binding);
  var current = readCheckpoint_(binding);
  if (run.mode === "live")
    return liveReviewPresentation_(binding, base, run, current);
  verifyBlockAnchors_(binding, base, boundDocument_(binding).tab);
  var cards = run.input_bundle.fixture.analyst_cards;
  return {
    baseId: base.id,
    status: run.status,
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

function learningContext(decisionId) {
  var binding = binding_();
  var decision = apiRequest_(
    projectPath_(binding) + "/decisions/" + decisionId,
    "get",
  );
  var project = apiRequest_(projectPath_(binding), "get");
  return {
    decision: decision,
    source_language: project.source_language,
    target_language: project.target_language,
  };
}
function proposeReviewLesson(decisionId, proposal, supersedesId) {
  return lessonRequest_(binding_(), "", "post", {
    client_request_id: proposal.client_request_id,
    originating_decision_id: decisionId,
    supersedes_id: supersedesId || null,
    scope: proposal.scope,
    guidance: proposal.guidance,
    evidence: [],
  });
}
function readReviewLesson(lessonId) {
  return lessonRequest_(binding_(), "/" + lessonId, "get");
}
function confirmReviewLesson(
  lessonId,
  expectedHash,
  conflictHash,
  resolutions,
  requestId,
) {
  var binding = binding_();
  var latest = lessonRequest_(binding, "/" + lessonId, "get");
  if (
    latest.content_hash !== expectedHash ||
    latest.conflict_hash !== conflictHash
  )
    throw new Error(
      "Lesson or conflicts changed. Read the proposal again before confirming.",
    );
  return lessonRequest_(binding, "/" + lessonId + "/confirm", "post", {
    client_request_id: requestId,
    expected_content_hash: expectedHash,
    expected_conflict_hash: conflictHash,
    conflict_resolutions: resolutions,
  });
}
function createReviewExperiment(payload) {
  return experimentRequest_(binding_(), "", "post", payload);
}
function readReviewExperiment(experimentId) {
  return experimentRequest_(binding_(), "/" + experimentId, "get");
}
function runReviewExperiment(experimentId) {
  return experimentRequest_(binding_(), "/" + experimentId + "/run", "post");
}
function submitExperimentLabel(experimentId, label) {
  var binding = binding_();
  experimentRequest_(binding, "/" + experimentId + "/labels", "post", label);
  return experimentRequest_(binding, "/" + experimentId, "get");
}
function appendExperimentReport(experimentId, requestId) {
  var binding = binding_();
  experimentRequest_(binding, "/" + experimentId + "/reports", "post", {
    client_request_id: requestId,
  });
  return experimentRequest_(binding, "/" + experimentId, "get");
}
