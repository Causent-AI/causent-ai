"""C5 — before/after 14-day naive readout, pure numpy.

Why: a descriptive cross-check for the authoritative ITS result. It answers the
plain question "did the level shift?" by comparing the 14 days before the
intervention to the 14 after, with a Welch t interval so the uncertainty stays
honest. It is NON-authoritative — it never drives direction/belief
(decision-graph.md); it lives in the edge detail panel beside ITS, and on
disagreement ITS wins.

Contract: before_after_14d(series) -> BeforeAfterResult, method "BEFORE_AFTER_14D".
  - fewer than 14 points on either side of split -> INSUFFICIENT (lift/ci None)
  - a non-finite value in either 14-day window     -> DEGENERATE   (lift/ci None)
  - otherwise -> OK: lift = post_mean - pre_mean with a 95% Welch t CI
    (unequal variances, Satterthwaite df). Constant windows (zero pooled SE)
    collapse to the exact point estimate (lift, lift), never a fabricated width.
"""

from __future__ import annotations

from math import sqrt

import numpy as np

from causal.t_ppf import t_ppf
from causal.types import BeforeAfterResult, Series

_WINDOW = 14
_ALPHA = 0.05


def before_after_14d(series: Series) -> BeforeAfterResult:
    split = int(series.split)
    n = int(series.values.size)
    if split < _WINDOW or n - split < _WINDOW:
        return BeforeAfterResult("BEFORE_AFTER_14D", "INSUFFICIENT", None, None, None)

    pre = series.values[split - _WINDOW:split].astype(np.float64)
    post = series.values[split:split + _WINDOW].astype(np.float64)
    if not (np.isfinite(pre).all() and np.isfinite(post).all()):
        return BeforeAfterResult("BEFORE_AFTER_14D", "DEGENERATE", None, None, None)

    lift = float(post.mean() - pre.mean())
    # Welch: unequal-variance SE + Satterthwaite df on ddof=1 sample variances.
    vp = float(pre.var(ddof=1)) / _WINDOW
    vq = float(post.var(ddof=1)) / _WINDOW
    se = sqrt(vp + vq)
    if se == 0.0:                       # both windows constant: exact, zero-width
        return BeforeAfterResult("BEFORE_AFTER_14D", "OK", lift, lift, lift)

    df = (vp + vq) ** 2 / (vp * vp + vq * vq) * (_WINDOW - 1)
    half = t_ppf(1.0 - _ALPHA / 2.0, df) * se
    return BeforeAfterResult("BEFORE_AFTER_14D", "OK", lift, lift - half, lift + half)
