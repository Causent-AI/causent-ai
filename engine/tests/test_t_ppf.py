"""Golden-data + adversarial tests for C1 t_ppf.

Truth source: scipy.stats.t.ppf (oracle, tests-only) plus closed forms
(Cauchy df=1, and the df->inf normal limit). scipy is NEVER imported by the
shipped engine — see engine/causal/t_ppf.py.
"""

import math

import numpy as np
import pytest
from scipy import stats

from causal.t_ppf import t_ppf

TOL = 1e-9  # abs error vs scipy oracle across the tested grid


@pytest.mark.parametrize("df", [1.0, 2.0, 2.5, 5.0, 10.0, 30.0, 100.0, 1000.0])
@pytest.mark.parametrize("p", [1e-6, 1e-4, 0.001, 0.01, 0.05, 0.25, 0.4,
                               0.6, 0.75, 0.95, 0.99, 0.999, 0.9999])
def test_matches_scipy_oracle(p, df):
    assert t_ppf(p, df) == pytest.approx(stats.t.ppf(p, df), abs=TOL, rel=1e-9)


def test_cauchy_closed_form():
    # df=1 is the Cauchy: quantile = tan(pi*(p-0.5)).
    for p in (0.1, 0.3, 0.5, 0.75, 0.9):
        assert t_ppf(p, 1.0) == pytest.approx(math.tan(math.pi * (p - 0.5)), abs=1e-9)


def test_common_critical_values():
    # Two-sided 95% t-critical values, textbook-known.
    assert t_ppf(0.975, 1.0) == pytest.approx(12.7062047, abs=1e-6)
    assert t_ppf(0.975, 10.0) == pytest.approx(2.2281389, abs=1e-6)
    assert t_ppf(0.975, 30.0) == pytest.approx(2.0422725, abs=1e-6)


def test_normal_limit():
    # Large df collapses to the standard normal quantile.
    for p in (0.025, 0.5, 0.975):
        assert t_ppf(p, 1e7) == pytest.approx(stats.norm.ppf(p), abs=1e-4)


def test_median_is_zero():
    for df in (1.0, 4.0, 50.0):
        assert t_ppf(0.5, df) == 0.0


def test_antisymmetry():
    # Antisymmetric up to the floating-point representation of (1 - p).
    for df in (1.0, 3.0, 7.5, 200.0):
        for p in (1e-5, 0.02, 0.3, 0.49):
            assert t_ppf(p, df) == pytest.approx(-t_ppf(1.0 - p, df), rel=1e-9, abs=1e-12)


def test_monotonic_in_p():
    ps = np.linspace(1e-6, 1 - 1e-6, 400)
    for df in (1.0, 4.0, 40.0):
        vals = [t_ppf(p, df) for p in ps]
        assert all(b > a for a, b in zip(vals, vals[1:]))


def test_boundaries_are_infinite():
    assert t_ppf(0.0, 5.0) == float("-inf")
    assert t_ppf(1.0, 5.0) == float("inf")


def test_invalid_df_raises():
    for df in (0.0, -1.0, float("nan")):
        with pytest.raises(ValueError):
            t_ppf(0.5, df)


def test_invalid_p_raises():
    for p in (-0.1, 1.1, float("nan")):
        with pytest.raises(ValueError):
            t_ppf(p, 5.0)
