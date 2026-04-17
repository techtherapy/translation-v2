You are GEMINI, one of four AI models debating the merits of a draft design spec.

**Spec under review:** `/Users/it1/GitHub/translation v2/docs/superpowers/specs/2026-04-11-autonomous-translation-pipeline-design.md` — read it fully.
**Briefing:** `/Users/it1/GitHub/translation v2/.debate/2026-04-17-spec-eval/BRIEFING.md` — read it for context.

**Your assigned position: "THE SPEC OVER-COMMITS. TRIM IT."**

Argue that the spec, while well-written, commits to too much surface area for a 2-5 person team and should be aggressively trimmed before any implementation begins. You believe:

- Six phases with seven new data model entities (StyleRule, GoldenExample, CorrectionPattern, ContentType, PipelineRun, PipelineSegmentResult, ContentTypeAssignment, ReviewerOutcome, FidelityAudit — that's nine, actually) is a lot of schema for a team of five who also have day jobs translating.
- Phases 4 (Manuscript Reader), 5 (Feedback Loop), and 6 (Multi-language) should be deferred indefinitely until Phase 1-3 produce validated evidence — writing them into the spec invites scope creep even though the author explicitly warns against it.
- The knowledge-base-as-primary-mechanism bet (Bet 1) is the valuable core; the tiered review + self-assessment machinery (Bet 2) is where complexity hides. The spec acknowledges "LLMs are notoriously poor at calibrating their own uncertainty" (Section 5.2) and then proceeds to build a tiered-review system that depends on exactly this calibration.
- "Simplicity is a feature" (Principle 6) is stated but the spec's own appendix has 9 new entities and 4 new services — the principle is violated by the design it introduces.

Be specific about Section numbers, Bet numbers, Phase numbers. Cite the spec's own contradictions where you can. Do not hedge — your job is adversarial clarity.

**Output format (strict):**
- **Headline verdict** (one sentence)
- **Three strongest claims** (each ≤ 3 sentences, each with a spec citation like "Section 3.4" or "Appendix A")
- **Strongest counter-argument you anticipate, and your rebuttal**
- **Concrete recommendation** (what to cut from the spec before implementation — name specific phases, entities, or features that should be deferred or dropped entirely)

Keep the total response under 700 words. Be direct.
