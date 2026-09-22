from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from pydantic import ValidationError


FIXTURE_PATH = Path("tests/fixtures/docs_review/book-300-chapter-009.json")
EXPECTED_SHA256 = "7b97bab8f0343c8787973e1d09671f4f7f8f2a69290a715838f5a35301674ec0"
ENGLISH_MARKER = "009 The Benefits of Yidam Samadhi"


def _valid_finding() -> dict:
    return {
        "category": "meaning",
        "proposed_severity": "question",
        "source_spans": [
            {"block_id": "source", "quote": "六種神通", "occurrence": 0}
        ],
        "target_spans": [
            {"block_id": "target-1", "quote": "knowing all lives", "occurrence": 0},
            {"block_id": "target-2", "quote": "celestial vision", "occurrence": 0},
        ],
        "explanation": "Assess the six powers across the surrounding passage.",
        "evidence_ids": ["guidance-1"],
        "proposed_correction": None,
    }


def test_unicode_offsets_and_exact_evidence():
    from app.services.docs_review.evidence import evidence_hash, utf16_offset

    assert utf16_offset("A𠮷B", 2) == 3
    assert evidence_hash({"text": "氣"}) != evidence_hash({"text": "气"})
    assert evidence_hash({"a": 1, "b": 2}) == evidence_hash({"b": 2, "a": 1})


def test_evidence_hash_changes_with_text_or_guidance():
    from app.services.docs_review.evidence import evidence_hash

    baseline = {"text": "source", "guidance": [{"id": "g1", "content": "keep qi"}]}
    assert evidence_hash(baseline) != evidence_hash(
        {"text": "changed", "guidance": baseline["guidance"]}
    )
    assert evidence_hash(baseline) != evidence_hash(
        {"text": "source", "guidance": [{"id": "g1", "content": "translate qi"}]}
    )


def test_review_schema_accepts_multi_block_target_spans_and_empty_success():
    from app.schemas.docs_review import ReviewAssessment

    assessment = ReviewAssessment.model_validate(
        {"schema_version": 1, "findings": [_valid_finding()]}
    )
    assert [span.block_id for span in assessment.findings[0].target_spans] == [
        "target-1",
        "target-2",
    ]
    assert ReviewAssessment.model_validate(
        {"schema_version": 1, "findings": []}
    ).findings == []


@pytest.mark.parametrize(
    "mutation",
    [
        {"unknown": True},
        {"proposed_severity": "critical"},
        {"category": "grammar"},
        {"source_spans": [{"block_id": "source", "quote": "", "occurrence": 0}]},
        {"source_spans": [{"block_id": "source", "quote": "六種神通", "occurrence": -1}]},
        {"source_spans": [{"block_id": "source", "quote": "六種神通", "occurrence": "0"}]},
    ],
)
def test_review_schema_rejects_malformed_findings(mutation: dict):
    from app.schemas.docs_review import ReviewAssessment

    finding = _valid_finding()
    finding.update(mutation)
    with pytest.raises(ValidationError):
        ReviewAssessment.model_validate({"schema_version": 1, "findings": [finding]})


def test_grounding_rejects_invented_ids_and_missing_quotes():
    from app.schemas.docs_review import ReviewAssessment
    from app.services.docs_review.evidence import validate_assessment_evidence

    assessment = ReviewAssessment.model_validate(
        {"schema_version": 1, "findings": [_valid_finding()]}
    )
    source_blocks = {"source": "The source contains 六種神通 here."}
    target_blocks = {
        "target-1": "The attainment of knowing all lives.",
        "target-2": "Other powers include celestial vision and hearing.",
    }

    validate_assessment_evidence(
        assessment,
        source_blocks=source_blocks,
        target_blocks=target_blocks,
        evidence_ids={"guidance-1"},
    )

    cases = [
        ({"source_blocks": {}}, "unknown source block"),
        ({"target_blocks": {"target-1": target_blocks["target-1"]}}, "unknown target block"),
        ({"evidence_ids": set()}, "unknown evidence ID"),
        (
            {"target_blocks": {**target_blocks, "target-2": "No quoted words here."}},
            "quote not found",
        ),
    ]
    defaults = {
        "source_blocks": source_blocks,
        "target_blocks": target_blocks,
        "evidence_ids": {"guidance-1"},
    }
    for override, message in cases:
        with pytest.raises(ValueError, match=message):
            validate_assessment_evidence(assessment, **(defaults | override))


def test_grounding_honors_zero_based_occurrence():
    from app.schemas.docs_review import ReviewAssessment
    from app.services.docs_review.evidence import validate_assessment_evidence

    finding = _valid_finding()
    finding["target_spans"] = [
        {"block_id": "target-1", "quote": "qi", "occurrence": 1}
    ]
    assessment = ReviewAssessment.model_validate(
        {"schema_version": 1, "findings": [finding]}
    )
    validate_assessment_evidence(
        assessment,
        source_blocks={"source": "六種神通"},
        target_blocks={"target-1": "qi then qi"},
        evidence_ids={"guidance-1"},
    )
    finding["target_spans"][0]["occurrence"] = 2
    assessment = ReviewAssessment.model_validate(
        {"schema_version": 1, "findings": [finding]}
    )
    with pytest.raises(ValueError, match="occurrence 2 not found"):
        validate_assessment_evidence(
            assessment,
            source_blocks={"source": "六種神通"},
            target_blocks={"target-1": "qi then qi"},
            evidence_ids={"guidance-1"},
        )


