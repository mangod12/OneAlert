"""Spreadsheet presentation protection without changing stored evidence."""

from collections.abc import Iterable


def spreadsheet_safe_row(values: Iterable[object]) -> list[object]:
    """Prefix formula-like text cells, preserving numeric values and CSV quoting.

    Call only for export presentation. Do not write the protected values back
    to the source records. Whitespace can precede a spreadsheet formula marker.
    """
    return [
        "'" + value if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")) else value
        for value in values
    ]
