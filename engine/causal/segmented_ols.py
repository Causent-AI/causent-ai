"""C2 — segmented OLS for interrupted time series, pure numpy.

Why: the authoritative ITS readout (C4) needs the level shift at the intervention
plus its covariance. This fits that segmented regression once and hands the raw
solve (coeffs + cov + diagnostics) downstream, so belief can be recomputed later
without re-running the engine (see decision-graph.md, "capture raw stats now").

Contract: segmented_ols(series) -> Fit for the model
    y = level + pre_slope * t_centered + step * D  [ + post_slope * (t - t_split)*D ]
  D = 1 on/after `split`. The post_slope column is fitted ONLY when each side has
  >= 28 points (else it is unidentifiable / noisy), so coeffs is length 3 or 4.
  t is centered to decorrelate level from slope and keep the design well-conditioned.

Invariant: degenerate inputs return a defined Fit with degenerate=True — never a
raise, never NaN. Degenerate = too few points, rank-deficient design (e.g. split
at an end collapses D into the intercept), condition number past _COND_MAX, or a
flat metric (variance below _VAR_FLOOR) that carries no signal to explain.
"""

from __future__ import annotations

import numpy as np

from causal.types import Fit, Series

_MIN_SEG = 28       # min points per side to identify a separate post-slope
_COND_MAX = 1e10    # design condition number above this => unreliable solve
_VAR_FLOOR = 1e-10  # metric variance below this => no signal to explain


def segmented_ols(series: Series) -> Fit:
    y = series.values.astype(np.float64)
    t = series.dates.astype(np.float64)
    n = y.size
    split = int(series.split)
    n_pre, n_post = split, n - split

    post = np.arange(n) >= split
    cols = [np.ones(n), t - t.mean(), post.astype(np.float64)]
    if n_pre >= _MIN_SEG and n_post >= _MIN_SEG:
        cols.append(np.where(post, t - t[split], 0.0))
    X = np.column_stack(cols)
    k = X.shape[1]

    if n < k or not (np.isfinite(y).all() and np.isfinite(X).all()):
        return Fit(np.zeros(k), np.zeros((k, k)), float("inf"),
                   float("inf"), n_pre, n_post, True)

    coeffs, _, rank, s = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ coeffs
    dof = n - rank
    cond = float(s[0] / s[-1]) if s[-1] > 0.0 else float("inf")
    resid_var = float(resid @ resid / dof) if dof > 0 else float("inf")
    cov = resid_var * np.linalg.pinv(X.T @ X)

    degenerate = bool(
        rank < k or cond > _COND_MAX or dof <= 0 or float(y.var()) < _VAR_FLOOR
    )
    return Fit(coeffs, cov, resid_var, cond, n_pre, n_post, degenerate)
