# SONNET — SHIP PHASE 1 NOW

## Headline Verdict

Phase 1 is a low-risk, independently useful improvement to the existing workflow that generates the only evidence capable of ending the current debate — stop deliberating and start building.

---

## Three Strongest Claims

### Claim 1: The spec has already done the hard intellectual work — further debate is diminishing returns

This is not a naive optimism-driven proposal. Section 3 encodes six non-negotiable principles that constrain every design decision, including the most important: "Quality is the constraint; throughput is the outcome." Section 8's phase gates include explicit failure conditions with fidelity-centric criteria: "No phase passes if fidelity regresses, even when process metrics improve." The spec names its own bets, ranks its own risks, and defines what failure looks like for each phase. That is unusual rigor for a draft. Debating whether this spec is "ready" is now a form of procrastination — the spec was designed to generate evidence, not to achieve a perfection standard in prose form.

### Claim 2: Phase 1 is independently valuable and structurally isolated from all downstream risk

Section 8 states explicitly: "Each phase can be used independently. Phase 1 improves the existing workflow even if later phases are never built." Phase 1 touches only what already exists: `services/translation/prompts.py` (knowledge-context injection) and three new DB tables (StyleRule, GoldenExample, ContentType from Appendix A). There is no pipeline, no background job infrastructure, no confidence scoring, no auto-approval. Every concern about Bet 2 (false confidence from self-assessment), Section 5.3 (error propagation), or Section 5.2 (LLM confidence miscalibration) is a Phase 2+ problem. Phase 1 literally cannot trigger those failure modes. The failure gate for Phase 1 is narrow and legible: "knowledge-base-enriched prompts do not materially improve translation quality over current simple prompts, as measured by senior reviewer blind evaluation" (Section 8). That test is achievable in days.

### Claim 3: The fidelity measurement framework closes the most dangerous loophole in MT system evaluation

The spec does not measure success by segments translated, throughput, or cost-per-word. Bet 4's measurement framework specifies "audited high-severity doctrinal error rate" and "severity-weighted correction rate" as top-line measures, with process signals (intervention rate, escalation rate) explicitly demoted to supporting context: "The system can appear to improve simply because thresholds shifted or reviewers intervened less, while actual fidelity stayed flat." Section 5.5 reinforces this with a direct warning: "If intervention burden does not decrease, the system is not delivering on its promise — regardless of what process-level metrics suggest." This closes the common MT failure mode of optimizing operational efficiency while quality silently erodes. A system with this measurement framework in place before Phase 1 ships is ahead of virtually every MT deployment in production today.

---

## Strongest Counter-Argument and Rebuttal

**Counter-argument:** The knowledge base is a maintenance liability before it delivers value. Style rules may conflict, golden examples go stale, and content types sprawl (Section 4, Bet 1 Risk: "Knowledge base maintenance becomes a bottleneck of its own"). Building the knowledge base infrastructure now locks the team into a curation overhead before they know whether the quality improvement justifies it.

**Rebuttal:** This argument proves too much. The spec anticipates it and mitigates it structurally. Phase 1's failure gate is precisely designed to catch this before the team over-invests: if senior reviewer blind evaluation shows no material improvement, "the knowledge base should stay narrow rather than becoming a major curation burden" (Section 8, Phase 1 failure condition). The team doesn't need twenty style rules and fifty golden examples to run this test — they need three to five of each, applied to a single chapter. One well-chosen pilot chapter (dense dharma content, existing human translation available for comparison) plus a senior reviewer spending two hours on blind evaluation produces a real signal. The maintenance liability argument justifies the Phase 1 pilot; it does not justify skipping Phase 1.

---

## Concrete Recommendation

This week, the team should:

1. **Build the three Phase 1 tables** in `backend/app/core/database.py` `_run_migrations()`: `StyleRule`, `GoldenExample`, `ContentType` per Appendix A. No API endpoints required yet — seed directly.

2. **Seed the knowledge base with a minimal set**: 3-5 style rules authored by the senior translator (register, humor, doctrinal term handling), 5-10 golden examples from an already-approved English chapter, and 2-3 content type labels (dharma talk, meditation instruction, narrative).

3. **Modify `services/translation/prompts.py`** to inject matching style rules and golden examples into the existing single-segment translation prompt. This is a prompt assembly change, not an architecture change.

4. **Select one pilot chapter**: a doctrinally dense chapter from a book with an existing approved human translation — this allows blind comparison. Translate it twice: current prompt vs. knowledge-enriched prompt.

5. **Senior reviewer blind evaluation**: score both outputs on severity-weighted correction rate. This is the Phase 1 gate test. Run it Friday. The result either confirms Phase 2 investment or tells the team to keep the knowledge base narrow. Either outcome is valuable. Continued debate produces neither.
