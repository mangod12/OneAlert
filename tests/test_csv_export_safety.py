import csv
import io

import pytest

from backend.services.csv_export import spreadsheet_safe_row


@pytest.mark.parametrize('text', ['=1+1', '+cmd', '-1+2', '@SUM(1)', '  =1', '\t+cmd', '\r@cmd', '\n-cmd', '\u2003=1'])
def test_formula_like_text_is_protected_without_rewriting_source(text):
    row = [text, 0, -5, 2.75, None]
    protected = spreadsheet_safe_row(row)
    assert protected == ["'" + text, 0, -5, 2.75, None]
    assert row == [text, 0, -5, 2.75, None]


@pytest.mark.parametrize('text', [
    '', 'normal', 'a=b', "'already literal", 'two, cells',
    'line1\nline2', 'a "quoted" value', '  plain text',
])
def test_normal_csv_text_round_trips_unchanged(text):
    buffer = io.StringIO()
    csv.writer(buffer).writerow(spreadsheet_safe_row([text, 0, -3]))
    assert next(csv.reader(io.StringIO(buffer.getvalue()))) == [text, '0', '-3']


def test_spreadsheet_text_protection_includes_ignored_control_prefixes():
    from backend.services.csv_export import spreadsheet_safe_row
    assert spreadsheet_safe_row(["\x00=1+1", "\x1f@cmd", "\u2003+cmd", 0, -2, False]) == [
        "'\x00=1+1", "'\x1f@cmd", "'\u2003+cmd", 0, -2, False,
    ]
