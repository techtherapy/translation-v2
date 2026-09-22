"""Canonical hashing, offsets, and grounding checks for review evidence."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Set
from typing import Any

from app.schemas.docs_review import ReviewAssessment, ReviewSpan


def evidence_hash(value: dict[str, Any]) -> str:
    """Return a stable SHA-256 for an exact JSON evidence bundle."""
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def utf16_offset(text: str, codepoint_offset: int) -> int:
    """Convert a Python code-point offset to a Google Docs UTF-16 offset."""
    if codepoint_offset < 0 or codepoint_offset > len(text):
        raise ValueError("codepoint offset is outside the text")
    return len(text[:codepoint_offset].encode("utf-16-le")) // 2


def _require_span(
    span: ReviewSpan,
    *,
    blocks: Mapping[str, str],
    block_role: str,
) -> None:
    if span.block_id not in blocks:
        raise ValueError(f"unknown {block_role} block: {span.block_id}")

    text = blocks[span.block_id]
    start = 0
    found = -1
    for _ in range(span.occurrence + 1):
        found = text.find(span.quote, start)
        if found == -1:
            if span.occurrence == 0:
                raise ValueError(
                    f"quote not found in {block_role} block {span.block_id}: {span.quote!r}"
                )
            raise ValueError(
                f"occurrence {span.occurrence} not found in {block_role} block "
                f"{span.block_id}: {span.quote!r}"
            )
        start = found + len(span.quote)


def validate_assessment_evidence(
    assessment: ReviewAssessment,
    *,
    source_blocks: Mapping[str, str],
    target_blocks: Mapping[str, str],
    evidence_ids: Set[str],
) -> ReviewAssessment:
    """Reject assessment references that were not present in the frozen input."""
    for finding in assessment.findings:
        for span in finding.source_spans:
            _require_span(span, blocks=source_blocks, block_role="source")
        for span in finding.target_spans:
            _require_span(span, blocks=target_blocks, block_role="target")
        for evidence_id in finding.evidence_ids:
            if evidence_id not in evidence_ids:
                raise ValueError(f"unknown evidence ID: {evidence_id}")
    return assessment
