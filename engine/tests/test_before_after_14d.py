"""Golden-data + adversarial tests for C5 before_after_14d.

Truth sources: a KNOWN injected lift (noiseless levels recovered exactly), an
independent Welch oracle (scipy.stats.t.ppf for the critical value + the
Satterthwaite df recomputed by hand), and Monte-Carlo coverage — over many draws
a 95% Welch CI must cover the true lift ~95% of the time. scipy is a TEST-ONLY
oracle; the shipped engine is numpy-only (see engine/causal/before_after_14d.py).
"""

import math

import numpy as np
import pytest
from scipy import stats

from causal.before_after_14d import before_after_14d
from causal.types import Series

_BASE = 738000  # arbitrary ordinal-day offset; unused by the naive method


def _series(pre, post):
    pre = np.asarray(pre, float)
    post = np.asarray(post, float)
    values = np.concatenate([pre, post])
    dates = _BASE + np.arange(values.size)
    return Series(dates=dates, values=values, split=pre.size)


def _draw(mu_pre, mu_post, sigma, seed, n=14):
    rng = np.random.default_rng(seed)
    return rng.normal(mu_pre, sigma, n), rng.normal(mu_post, sigma, n)


def _oracle(pre, post, alpha=0.05):
    """Welch difference-of-means CI computed independently via scipy's t.ppf."""
    n = pre.size
    vp = pre.var(ddof=1) / n
    vq = post.var(ddof=1) / n
    se = math.sqrt(vp + vq)
    df = (vp + vq) ** 2 / (vp ** 2 / (n - 1) + vq ** 2 / (n - 1))
    lift = post.mean() - pre.mean()
    half = stats.t.ppf(1.0 - alpha / 2.0, df) * se
    return lift, lift - half, lift + half


# ---------- golden: exact recovery of a KNOWN, noiseless lift ----------

def test_noiseless_levels_recovered_exactly():
    r = before_after_14d(_series([3.0] * 14, [8.0] * 14))
    assert r.status == "OK"
    assert r.lift == pytest.approx(5.0, abs=1e-12)
    # constant windows carry no uncertainty -> zero-width interval at the point.
    assert (r.ci_low, r.ci_high) == pytest.approx((5.0, 5.0), abs=1e-12)


def test_negative_lift_sign():
    r = before_after_14d(_series([10.0] * 14, [4.0] * 14))
    assert r.lift == pytest.approx(-6.0, abs=1e-12)


# ---------- golden: matches an independent Welch oracle ----------

def test_matches_welch_oracle():
    pre, post = _draw(2.0, 5.5, sigma=1.3, seed=7)
    r = before_after_14d(_series(pre, post))
    o_lift, o_lo, o_hi = _oracle(pre, post)
    assert r.lift == pytest.approx(o_lift, rel=1e-12, abs=1e-12)
    assert r.ci_low == pytest.approx(o_lo, rel=1e-9, abs=1e-9)
    assert r.ci_high == pytest.approx(o_hi, rel=1e-9, abs=1e-9)


def test_matches_oracle_unequal_variances():
    # Welch's reason to exist: pre tight, post noisy => asymmetric-variance df.
    pre, post = _draw(0.0, 3.0, sigma=0.4, seed=21)
    _, post_wide = _draw(0.0, 3.0, sigma=4.0, seed=22)
    r = before_after_14d(_series(pre, post_wide))
    _, o_lo, o_hi = _oracle(pre, post_wide)
    assert r.ci_low == pytest.approx(o_lo, rel=1e-9, abs=1e-9)
    assert r.ci_high == pytest.approx(o_hi, rel=1e-9, abs=1e-9)


# ---------- golden: recovery of a known truth via coverage ----------

