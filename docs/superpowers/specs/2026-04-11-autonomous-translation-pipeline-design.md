# Machine-First Translation System — Design Spec

**Date:** 2026-04-11
**Status:** Draft
**Scope:** BITS evolution from human-driven CAT tool to machine-first, human-governed translation system

---

## 1. The Problem

BITS is a translation tool for the works of Living Buddha Lian Sheng (True Buddha School). The corpus is large — 300+ books — with demand for translation into English, Indonesian, French, Spanish, Japanese, and other languages. A team of 2-5 people (growing over time) translates, reviews, and edits.

The current workflow is segment-by-segment: a human translator opens each sentence, requests an AI suggestion, edits it, and moves on. This is the standard CAT (Computer-Assisted Translation) paradigm. It works, but it creates a structural bottleneck: **throughput is bounded by human translation speed**, regardless of how good the AI becomes.

At current pace, the backlog of untranslated books across multiple languages is not achievable. The team needs a fundamentally different relationship with the AI — not "AI assists human" but "AI leads, human governs."

---

## 2. The Strategic Shift

**From:** Human translators working segment-by-segment with AI assistance.
**To:** AI translating entire projects (books, articles, text snippets) with humans providing quality oversight, doctrinal review, and knowledge curation.

The primary interface shifts from a translation editor to a review dashboard. The editor remains available for deep-dive work, but it is no longer the centerpiece.

This is not "full autonomy." The AI does not publish without human review. It is a **machine-first, human-governed** workflow: the AI does the volume work, humans ensure fidelity, and every correction makes the system better.

---

## 3. Non-Negotiable Principles

These constrain every design decision. If a feature or optimization conflicts with these principles, the principle wins.

1. **Doctrinal precision is not negotiable.** A linguistically fluent translation that distorts Buddhist concepts is worse than a rough translation that preserves meaning. The system must surface doctrinal uncertainty, not hide it behind confidence scores.

2. **Voice and lineage fidelity are inseparable from doctrine.** Living Buddha Lian Sheng has a distinctive voice. The True Buddha School has specific interpretive traditions. Generic "Buddhist English" is a failure mode, not a success.

3. **Humans control what the AI knows.** Every piece of knowledge the system learns — style rules, correction patterns, golden examples — requires human confirmation before it affects future translations. The AI suggests; humans approve.

4. **Evidentiary transparency over black-box optimization.** Every AI translation must be accompanied by its evidence trail: which glossary entries were applied, which style rules were retrieved, which golden examples were shown, what source spans were salient, what alternatives were considered. This is a firmer promise than claiming the model can introspect on its own reasoning — LLMs produce plausible rationales more reliably than accurate ones. The system's transparency comes from showing what went *in*, not from asking the model to explain what came *out*.

5. **Quality is the constraint; throughput is the outcome.** The promise is not "translate faster." It is "increase output without increasing high-severity error risk." If the system cannot maintain fidelity at higher volume, the volume must decrease.

6. **Simplicity is a feature.** The system described here has significant internal complexity — knowledge bases, pipelines, confidence scoring, tiered review, feedback loops. None of that complexity should be visible to the user by default. The interfaces must be simple and intuitive, abstracting the machinery away. A reviewer should be able to open the dashboard, see what needs attention, act on it, and move on — without understanding the pipeline internals, the knowledge precedence hierarchy, or how confidence scores are calibrated. Power users can access deeper controls when they need them, but the default experience should feel effortless.

---

## 4. The Major Bets

These are the architectural commitments that define the system. Each is a bet — a hypothesis that needs validation.

### Bet 1: Curated Knowledge Should Be the Primary Mechanism

The existing translated corpus is mixed quality and not sentence-aligned. At this stage, the system invests in **expert-encoded, human-curated knowledge** as the primary translation guidance mechanism, rather than attempting noisy corpus learning:

- **Glossary** (existing) — Buddhist terms, Sanskrit equivalents, preferred translations per language
- **Style rules** — natural language guidance from senior translators, tagged by content type and language ("the author's humor is self-deprecating — don't flatten it into formal Buddhist English")
- **Golden examples** — hand-picked source/translation pairs that represent ideal quality, used as few-shot examples in prompts
- **Correction patterns** — recurring AI mistakes identified by reviewers or detected automatically, confirmed by humans before entering the knowledge base
- **Content types** — user-defined categories (dharma talk, meditation instruction, poetry, etc.) that determine which rules and examples to apply

