"""Report durations compare real instants, not wall-clock labels with offsets removed."""
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from backend.routers.reports import _mean_delta_seconds, _naive_utc


def instant(text):
    return datetime.fromisoformat(text)


@pytest.mark.parametrize(('start', 'end', 'seconds'), [
    ('2026-11-21T10:00:00+05:30', '2026-11-21T05:00:00+00:00', 1800),
    ('2026-11-21T04:30:00+00:00', '2026-11-21T11:00:00+05:30', 3600),
    ('2026-11-21T04:30:00', '2026-11-21T11:00:00+05:30', 3600),
    ('2026-11-21T10:00:00+05:30', '2026-11-21T05:30:00', 3600),
    ('2026-11-21T10:00:00+05:30', '2026-11-21T04:30:00+00:00', 0),
    ('2026-11-21T10:00:00+00:00', '2026-11-21T10:00:00', 0),
])
def test_equivalent_instants_and_mixed_legacy_utc_values(start, end, seconds):
    assert _mean_delta_seconds([(instant(start), instant(end))]) == seconds


def test_negative_elapsed_time_is_excluded_even_when_wall_clock_looks_positive():
    start = instant('2026-11-21T10:00:00+00:00')
    end = instant('2026-11-21T11:00:00+05:30')
    assert _mean_delta_seconds([(start, end)]) is None
    assert _mean_delta_seconds([(start, end), (None, end), (start, None),
                                (start, instant('2026-11-21T11:00:00+00:00'))]) == 3600


def test_dst_fold_uses_elapsed_hour_instead_of_equal_wall_clocks():
    zone = ZoneInfo('America/New_York')
    first = datetime(2026, 11, 1, 1, 30, tzinfo=zone, fold=0)
    second = datetime(2026, 11, 1, 1, 30, tzinfo=zone, fold=1)
    assert _mean_delta_seconds([(first, second)]) == 3600


def test_window_comparison_normalizes_offset_before_dropping_timezone():
    assert _naive_utc(instant('2026-11-21T01:30:00+05:30')) == instant('2026-11-20T20:00:00')
    naive = instant('2026-11-21T10:00:00')
    assert _naive_utc(naive) == naive
    assert _naive_utc(naive.replace(tzinfo=UTC)) == naive
    assert _mean_delta_seconds([]) is None