def test_coverage_is_nominal():
    true_lift = 3.0
    draws, covered = 3000, 0
    for i in range(draws):
        pre, post = _draw(1.0, 1.0 + true_lift, sigma=2.0, seed=i)
        r = before_after_14d(_series(pre, post))
        covered += r.ci_low <= true_lift <= r.ci_high
    rate = covered / draws
    # binomial SE at p=.95, n=3000 is ~0.004; Welch on n=14 sits near nominal.
    assert rate == pytest.approx(0.95, abs=0.02)


# ---------- structure ----------

def test_ci_symmetric_about_lift():
    pre, post = _draw(1.0, 4.0, sigma=1.0, seed=3)
    r = before_after_14d(_series(pre, post))
    assert r.ci_low < r.lift < r.ci_high
    assert (r.lift - r.ci_low) == pytest.approx(r.ci_high - r.lift, rel=1e-12)


def test_uses_only_the_14_days_around_split():
    # Data outside the two windows must not change the readout at all.
    pre, post = _draw(2.0, 6.0, sigma=1.1, seed=9)
    tight = before_after_14d(_series(pre, post))
    padded = before_after_14d(Series(
        dates=_BASE + np.arange(pre.size + post.size + 20),
        values=np.concatenate([[1e6] * 10, pre, post, [-1e6] * 10]),
        split=10 + pre.size,
    ))
    assert padded.lift == pytest.approx(tight.lift, abs=1e-12)
    assert (padded.ci_low, padded.ci_high) == pytest.approx(
        (tight.ci_low, tight.ci_high), rel=1e-12, abs=1e-12)


def test_method_field_and_non_authoritative_shape():
    r = before_after_14d(_series([1.0] * 14, [2.0] * 14))
    assert r.method == "BEFORE_AFTER_14D"


# ---------- boundary ----------

def test_exactly_14_each_side_is_ok():
    pre, post = _draw(0.0, 1.0, sigma=1.0, seed=5)
    assert before_after_14d(_series(pre, post)).status == "OK"


@pytest.mark.parametrize("n_pre,n_post", [(13, 14), (14, 13), (0, 40), (40, 0)])
def test_too_few_on_a_side_is_insufficient(n_pre, n_post):
    r = before_after_14d(_series([1.0] * n_pre if n_pre else [],
                                 [2.0] * n_post if n_post else []))
    assert r.status == "INSUFFICIENT"
    assert (r.lift, r.ci_low, r.ci_high) == (None, None, None)


# ---------- adversarial: degenerate inputs, never a raise ----------

def test_nan_in_window_is_degenerate():
    vals = np.concatenate([[1.0] * 14, [2.0] * 14]).astype(float)
    vals[7] = np.nan  # inside the pre window
    r = before_after_14d(Series(_BASE + np.arange(28), vals, split=14))
    assert r.status == "DEGENERATE"
    assert (r.lift, r.ci_low, r.ci_high) == (None, None, None)


def test_inf_in_post_window_is_degenerate():
    vals = np.concatenate([[1.0] * 14, [2.0] * 14]).astype(float)
    vals[14] = np.inf  # first post point
    r = before_after_14d(Series(_BASE + np.arange(28), vals, split=14))
    assert r.status == "DEGENERATE"


def test_nan_outside_windows_does_not_taint():
    # A non-finite value beyond the 14-day windows is irrelevant -> still OK.
    pre, post = _draw(1.0, 3.0, sigma=1.0, seed=8)
    vals = np.concatenate([[np.nan] * 5, pre, post, [np.inf] * 5])
    r = before_after_14d(Series(_BASE + np.arange(vals.size), vals, split=5 + pre.size))
    assert r.status == "OK"


def test_one_constant_window_still_has_finite_ci():
    # pre constant (var 0), post varies: Welch df collapses to n_post-1, SE>0.
    _, post = _draw(0.0, 5.0, sigma=1.5, seed=13)
    r = before_after_14d(_series([2.0] * 14, post))
    assert r.status == "OK"
    assert math.isfinite(r.ci_low) and math.isfinite(r.ci_high)
    assert r.ci_low < r.lift < r.ci_high
