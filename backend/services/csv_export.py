"""Spreadsheet presentation protection without changing stored evidence."""

from collections.abc import Iterable


def spreadsheet_safe_row(values: Iterable[object]) -> list[object]:
    """Prefix formula-like text cells, preserving numeric values and CSV quoting.

    Call only for export presentation. Do not write the protected values back
    to the source records. Whitespace can precede a spreadsheet formula marker.
    """
    protected = []
    for value in values:
        if isinstance(value, str):
            start = 0
            while start < len(value) and (ord(value[start]) <= 32 or value[start].isspace()):
                start += 1
            if value[start:].startswith(("=", "+", "-", "@")):
                value = "'" + value
        protected.append(value)
    return protected
