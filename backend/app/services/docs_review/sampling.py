"""Reproducible audit selection; persist the returned IDs with the run."""

import random


def select_audit(block_ids, flagged_ids, count, seed):
    eligible = sorted(set(block_ids) - set(flagged_ids))
    return random.Random(seed).sample(eligible, min(count, len(eligible)))  # noqa: S311 -- reproducible audits, not secrets
