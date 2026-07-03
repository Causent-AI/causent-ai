"""Adversarial suite for C5 before_after_14d.

Goal: try to BREAK the naive before/after readout. Two prongs:
  1. Numeric truth — compare the shipped numpy CI against scipy as an
     INDEPENDENT oracle (scipy.stats.ttest_ind(..., equal_var=False)), across
     wildly unequal variances, and prove it is genuinely Welch (not pooled).
  2. Robustness — attack boundaries and degenerate/pathological finite inputs.
     The stated contract (see the module docstring) is total on finite series:
     non-finite window -> DEGENERATE, otherwise -> OK. It must NEVER raise on a
     finite input. The xfail tests below document where that promise is broken.

scipy is a TEST-ONLY oracle; the engine is numpy-only.
"""

import math
import sys
import warnings

import numpy as np
import pytest
from scipy import stats

from causal.before_after_14d import before_after_14d
from causal.types import Series

_BASE = 738000


def _mk(pre, post):
    pre = np.asarray(pre, float)
    post = np.asarray(post, float)
    values = np.concatenate([pre, post])
    return Series(_BASE + np.arange(values.size), values, split=pre.size)


def _draw(mu_pre, mu_post, sig_pre, sig_post, seed, n=14):
    rng = np.random.default_rng(seed)
    return rng.normal(mu_pre, sig_pre, n), rng.normal(mu_post, sig_post, n)


# ---------- numeric oracle: independent scipy Welch CI ----------

@pytest.mark.parametrize("seed", range(40))
def test_ci_matches_scipy_welch_confidence_interval(seed):
    # Randomize means AND per-side sigmas so variance ratios span orders of mag.
    rng = np.random.default_rng(1000 + seed)
    sp, sq = 10.0 ** rng.uniform(-2, 2), 10.0 ** rng.uniform(-2, 2)
    pre, post = _draw(rng.uniform(-5, 5), rng.uniform(-5, 5), sp, sq, seed)
    r = before_after_14d(_mk(pre, post))
    assert r.status == "OK"
    res = stats.ttest_ind(post, pre, equal_var=False)
    ci = res.confidence_interval(0.95)
    assert r.lift == pytest.approx(post.mean() - pre.mean(), rel=1e-12, abs=1e-12)
    assert r.ci_low == pytest.approx(ci.low, rel=1e-9, abs=1e-9)
    assert r.ci_high == pytest.approx(ci.high, rel=1e-9, abs=1e-9)


def test_satterthwaite_df_matches_scipy():
    # Recover the df the engine used from its own CI half-width, compare to scipy.
    pre, post = _draw(0.0, 3.0, 0.3, 6.0, seed=77)  # extreme variance asymmetry
    r = before_after_14d(_mk(pre, post))
    n = 14
    vp, vq = pre.var(ddof=1) / n, post.var(ddof=1) / n
    se = math.sqrt(vp + vq)
    tcrit = (r.ci_high - r.lift) / se
    df_engine = _t_df_from_tcrit(tcrit)
    df_scipy = stats.ttest_ind(post, pre, equal_var=False).df
    assert df_engine == pytest.approx(df_scipy, rel=1e-6)


def _t_df_from_tcrit(tcrit, alpha=0.05):
    # invert: find df such that t.ppf(0.975, df) == tcrit
    from scipy.optimize import brentq
    return brentq(lambda d: stats.t.ppf(1 - alpha / 2, d) - tcrit, 1.0, 1e6)


def test_is_welch_not_pooled():
    # With sharply unequal variances the pooled (equal_var=True) CI differs;
    # the engine must track Welch, not the pooled interval.
    pre, post = _draw(0.0, 2.0, 0.2, 5.0, seed=101)
    r = before_after_14d(_mk(pre, post))
    welch = stats.ttest_ind(post, pre, equal_var=False).confidence_interval(0.95)
    pooled = stats.ttest_ind(post, pre, equal_var=True).confidence_interval(0.95)
    assert r.ci_high == pytest.approx(welch.high, rel=1e-9)
    # sanity: the two really are different here, so the match above is meaningful
    assert abs(welch.high - pooled.high) > 1e-3


# ---------- boundary: the 14/side gate ----------

@pytest.mark.parametrize("n_pre,n_post,expect", [
    (14, 14, "OK"),
    (13, 14, "INSUFFICIENT"),
    (14, 13, "INSUFFICIENT"),
    (14, 100, "OK"),       # extra post days ignored, still OK
    (100, 14, "OK"),
    (0, 30, "INSUFFICIENT"),
    (30, 0, "INSUFFICIENT"),
])
def test_window_gate(n_pre, n_post, expect):
    r = before_after_14d(_mk([1.0] * n_pre, [2.0] * n_post))
    assert r.status == expect
    if expect != "OK":
        assert (r.lift, r.ci_low, r.ci_high) == (None, None, None)


def test_split_past_end_is_insufficient():
    v = np.arange(20, dtype=float)
    assert before_after_14d(Series(_BASE + np.arange(20), v, split=50)).status == "INSUFFICIENT"