**Hypothesis:** Structured knowledge retrieval with modern LLMs will produce translation quality sufficient for the review-based workflow described here. This needs to be validated before scaling.

This does not preclude later use of curated aligned data, embeddings, or other retrieval methods as the corpus matures and alignment becomes feasible. The bet is about what to invest in *first*, not about ruling out complementary approaches.

**Knowledge Precedence:** When different knowledge sources pull in different directions, the system needs a clear hierarchy. From highest to lowest authority:

1. **Doctrinal constraints and glossary entries** — terminological and doctrinal rules are non-negotiable; they override everything below
2. **Explicit style rules** — human-authored guidance from senior translators
3. **Correction patterns** — human-confirmed patterns derived from reviewer corrections
4. **Golden examples** — curated source/translation pairs used as few-shot guidance
5. **Contextual signals** — inferred from surrounding text, prior translations, or book-level analysis

Explicit human-curated rules always take precedence over inferred patterns or contextual signals. If a golden example contradicts a glossary entry, the glossary wins. This hierarchy is part of the product philosophy, not an implementation detail.

**Risk:** Knowledge base maintenance becomes a bottleneck of its own. Style rules may conflict, golden examples may become stale, correction patterns may be too specific or too broad. Content types, if left as a fully open taxonomy, tend to sprawl and undermine retrieval quality and rule consistency. **Mitigation:** Knowledge base health monitoring, rule conflict detection, periodic consolidation. Content types, rules, and examples need curation discipline and periodic review — the knowledge base is a living asset that requires governance, not just growth.

### Bet 2: AI Self-Assessment Can Meaningfully Triage Review Work

The pipeline assigns each translated segment a confidence score and flags specific concerns. High-confidence segments are candidates for lighter review; low-confidence segments get prioritized human attention.

**Hypothesis:** LLM self-assessment, combined with automated QA checks (glossary consistency, coherence, doctrinal sensitivity), can meaningfully separate "likely fine" from "needs human eyes" — reducing the human intervention burden without increasing missed errors. Intervention burden is measured through observable system signals: segment intervention rate (how often reviewers edit auto-approved output), Tier 2 escalation rate, chapter reopen or retranslate rate, and audit survival rate (what fraction of sampled auto-approved segments pass senior reviewer audit).

**Risk: False confidence.** The AI may rate itself highly on translations that are fluent but doctrinally wrong — exactly the failure mode that matters most in this domain. Self-assessment is a convenience heuristic, not a safety guarantee. Mitigation: conservative initial thresholds, mandatory calibration against actual reviewer outcomes, senior reviewer manuscript reads as a second layer regardless of confidence scores.

### Bet 3: Layered Context Produces Better Translation Than Segment-Level Context

Current BITS provides the AI with a few surrounding segments. The new system provides as much context as the model's context window allows, prioritized top-down:

1. Current chapter source text (always)
2. Knowledge base context (glossary, rules, examples, patterns)
3. Book comprehension summary (from a pre-translation analysis pass)
4. Previously translated chapters
5. Full source text of remaining chapters
6. Related passages from other works by the same author
7. Broader True Buddha School corpus

As context windows grow (200K → 1M → 10M tokens), lower-priority layers become eligible for selective inclusion and testing. Larger context does not automatically mean better translation — each layer's value should be validated empirically before it becomes default.

**Hypothesis:** Full-book awareness produces measurably better translation — fewer inconsistencies, better voice coherence, more accurate handling of cross-references and callbacks.

**Risk:** Cost scales with context size. Diminishing returns beyond a certain point. Mitigation: cost tracking per pipeline run, configurable context priorities, A/B comparison of context levels during validation.

### Bet 4: A Feedback Loop Can Drive Continuous Improvement Without Fine-Tuning

Every human correction is a learning opportunity. The system captures corrections passively and surfaces patterns for human confirmation:

- **Passive:** diffs stored automatically when reviewers edit translations, approval/correction ratios tracked per content type and topic
- **Active:** reviewers can tag corrections as teachable moments, nominate golden examples, write explicit rules
- **Pattern detection:** the system analyzes correction history and proposes new rules ("the AI keeps translating X as Y in Z context — should this become a rule?")
- **Calibration:** confidence scores are compared against actual outcomes and thresholds adjust (surfaced as metrics, not changed silently)

**Hypothesis:** This structured feedback loop, without model fine-tuning, produces meaningful improvement over time.

