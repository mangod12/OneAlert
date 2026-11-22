"""Exact saved-field query scope shared by lists, exports and saved views."""

from typing import Literal

RecordedEventField = Literal["username", "hostname", "domain", "action"]
RECORDED_EVENT_FIELDS = ("username", "hostname", "domain", "action")


def validate_recorded_filter(field, value):
    if field is None and value is None:
        return
    if (
        field not in RECORDED_EVENT_FIELDS
        or not isinstance(value, str)
        or not value.strip()
        or len(value) > 1024
        or "\0" in value
        or any(0xD800 <= ord(char) <= 0xDFFF for char in value)
    ):
        raise ValueError("Choose one supported recorded field and nonblank exact text of at most 1,024 characters")