def test_request_contracts_are_strict():
    from app.schemas.docs_review import (
        DecisionRequest,
        ExperimentRequest,
        LessonRequest,
        RunRequest,
        SnapshotRequest,
    )

    payloads = [
        (
            SnapshotRequest,
            {
                "client_request_id": "request-1",
                "observed_revision_id": None,
                "suggestions_pending": False,
                "blocks": [
                    {
                        "block_id": "target-1",
                        "text": "Text",
                        "kind": "paragraph",
                        "named_range_id": None,
                    }
                ],
            },
        ),
        (
            RunRequest,
            {
                "client_request_id": "request-1",
                "snapshot_id": "snapshot-1",
                "mode": "fixture",
            },
        ),
        (
            DecisionRequest,
            {
                "client_request_id": "request-1",
                "item_id": "item-1",
                "base_snapshot_id": "snapshot-1",
                "reviewed_snapshot_id": "snapshot-1",
                "disposition": "no_issue",
                "note": "",
            },
        ),
        (
            LessonRequest,
            {
                "client_request_id": "request-1",
                "originating_decision_id": "decision-1",
                "scope": {"construction": "只要"},
                "guidance": "Preserve conditional meaning.",
                "evidence": [{"decision_id": "decision-1"}],
            },
        ),
        (
            ExperimentRequest,
            {
                "client_request_id": "request-1",
                "lesson_ids": ["lesson-1"],
                "evaluation_examples": [{"id": "example-1"}],
                "baseline_input": {"model": "baseline"},
                "candidate_input": {"model": "candidate"},
                "excluded_example_hashes": ["abc123"],
            },
        ),
    ]
    for model, payload in payloads:
        model.model_validate(payload)
        with pytest.raises(ValidationError):
            model.model_validate({**payload, "unknown": True})


def test_fixture_preserves_supplied_material_and_analyst_provenance():
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    supplied = fixture["raw_chinese_section"] + fixture["raw_english_section"]
    chinese, english_tail = supplied.split(ENGLISH_MARKER, 1)
    english = ENGLISH_MARKER + english_tail

    assert fixture["source_sha256"] == EXPECTED_SHA256
    assert hashlib.sha256(supplied.encode("utf-8")).hexdigest() == EXPECTED_SHA256
    assert fixture["book_label"] == "300"
    assert fixture["chapter_label"] == "009"
    assert fixture["chinese_title"] == "本尊三摩地之益"
    assert fixture["english_title"] == "The Benefits of Yidam Samadhi"
    assert fixture["english_status"] == "unknown"
    assert fixture["raw_chinese_section"] == chinese
    assert fixture["raw_english_section"] == english
    assert fixture["raw_chinese_section"] + fixture["raw_english_section"] == supplied
    assert fixture["source_blocks"] == [
        {"block_id": "source", "text": chinese, "kind": "source"}
    ]
    assert "\n".join(block["text"] for block in fixture["target_blocks"]) == english
    assert [card["id"] for card in fixture["analyst_cards"]] == [
        "R1",
        "R2",
        "R3",
        "R4",
        "F1",
        "F2",
    ]
    assert all(
        card["provenance"] == "analyst_development_example"
        and card["human_confirmed"] is False
        for card in fixture["analyst_cards"]
    )
    six_powers = next(card for card in fixture["analyst_cards"] if card["id"] == "F2")
    assert six_powers["alignment"] == "surrounding_passage"
    assert six_powers["target_block_ids"] == ["target-0021", "target-0022"]


def test_fixture_preparer_rejects_hash_and_title_mismatches(tmp_path: Path):
    from scripts.prepare_docs_review_fixture import build_fixture

    changed = tmp_path / "changed.txt"
    changed.write_text("changed", encoding="utf-8")
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        build_fixture(changed)

    missing_title = tmp_path / "missing-title.txt"
    content = "009 本尊三摩地之益\nbody only"
    missing_title.write_text(content, encoding="utf-8")
    matching_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    with pytest.raises(ValueError, match="English title marker mismatch"):
        build_fixture(missing_title, expected_sha256=matching_hash)


def test_committed_fixture_matches_reproducible_builder(tmp_path: Path):
    from scripts.prepare_docs_review_fixture import build_fixture

    committed = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    source_copy = tmp_path / "300-009.txt"
    source_copy.write_bytes(
        (committed["raw_chinese_section"] + committed["raw_english_section"]).encode(
            "utf-8"
        )
    )
    assert committed == build_fixture(source_copy)