**Measurement:** The top-line measures must be fidelity-centric: **audited high-severity doctrinal error rate** (sampled by senior reviewers on a regular cadence, including auto-approved segments) and **severity-weighted correction rate** (not all corrections are equal — a word choice tweak and a doctrinal fix should not carry the same weight). The secondary measures are observable intervention signals: segment intervention rate, Tier 2 escalation rate, chapter reopen rate, and audit survival rate. Process signals like raw segment counts are useful for operational monitoring but are not evidence of improvement — the system can appear to improve simply because thresholds shifted or reviewers intervened less, while actual fidelity stayed flat.

**Risk: Error propagation.** An early mistake that gets encoded as a rule propagates across chapters and languages. A bad golden example degrades quality everywhere it's used. Mitigation: all learned knowledge requires human confirmation, provenance tracking on every rule, periodic knowledge base audits, ability to trace any translation decision back to the rules that influenced it.

---

## 5. Key Risks

Beyond the per-bet risks above, these are the strategic risks that define guardrails for every implementation phase.

### 5.1 Doctrinal Drift

The most serious risk. The AI produces translations that are fluent and internally consistent but subtly drift from correct doctrine over time. This is hard to detect because each individual translation looks reasonable — the drift is cumulative and gradual.

**Guardrails:** Senior reviewer manuscript reads (Tier 2 review) are the primary defense. These catch drift that segment-level review misses. Additionally, doctrinal sensitivity scanning during post-translation QA flags known sensitive concepts for extra scrutiny. Content types allow different review rigor for doctrinally dense vs. routine content.

### 5.2 False Confidence from Self-Assessment

LLMs are notoriously poor at calibrating their own uncertainty, especially on domain-specific content. A high confidence score may create a false sense of security that reduces reviewer attention.

**Guardrails:** Confidence scores are treated as triage heuristics, never as quality guarantees. Auto-approval thresholds start very conservative and are only loosened based on empirical calibration data. Manuscript-level reads happen regardless of segment-level scores. The dashboard prominently shows calibration metrics (do high-confidence segments actually get approved more often?).

### 5.3 Error Propagation Across Chapters and Languages

A mistake in Chapter 1 that goes undetected can influence the AI's translations in Chapter 2 (via the "previously translated chapters" context layer). A bad English translation used as a pivot can propagate errors into five other languages.

**Guardrails:** Chapter-level QA catches some of this. Pivot translation always cross-references the original Chinese, not just the intermediate language. Knowledge base rules have scope limits (language-specific vs. universal). Languages can be re-run independently if issues are discovered.

**Tentative vs. authoritative context:** The system must distinguish between unreviewed machine output and human-approved output. By default, unreviewed translations from earlier chapters should be treated as tentative context — available to the AI for consistency reference but explicitly marked as unverified, so the model does not treat its own prior guesses as ground truth. Only human-approved translations should serve as authoritative context for subsequent chapters or languages. This distinction is the primary defense against the system compounding its own mistakes.

### 5.4 Knowledge Base Inconsistency

As the knowledge base grows, rules may conflict ("use formal register" vs. "preserve the author's casual humor"), golden examples may represent outdated conventions, and correction patterns may be too narrowly scoped.

**Guardrails:** Rule conflict detection (automated check for contradictory rules on the same terms or content types). Knowledge base health metrics on the dashboard. Periodic human audit of rules. Every rule has provenance (who, when, why) and can be deactivated or edited.

### 5.5 Workload Shape-Shifting

The promise is reduced rework burden, but the risk is that burden merely shifts: from translating to reviewing, from reviewing to knowledge curation, from knowledge curation to debugging AI behavior. The team may not feel the promised relief.

**Guardrails:** Monitor observable intervention patterns across all activities: segment intervention rate, escalation rate, chapter reopen rate, and knowledge base maintenance volume. Supplement with periodic team retrospectives — the system's metrics can look healthy while the team's experience tells a different story. If intervention burden does not decrease, the system is not delivering on its promise — regardless of what process-level metrics suggest.

---

## 6. The Operating Model

### 6.1 The Translation Pipeline

The engine that translates entire projects as background jobs.

**Lifecycle:** Initiation → Pre-flight Analysis → Translation → Post-translation QA → Status Assignment

