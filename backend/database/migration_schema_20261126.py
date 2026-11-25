"""Frozen additive schema for the 17 model tables omitted from the original chain.

Do not replace this with live model metadata: historical migrations must stay stable.
Existing tables are never rewritten. Unexpected partial schemas need manual review.
"""

import sqlalchemy as sa

from alembic import op


def upgrade_missing_tables() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "agent_runs" not in existing:
        op.create_table(
            "agent_runs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("agent_type", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("model_used", sa.String(), nullable=True),
            sa.Column("prompt_tokens", sa.Integer(), nullable=True),
            sa.Column("completion_tokens", sa.Integer(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("result_summary", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_agent_runs_id"), "agent_runs", ["id"], unique=False)
    if "api_tokens" not in existing:
        op.create_table(
            "api_tokens",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=80), nullable=False),
            sa.Column("prefix", sa.String(length=12), nullable=False),
            sa.Column("salt", sa.String(length=32), nullable=False),
            sa.Column("token_hash", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("last_used_at", sa.DateTime(), nullable=True),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("read_only", sa.Boolean(), server_default="0", nullable=False),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_api_tokens_id"), "api_tokens", ["id"], unique=False)
        op.create_index(op.f("ix_api_tokens_prefix"), "api_tokens", ["prefix"], unique=False)
        op.create_index(op.f("ix_api_tokens_token_hash"), "api_tokens", ["token_hash"], unique=False)
        op.create_index(op.f("ix_api_tokens_user_id"), "api_tokens", ["user_id"], unique=False)
    if "cases" not in existing:
        op.create_table(
            "cases",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("assigned_to_id", sa.Integer(), nullable=True),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("summary", sa.Text(), nullable=True),
            sa.Column("severity", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("confidence_score", sa.Float(), nullable=True),
            sa.Column("mitre_tactics", sa.JSON(), nullable=True),
            sa.Column("mitre_techniques", sa.JSON(), nullable=True),
            sa.Column("attack_narrative", sa.Text(), nullable=True),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("resolution", sa.Text(), nullable=True),
            sa.Column("sla_breach_notified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sla_due_soon_notified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["assigned_to_id"],
                ["users.id"],
            ),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_cases_id"), "cases", ["id"], unique=False)
    if "detection_rules" not in existing:
        op.create_table(
            "detection_rules",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("rule_type", sa.String(), nullable=False),
            sa.Column("rule_content", sa.Text(), nullable=False),
            sa.Column("mitre_techniques", sa.JSON(), nullable=True),
            sa.Column("confidence", sa.String(), nullable=True),
            sa.Column("tested", sa.Boolean(), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=True),
            sa.Column("created_by", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_detection_rules_id"), "detection_rules", ["id"], unique=False)
    if "event_sources" not in existing:
        op.create_table(
            "event_sources",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("source_type", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("event_count", sa.Integer(), nullable=True),
            sa.Column("last_event_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_event_sources_id"), "event_sources", ["id"], unique=False)
    if "hunt_sessions" not in existing:
        op.create_table(
            "hunt_sessions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("hypothesis", sa.Text(), nullable=False),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("queries_run", sa.Integer(), nullable=True),
            sa.Column("findings_count", sa.Integer(), nullable=True),
            sa.Column("result_data", sa.JSON(), nullable=True),
            sa.Column("sigma_rule", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_hunt_sessions_id"), "hunt_sessions", ["id"], unique=False)
    if "validation_runs" not in existing:
        op.create_table(
            "validation_runs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("mode", sa.String(), nullable=True),
            sa.Column("scope", sa.JSON(), nullable=True),
            sa.Column("mitre_techniques", sa.JSON(), nullable=True),
            sa.Column("results_summary", sa.JSON(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("approved_by", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_validation_runs_id"), "validation_runs", ["id"], unique=False)
    if "agent_steps" not in existing:
        op.create_table(
            "agent_steps",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("run_id", sa.Integer(), nullable=False),
            sa.Column("step_number", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(), nullable=False),
            sa.Column("input_summary", sa.Text(), nullable=True),
            sa.Column("output_summary", sa.Text(), nullable=True),
            sa.Column("tool_used", sa.String(), nullable=True),
            sa.Column("duration_ms", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_agent_steps_id"), "agent_steps", ["id"], unique=False)
    if "case_tasks" not in existing:
        op.create_table(
            "case_tasks",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("case_id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("done", sa.Boolean(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("assignee_id", sa.Integer(), nullable=True),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("due_soon_notified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("overdue_notified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["assignee_id"],
                ["users.id"],
            ),
            sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["created_by_id"],
                ["users.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_case_tasks_case_id"), "case_tasks", ["case_id"], unique=False)
        op.create_index(op.f("ix_case_tasks_id"), "case_tasks", ["id"], unique=False)
    if "case_timeline" not in existing:
        op.create_table(
            "case_timeline",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("case_id", sa.Integer(), nullable=False),
            sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("entry_type", sa.String(), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("source", sa.String(), nullable=True),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_case_timeline_id"), "case_timeline", ["id"], unique=False)
    if "response_plans" not in existing:
        op.create_table(
            "response_plans",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("case_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("actions", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("autonomy_level", sa.String(), nullable=True),
            sa.Column("created_by", sa.String(), nullable=True),
            sa.Column("approved_by", sa.Integer(), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(
                ["case_id"],
                ["cases.id"],
            ),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_response_plans_id"), "response_plans", ["id"], unique=False)
    if "security_events" not in existing:
        op.create_table(
            "security_events",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("source_id", sa.Integer(), nullable=True),
            sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
            sa.Column("event_type", sa.String(), nullable=False),
            sa.Column("severity", sa.String(), nullable=True),
            sa.Column("signature", sa.String(), nullable=True),
            sa.Column("signature_id", sa.String(), nullable=True),
            sa.Column("category", sa.String(), nullable=True),
            sa.Column("source_ip", sa.String(), nullable=True),
            sa.Column("source_port", sa.Integer(), nullable=True),
            sa.Column("dest_ip", sa.String(), nullable=True),
            sa.Column("dest_port", sa.Integer(), nullable=True),
            sa.Column("protocol", sa.String(), nullable=True),
            sa.Column("action", sa.String(), nullable=True),
            sa.Column("hostname", sa.String(), nullable=True),
            sa.Column("username", sa.String(), nullable=True),
            sa.Column("domain", sa.String(), nullable=True),
            sa.Column("url", sa.String(), nullable=True),
            sa.Column("user_agent", sa.String(), nullable=True),
            sa.Column("bytes_in", sa.Integer(), nullable=True),
            sa.Column("bytes_out", sa.Integer(), nullable=True),
            sa.Column("raw_data", sa.JSON(), nullable=True),
            sa.Column("source_type", sa.String(), nullable=True),
            sa.Column("processed", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(
                ["source_id"],
                ["event_sources.id"],
            ),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_security_events_dest_ip", "security_events", ["dest_ip"], unique=False)
        op.create_index(op.f("ix_security_events_id"), "security_events", ["id"], unique=False)
        op.create_index("ix_security_events_severity", "security_events", ["severity"], unique=False)
        op.create_index("ix_security_events_src_ip", "security_events", ["source_ip"], unique=False)
        op.create_index("ix_security_events_timestamp", "security_events", ["timestamp"], unique=False)
        op.create_index("ix_security_events_user_source", "security_events", ["user_id", "source_id"], unique=False)
    if "validation_steps" not in existing:
        op.create_table(
            "validation_steps",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("run_id", sa.Integer(), nullable=False),
            sa.Column("step_number", sa.Integer(), nullable=False),
            sa.Column("technique_id", sa.String(), nullable=False),
            sa.Column("technique_name", sa.String(), nullable=False),
            sa.Column("test_name", sa.String(), nullable=False),
            sa.Column("test_type", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("simulated", sa.Boolean(), nullable=True),
            sa.Column("command", sa.Text(), nullable=True),
            sa.Column("expected_detection", sa.Text(), nullable=True),
            sa.Column("actual_result", sa.String(), nullable=True),
            sa.Column("evidence", sa.JSON(), nullable=True),
            sa.Column("duration_ms", sa.Integer(), nullable=True),
            sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["run_id"], ["validation_runs.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_validation_steps_id"), "validation_steps", ["id"], unique=False)
    if "approval_requests" not in existing:
        op.create_table(
            "approval_requests",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("plan_id", sa.Integer(), nullable=False),
            sa.Column("requested_by", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("reviewed_by", sa.Integer(), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(["plan_id"], ["response_plans.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_approval_requests_id"), "approval_requests", ["id"], unique=False)
    if "case_alerts" not in existing:
        op.create_table(
            "case_alerts",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("case_id", sa.Integer(), nullable=False),
            sa.Column("alert_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(
                ["alert_id"],
                ["alerts.id"],
            ),
            sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_case_alerts_id"), "case_alerts", ["id"], unique=False)
    if "case_events" not in existing:
        op.create_table(
            "case_events",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("case_id", sa.Integer(), nullable=False),
            sa.Column("event_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["event_id"],
                ["security_events.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_case_events_id"), "case_events", ["id"], unique=False)
    if "control_results" not in existing:
        op.create_table(
            "control_results",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("step_id", sa.Integer(), nullable=False),
            sa.Column("control_name", sa.String(), nullable=False),
            sa.Column("control_type", sa.String(), nullable=False),
            sa.Column("expected", sa.Boolean(), nullable=True),
            sa.Column("detected", sa.Boolean(), nullable=True),
            sa.Column("detection_time_ms", sa.Integer(), nullable=True),
            sa.Column("details", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(["step_id"], ["validation_steps.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_control_results_id"), "control_results", ["id"], unique=False)