def test_negative_split_is_insufficient():
    v = np.arange(40, dtype=float)
    assert before_after_14d(Series(_BASE + np.arange(40), v, split=-5)).status == "INSUFFICIENT"


def test_only_uses_14_around_split_not_extra_days():
    pre, post = _draw(2.0, 6.0, 1.0, 1.0, seed=9)
    tight = before_after_14d(_mk(pre, post))
    # 100 post days but only the first 14 count; poison the rest.
    long_post = np.concatenate([post, np.full(86, -1e9)])
    padded = before_after_14d(_mk(pre, long_post))
    assert padded.lift == pytest.approx(tight.lift, abs=1e-12)
    assert padded.ci_high == pytest.approx(tight.ci_high, rel=1e-12)


# ---------- degenerate / small-n robustness (must not raise) ----------

def test_both_windows_constant_zero_width_ci():
    r = before_after_14d(_mk([3.0] * 14, [8.0] * 14))
    assert r.status == "OK"
    assert (r.lift, r.ci_low, r.ci_high) == pytest.approx((5.0, 5.0, 5.0), abs=1e-12)


def test_one_window_constant_df_is_npost_minus_one():
    _, post = _draw(0.0, 5.0, 1.0, 1.5, seed=13)
    r = before_after_14d(_mk([2.0] * 14, post))
    assert r.status == "OK"
    assert math.isfinite(r.ci_low) and math.isfinite(r.ci_high)
    assert r.ci_low < r.lift < r.ci_high
    # Welch df collapses to n_post-1 = 13 when one side has zero variance.
    se = math.sqrt(post.var(ddof=1) / 14)
    tcrit = (r.ci_high - r.lift) / se
    assert tcrit == pytest.approx(stats.t.ppf(0.975, 13), rel=1e-6)


def test_nan_and_inf_in_window_are_degenerate():
    for bad, idx in [(np.nan, 7), (np.inf, 20), (-np.inf, 0)]:
        v = np.concatenate([[1.0] * 14, [2.0] * 14]).astype(float)
        v[idx] = bad
        r = before_after_14d(Series(_BASE + np.arange(28), v, 14))
        assert r.status == "DEGENERATE"
        assert (r.lift, r.ci_low, r.ci_high) == (None, None, None)


def test_nonfinite_outside_windows_ignored():
    pre, post = _draw(1.0, 3.0, 1.0, 1.0, seed=8)
    v = np.concatenate([[np.nan] * 5, pre, post, [np.inf] * 5])
    r = before_after_14d(Series(_BASE + np.arange(v.size), v, split=5 + pre.size))
    assert r.status == "OK"


def test_integer_dtype_series_ok():
    pre = np.arange(14, dtype=np.int64)
    post = np.arange(14, 28, dtype=np.int64)
    r = before_after_14d(Series(_BASE + np.arange(28), np.concatenate([pre, post]), 14))
    assert r.status == "OK"
    assert r.lift == pytest.approx(14.0, abs=1e-12)


def test_tiny_lift_near_float_resolution():
    pre = np.full(14, 1.0)
    post = np.full(14, 1.0 + 1e-9)
    r = before_after_14d(_mk(pre, post))
    assert r.status == "OK"
    assert r.lift == pytest.approx(1e-9, rel=1e-6)


# ---------- ROBUSTNESS DEFECTS: finite input that makes the engine RAISE ----------
# The contract is total on finite series (non-finite -> DEGENERATE, else -> OK).
# A finite bad-data sentinel or a genuinely huge finite metric overflows the
# variance/df arithmetic and throws an UNCAUGHT exception instead of degrading.
# In C9 one poisoned action would take down the whole batch response.

@pytest.mark.xfail(strict=True, reason="C5 raises ValueError on finite float-max "
                   "sentinel: var overflows to inf -> Satterthwaite df=nan -> "
                   "t_ppf(df=nan) raises; contract promises DEGENERATE/OK, not a crash")
def test_float_max_sentinel_does_not_crash():
    warnings.simplefilter("ignore")
    pre = [1.0] * 14
    post = [2.0] * 13 + [sys.float_info.max]  # common ETL 'overflow/missing' sentinel
    ser = _mk(pre, post)
    assert np.isfinite(ser.values).all()      # input IS finite -> not DEGENERATE by contract
    r = before_after_14d(ser)                 # must return, must not raise
    assert r.status in ("OK", "DEGENERATE")


@pytest.mark.xfail(strict=True, reason="C5 raises OverflowError on huge finite "
                   "values: (vp+vq)**2 at line 50 overflows the Python float; "
                   "contract promises a returned status on any finite series")
def test_huge_finite_values_do_not_crash():
    warnings.simplefilter("ignore")
    pre = [0.0, 1e150] * 7
    post = [0.0, 2e150] * 7
    ser = _mk(pre, post)
    assert np.isfinite(ser.values).all()
    r = before_after_14d(ser)
    assert r.status in ("OK", "DEGENERATE")