- **Pre-flight analysis:** AI reads the entire source text. Scans for missing glossary terms, suggests content types per chapter, produces a book-level comprehension summary, and generates a pre-flight report with any blockers. All pre-flight outputs (book summary, structural analysis, content type suggestions) are tentative machine-generated aids — useful for context assembly but not authoritative. They sit below glossary rules, doctrinal constraints, and human-approved translations in the knowledge precedence hierarchy, and should never override them.
- **Translation:** Chapter by chapter, segment by segment. For each segment: assemble knowledge context, assemble text context (layered strategy), call the LLM, run self-assessment, store with confidence score and flags.
- **Post-translation QA:** Per chapter — glossary consistency, coherence check, doctrinal sensitivity scan. Each check produces: pass, flag-for-Tier-1, or flag-for-Tier-2.
- **Status assignment:** Each segment ends as auto-approved, flagged for Tier 1 (quick fix), or flagged for Tier 2 (senior review). **Clarification:** "auto-approved" means no immediate segment-level intervention required — it does *not* mean cleared for publication without manuscript-level human sign-off. Every project still requires human approval before it is considered complete.

Pipeline runs are resumable, configurable, observable (real-time progress and cost), batchable, and cancellable.

### 6.2 Review Interfaces

Three independent interfaces — different lenses on the same data. Users choose per-project, per-task, or per-preference.

