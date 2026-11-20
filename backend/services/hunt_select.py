"""Compile the documented hunt SELECT subset, never raw generated SQL."""

import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import or_, select

_TOKEN = re.compile(r"\s+|'(?:[^']|'')*'|:[A-Za-z_]\w*|[A-Za-z_]\w*|\d+|>=|<=|!=|<>|[=><(),*]")


@dataclass
class CompiledHuntSelect:
    query: Any
    evidence: dict


class _Parser:
    def __init__(self, sql, params, columns, equality_columns, text_columns, time_bounds):
        if not isinstance(sql, str) or len(sql) > 12000 or not isinstance(params, dict):
            raise ValueError("Hunt query must be text with an object of parameters")
        self.tokens = []
        position = 0
        while position < len(sql):
            match = _TOKEN.match(sql, position)
            if not match:
                raise ValueError("Unsupported hunt SQL syntax; use the documented simple SELECT subset")
            text = match.group()
            position = match.end()
            if text.isspace():
                continue
            kind = (
                "string"
                if text.startswith("'")
                else "param"
                if text.startswith(":")
                else "word"
                if text[0].isalpha() or text[0] == "_"
                else "number"
                if text.isdigit()
                else "symbol"
            )
            self.tokens.append((kind, text))
            if len(self.tokens) > 512:
                raise ValueError("Hunt query is too complex")
        self.index = 0
        self.params = params
        self.columns = columns
        self.equality_columns = equality_columns
        self.text_columns = text_columns
        self.time_bounds = time_bounds

    def accept(self, text):
        if self.index < len(self.tokens):
            kind, value = self.tokens[self.index]
            if kind not in {"string", "number"} and (
                value == text if kind == "param" else value.lower() == text.lower()
            ):
                self.index += 1
                return True
        return False

    def expect(self, text):
        if not self.accept(text):
            raise ValueError(f"Unsupported hunt query: expected {text}")

    def take(self, kind):
        if self.index >= len(self.tokens) or self.tokens[self.index][0] != kind:
            raise ValueError(f"Unsupported hunt query: expected {kind}")
        value = self.tokens[self.index][1]
        self.index += 1
        return value

    def literal(self):
        value = self.take("string")[1:-1].replace("''", "'")
        if len(value) > 2048:
            raise ValueError("Hunt literal is too long")
        return value

    def predicate(self):
        if self.accept("("):
            # The only supported OR is this explicitly grouped keyword search.
            for token in ("signature", "LIKE", ":keyword", "OR", "category", "LIKE", ":keyword", ")"):
                self.expect(token)
            value = self.params.get("keyword")
            if not isinstance(value, str) or not value or len(value) > 2048:
                raise ValueError("The :keyword parameter must be nonempty text of at most 2048 characters")
            return or_(self.columns["signature"].like(value), self.columns["category"].like(value))
        name = self.take("word").lower()
        if name == "timestamp":
            if self.accept(">="):
                self.expect(":since")
                key = "since"
            else:
                self.expect("<")
                self.expect(":before")
                key = "before"
            if key not in self.time_bounds:
                raise ValueError("Timestamp predicates require validated aware :since/:before parameters")
            column = self.columns["timestamp"]
            return column >= self.time_bounds[key] if key == "since" else column < self.time_bounds[key]
        if name == "severity" and self.accept("IN"):
            self.expect("(")
            values = [self.literal()]
            while self.accept(","):
                values.append(self.literal())
            self.expect(")")
            if len(values) > 10:
                raise ValueError("A hunt severity list supports at most ten values")
            return self.columns[name].in_(values)
        if name in self.equality_columns and self.accept("="):
            return self.columns[name] == self.literal()
        if name in self.text_columns and self.accept("LIKE"):
            return self.columns[name].like(self.literal())
        raise ValueError(
            "Unsupported hunt predicate; use documented literal equality, LIKE, severity IN or time bounds"
        )

    def parse(self, owner_column, owner_id, default_columns):
        self.expect("SELECT")
        if self.accept("*"):
            selected = list(default_columns)
        else:
            selected = [self.take("word").lower()]
            while self.accept(","):
                selected.append(self.take("word").lower())
        if any(name not in self.columns for name in selected) or len(selected) != len(set(selected)):
            raise ValueError("Select only unique supported hunt columns; expressions and aliases are not supported")
        self.expect("FROM")
        self.expect("security_events")
        self.expect("WHERE")
        self.expect("user_id")
        self.expect("=")
        self.expect(":user_id")
        conditions = []
        while self.accept("AND"):
            conditions.append(self.predicate())
        order_name, direction = "timestamp", "DESC"
        if self.accept("ORDER"):
            self.expect("BY")
            order_name = self.take("word").lower()
            if order_name not in self.columns:
                raise ValueError("Order by a supported hunt column")
            direction = "DESC" if self.accept("DESC") else "ASC"
            if direction == "ASC":
                self.accept("ASC")
        requested_limit = None
        if self.accept("LIMIT"):
            raw_limit = self.take("number")
            if len(raw_limit) > 9 or int(raw_limit) < 1:
                raise ValueError("Hunt LIMIT must be a positive integer")
            requested_limit = int(raw_limit)
        if self.index != len(self.tokens):
            raise ValueError(
                "Unsupported trailing hunt SQL; joins, OR/NOT, expressions and extra clauses are not supported"
            )
        limit = min(requested_limit or 100, 100)
        query = select(*[self.columns[name].label(name) for name in selected]).where(
            owner_column == owner_id, *conditions
        )
        order_column = self.columns[order_name]
        query = query.order_by(order_column.desc() if direction == "DESC" else order_column.asc())
        if order_name != "id":
            query = query.order_by(self.columns["id"].desc() if direction == "DESC" else self.columns["id"].asc())
        return CompiledHuntSelect(
            query.limit(limit),
            {
                "contract": "scoped_select_v1",
                "selected_columns": selected,
                "tie_breaker": None if order_name == "id" else {"column": "id", "direction": direction},
                "order_by": order_name,
                "direction": direction,
                "requested_limit": requested_limit,
                "row_limit": limit,
            },
        )


def compile_hunt_select(
    sql, params, owner_id, owner_column, columns, default_columns, equality_columns, text_columns, time_bounds
):
    """Parse every token before building an owner-bound SQLAlchemy SELECT."""
    if not isinstance(owner_id, int) or isinstance(owner_id, bool) or owner_id < 1:
        raise ValueError("A verified hunt owner is required")
    parser = _Parser(sql, params, columns, equality_columns, text_columns, time_bounds)
    return parser.parse(owner_column, owner_id, default_columns)
