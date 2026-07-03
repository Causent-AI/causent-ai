"""Golden-data + adversarial tests for C2 segmented_ols.

Truth: known coefficients recovered from noise-free data (the golden case), and
scipy.linalg as an independent OLS oracle for coeffs + covariance. Statistical
validity is checked by Monte Carlo — the reported cov must match the empirical
spread of the step estimate. scipy is a TEST-ONLY oracle; the engine is numpy.
"""

import numpy as np
import pytest
from scipy import linalg as sla

from causal.segmented_ols import segmented_ols
from causal.types import Series

_BASE = 738000  # arbitrary ordinal-day offset; centering must absorb it


def _design(dates, split):
    """Mirror of the spec's design matrix, built independently for the oracle."""
    t = dates.astype(np.float64)
    post = np.arange(t.size) >= split
    cols = [np.ones(t.size), t - t.mean(), post.astype(np.float64)]
    if split >= 28 and t.size - split >= 28:
        cols.append(np.where(post, t - t[split], 0.0))
    return np.column_stack(cols)


def _make(n_pre, n_post, truth, sigma=0.0, seed=0):
    n = n_pre + n_post
    dates = _BASE + np.arange(n)
    X = _design(dates, n_pre)
    y = X @ np.asarray(truth, float)
    if sigma:
        y = y + np.random.default_rng(seed).normal(0.0, sigma, n)
    return Series(dates=dates, values=y, split=n_pre)


# ---------- golden: recovery of a known truth ----------

def test_recovers_four_segment_truth():
    truth = [10.0, 0.5, -3.0, 0.25]  # level, pre_slope, step, post_slope
    fit = segmented_ols(_make(40, 40, truth))
    assert fit.coeffs.shape == (4,)
    assert fit.coeffs == pytest.approx(truth, abs=1e-6)
    assert not fit.degenerate
    assert fit.n_pre == 40 and fit.n_post == 40
    assert fit.resid_var == pytest.approx(0.0, abs=1e-12)


def test_recovers_three_segment_truth():
    truth = [4.0, -0.2, 7.5]  # no post_slope column when a side < 28
    fit = segmented_ols(_make(40, 10, truth))
    assert fit.coeffs.shape == (3,)
    assert fit.coeffs == pytest.approx(truth, abs=1e-6)
    assert not fit.degenerate


def test_matches_scipy_oracle():
    truth = [2.0, 0.3, 5.0, -0.1]
    s = _make(50, 45, truth, sigma=1.5, seed=7)
    fit = segmented_ols(s)
    X = _design(s.dates, s.split)
    beta, *_ = sla.lstsq(X, s.values)
    assert fit.coeffs == pytest.approx(beta, rel=1e-8, abs=1e-8)
    # covariance: sigma^2 * inv(X'X), independent inverse.
    dof = s.values.size - X.shape[1]
    resid = s.values - X @ beta
    cov = (resid @ resid / dof) * sla.inv(X.T @ X)
    assert fit.cov == pytest.approx(cov, rel=1e-7, abs=1e-9)
    assert fit.resid_var == pytest.approx(resid @ resid / dof, rel=1e-9)


def test_cov_matches_monte_carlo():
    # The reported SE of the step must match its empirical spread over noise draws.
    truth = [1.0, 0.1, 4.0, 0.0]
    sigma, draws = 2.0, 4000
    est = np.empty(draws)
    reported = np.empty(draws)
    for i in range(draws):
        fit = segmented_ols(_make(35, 35, truth, sigma=sigma, seed=i))
        est[i] = fit.coeffs[2]
        reported[i] = np.sqrt(fit.cov[2, 2])
    assert est.mean() == pytest.approx(truth[2], abs=0.1)      # unbiased
    assert est.std() == pytest.approx(reported.mean(), rel=0.05)  # calibrated SE


def test_resid_var_recovers_noise():
    fit = segmented_ols(_make(300, 300, [0.0, 0.0, 1.0, 0.0], sigma=3.0, seed=1))
    assert fit.resid_var == pytest.approx(9.0, rel=0.1)  # sigma^2


# ---------- boundary: the >=28-per-side gate ----------

@pytest.mark.parametrize("n_pre,n_post,k", [
    (28, 28, 4),   # both exactly at the floor -> post_slope fitted
    (27, 28, 3),   # pre just under -> dropped
    (28, 27, 3),   # post just under -> dropped
    (100, 27, 3),
])
def test_post_slope_gate(n_pre, n_post, k):
    truth = [1.0, 0.1, 2.0] + ([0.3] if k == 4 else [])
    fit = segmented_ols(_make(n_pre, n_post, truth))
    assert fit.coeffs.shape == (k,)
    assert fit.n_pre == n_pre and fit.n_post == n_post
    assert not fit.degenerate


# ---------- adversarial: degenerate inputs never raise / never NaN ----------

def _no_nan(fit):
    assert not np.isnan(fit.coeffs).any()
    assert not np.isnan(fit.cov).any()
    assert not np.isnan(fit.resid_var)


def test_flat_metric_is_degenerate():
    n = 60
    dates = _BASE + np.arange(n)
    fit = segmented_ols(Series(dates, np.full(n, 5.0), split=30))
    assert fit.degenerate
    _no_nan(fit)


def test_split_at_start_is_degenerate():
    # split=0 => D is all ones, collinear with the intercept (rank-deficient).
    fit = segmented_ols(_make(0, 50, [1.0, 0.1, 2.0]))
    assert fit.degenerate
    assert fit.cond_number > _COND_MAX_PROBE
    _no_nan(fit)


def test_split_at_end_is_degenerate():
    # split=n => D is all zeros (a null column), rank-deficient.
    n = 50
    dates = _BASE + np.arange(n)
    y = np.linspace(0, 10, n)
    fit = segmented_ols(Series(dates, y, split=n))
    assert fit.degenerate
    _no_nan(fit)


def test_too_few_points_is_degenerate():
    dates = _BASE + np.arange(2)
    fit = segmented_ols(Series(dates, np.array([1.0, 2.0]), split=1))
    assert fit.degenerate
    assert fit.coeffs.shape == (3,)
    _no_nan(fit)


def test_nan_input_is_degenerate_not_raised():
    n = 60
    dates = _BASE + np.arange(n)
    y = np.linspace(0, 10, n)
    y[5] = np.nan
    fit = segmented_ols(Series(dates, y, split=30))
    assert fit.degenerate
    _no_nan(fit)


def test_inf_input_is_degenerate_not_raised():
    n = 60
    dates = _BASE + np.arange(n)
    y = np.linspace(0, 10, n)
    y[10] = np.inf
    fit = segmented_ols(Series(dates, y, split=30))
    assert fit.degenerate
    _no_nan(fit)


_COND_MAX_PROBE = 1e10  # keep in step with segmented_ols._COND_MAX