**Pipeline Dashboard (Control Room):**
The primary screen. Shows active runs, review queue (flagged segments with AI's specific concerns and quick-action buttons), knowledge base health, fidelity monitoring (calibration metrics, audit survival rate, audited high-severity error trend), and job queue. A reviewer's typical session: glance at dashboard, work through flagged items, check overnight results.

**Manuscript Reader (Editor's Desk):**
For reading a complete translation as flowing prose. Core features: reader view (formatted document, not segments), inline corrections, chapter-level approve/flag, and optional source text alongside. Secondary affordances (valuable but not part of the core bet): confidence heat map, AI margin annotations, conversational AI for asking about translation choices. The strategic point is that review should happen in document form — the reader's feature richness is a separate, lower-priority concern.

**Segment Editor (Deep-Dive Tool):**
The existing BITS TipTap editor. For surgical edits, track changes, and segment-level work. No major changes needed.

### 6.3 Multi-Language Strategy

- **Direct translation** (Chinese → target): default for languages where the model is strong
- **Pivot translation** (Chinese → English → target): for languages where direct quality is weaker; cross-references original Chinese to catch flattened nuance
- **AI-recommended pathway**: system suggests based on model capabilities and historical quality

Cross-language knowledge transfer: once approved in one language, subsequent languages benefit from the approved translation as reference, glossary terms, shared style rules, correction patterns, and content type assignments.

Per-language configuration: own glossary translations, style rules, golden examples, auto-approval thresholds, preferred models, and default pathway.

### 6.4 Feedback Loop

Described in Bet 4 above. The key property: every correction flows through a human-confirmed pipeline before affecting future translations. The system suggests; humans approve; fidelity improves; unnecessary intervention decreases. The measure of success is safer translation with less rework, not simply more untouched segments.

---

## 7. Assumptions to Validate

These are ordered by risk — highest-risk assumptions first, because they should be tested earliest.

1. **AI self-assessment is useful for triage in this domain.** Test: run the pipeline on a small set of already-translated books, compare AI confidence scores against actual reviewer judgments. If calibration is poor, the tiered review model needs adjustment.

2. **The knowledge base approach produces sufficient quality.** Test: translate a few chapters using knowledge-base-enriched prompts vs. current simple prompts. Compare quality with senior reviewer blind evaluation.

3. **Full-book context improves translation quality.** Test: translate the same chapter with segment-level context vs. full-chapter context vs. full-book context. Measure improvement and cost.

4. **The intervention burden decreases without fidelity regression.** Test: compare observable intervention metrics (segment intervention rate, escalation rate, chapter reopen rate) for pipeline-translated projects vs. current manual workflow, while monitoring audited doctrinal error rate to confirm fidelity holds. Supplement with team retrospectives on experienced burden.

5. **The feedback loop reduces high-severity errors over time.** Test: track audited high-severity doctrinal error rate and severity-weighted correction rate across a series of projects. Do fidelity metrics improve? Intervention signals (escalation rate, reopen rate) are supporting context, not the primary evidence.

---

## 8. Phased Delivery

The system should be built incrementally, with each phase delivering usable value and validating assumptions before the next phase begins.

**Phase 1 — Knowledge Base + Enhanced Prompts:**
Build the knowledge base (style rules, golden examples, correction patterns, content types). Integrate into existing single-segment translation. Validate Assumption 2 — does richer knowledge improve quality?

**Phase 2 — Pipeline + Layered Context:**
Build the background translation pipeline with pre-flight analysis and layered context strategy. Validate Assumptions 1 and 3 offline — does the pipeline produce reviewable output? Does more context help? Includes initial calibration of self-assessment confidence scores against senior reviewer judgments, before the system is used operationally.

**Phase 3 — Dashboard + Tier 1 Review:**
Build the pipeline dashboard and review queue. Enable the Tier 1 review workflow. This is the in-production validation of the calibration work from Phase 2: Validate Assumption 4 — does intervention burden decrease without fidelity regression?

**Phase 4 — Manuscript Reader + Tier 2 Review:**
Build the manuscript reader. Enable the full tiered review model. Validate that manuscript reads catch issues segment review misses.

**Phase 5 — Feedback Loop:**
Build passive correction tracking, pattern detection, and active teaching features. Validate Assumption 5 — does the system improve over time? Does the knowledge base grow in useful ways, or does it sprawl?

**Phase 6 — Multi-Language Expansion:**
Enable multi-language pipeline runs with direct and pivot pathways, cross-language knowledge transfer. Validate that the operating model scales across languages with very different quality conditions, reviewer availability, and glossary maturity. This is a distinct bet from the feedback loop — it tests whether the system works at breadth, not just depth.

Each phase can be used independently. Phase 1 improves the existing workflow even if later phases are never built.

### Phase Gates — What Failure Looks Like

Each phase should be evaluated honestly. The system earns expansion by demonstrating results, not by completing features.

**No phase passes if fidelity regresses, even when process metrics improve.** A drop in intervention rates that coincides with a rise in audited doctrinal error rate is a failure, not a success.

- **Phase 1 fails if** knowledge-base-enriched prompts do not materially improve translation quality over current simple prompts, as measured by senior reviewer blind evaluation and severity-weighted correction rate. If so, the knowledge base should stay narrow rather than becoming a major curation burden.
- **Phase 2 fails if** offline calibration shows self-assessment is poorly calibrated — if "high confidence" segments get corrected at severity-weighted rates similar to "low confidence" segments, or if high-confidence segments still hide rare high-severity doctrinal errors at an unacceptable rate. Also fails if richer context does not measurably improve fidelity over segment-level context. If so, the pipeline needs fundamental adjustment before going operational.
- **Phase 3 fails if** live operational use does not reduce intervention burden (segment intervention rate, escalation rate, reopen rate), or if fidelity regresses compared to the current manual workflow as measured by audited high-severity error rate. If so, tiered review should remain manual-first, with humans triaging rather than the AI.
- **Phase 4 fails if** manuscript-level reads do not surface issues that segment-level review misses, as measured by the rate of additional high-severity findings in Tier 2 review. If so, the manuscript reader is a convenience, not a quality gate, and should be treated accordingly.
- **Phase 5 fails if** audited high-severity doctrinal error rate and severity-weighted correction rate do not trend meaningfully downward over a sustained period. Process signals like intervention rates are supporting context. If fidelity metrics stagnate, the feedback loop is capturing noise, not signal.
- **Phase 6 fails if** non-English languages show unacceptable audited error rates or disproportionate intervention burden that negates the throughput promise. If so, multi-language expansion should be selective rather than universal.

---

## Technical Appendix

*Implementation-level detail for engineering reference. Not part of the strategic narrative above.*

### A. Data Model Additions

```
StyleRule:
  id, content (natural language rule text), category (enum: terminology|style|doctrine|formatting),
  content_type_id (FK, nullable — null means "all"), language_id (FK, nullable — null means "all"),
  priority (int), is_active (bool), created_by, created_at, updated_at

GoldenExample:
  id, source_text, translated_text, language_id (FK), content_type_id (FK, nullable),
  notes (why this is exemplary), nominated_by, confirmed_by, created_at

CorrectionPattern:
  id, description (natural language), source_pattern (text to match),
  wrong_translation (what the AI tends to produce), correct_translation (what it should produce),
  context_condition (when this applies, e.g., "in meditation contexts"),
  status (suggested|confirmed|dismissed), detected_count (int),
  created_by (null if auto-detected), confirmed_by, created_at

ContentType:
  id, name, description, is_active, created_by, created_at

PipelineRun:
  id, project_id (FK to BookTranslation), language_id (FK),
  status (enum: pending|pre_flight|translating|qa|completed|failed|cancelled),
  config (JSON: model, auto_approve_threshold, context_priorities, etc.),
  pre_flight_report (JSON), progress (JSON: {total_segments, completed, auto_approved, flagged_t1, flagged_t2}),
  total_tokens_used (int), estimated_cost (decimal),
  started_at, completed_at, created_by, created_at

PipelineSegmentResult:
  id, pipeline_run_id (FK), segment_id (FK), translation_id (FK),
  confidence_score (float 0-1), ai_flags (JSON array of {type, description}),
  review_tier (enum: auto_approved|tier_1|tier_2|null),
  qa_results (JSON: {glossary_check, coherence_check, doctrinal_check}),
  evidence_snapshot (JSON: {glossary_terms_applied, style_rules_applied, golden_examples_used,
    correction_patterns_applied, context_layers_included, prompt_version,
    source_spans_salient (array of {start, end, reason} identifying source regions the model
      was asked to attend to), alternative_candidates (array of alternative translations the
      model was asked to consider or that were generated during self-assessment),
    prompt_hash (immutable hash of the assembled prompt for reproducibility)}),
  tokens_used (int), model_used (str), created_at

ContentTypeAssignment:
  id, chapter_id (FK), content_type_id (FK),
  ai_suggested (bool), confirmed_by (FK, nullable), created_at

ReviewerOutcome:
  id, segment_id (FK), translation_id (FK), pipeline_run_id (FK, nullable),
  reviewer_id (FK), action (enum: approved_as_is|edited|escalated_to_tier2|reopened|retranslated),
  severity (enum: none|low|medium|high_doctrinal — null if approved_as_is),
  before_text, after_text (null if approved_as_is),
  notes (optional reviewer comment on what was wrong),
  tagged_as_teachable (bool), created_at

FidelityAudit:
  id, pipeline_run_id (FK, nullable), language_id (FK),
  auditor_id (FK), audit_type (enum: random_sample|targeted|periodic),
  segments_sampled (int), segments_with_issues (int),
  high_severity_count (int), severity_weighted_score (float),
  findings (JSON array of {segment_id, severity, description}),
  created_at

Note: ReviewerOutcome records every reviewer disposition for computing intervention rates,
severity-weighted correction rates, and escalation patterns. FidelityAudit records periodic
senior-reviewer audits of auto-approved output for computing audited doctrinal error rates.
Together these entities ground the measurement framework described in the strategic narrative.

Note: Content type assignment is keyed to chapter_id as a pragmatic starting point. In practice,
a single chapter may contain multiple registers or modes (e.g., a dharma talk that shifts into
poetry or meditation instruction). Finer-grained assignment (section-level or segment-level) may
become necessary as the system matures. The architecture should not overcommit to chapter-level
uniformity.
```

### B. Codebase Changes

**Keep as-is:** Book/chapter/segment data model, glossary system, authentication and roles, LiteLLM integration, TipTap segment editor, deployment (Railway + Vercel).

**Evolve:** `services/translation/` (prompt assembly becomes knowledge-base-aware), `api/translate.py` (gains pipeline endpoints), frontend routing (dashboard becomes home), data model (new tables above).

**Build new:** `services/pipeline/` (pipeline orchestrator), `services/knowledge/` (knowledge base management), confidence scoring, pipeline dashboard (React), manuscript reader (React), feedback capture system.

In the current data model, `BookTranslation` serves the role of "project" (one per source text per target language). The name may evolve but the entity is the same.

### C. Open Engineering Questions

1. **Background job infrastructure:** Celery + Redis (mature), ARQ (async-native, lighter), or custom queue on existing PostgreSQL.
2. **Manuscript reader technology:** TipTap (familiar, rich editing) or a lighter read-optimized component.
3. **Cost management:** Per-project cost estimates and optional budget caps on pipeline runs.
4. **Glossary gap handling:** When pre-flight detects a missing glossary term — block, proceed with best-guess and flag, or configurable per-project.

### D. Explicitly Deferred

- Vector embeddings / semantic search (start with keyword matching and structured retrieval)
- Model fine-tuning (prompt engineering with structured knowledge first)
- Full corpus alignment of existing mixed-quality translations
- Export/publishing pipeline
- Real-time collaborative editing
