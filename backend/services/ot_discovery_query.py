"""Shared owner-scoped discovery filters and deterministic inventory ordering."""

import csv
import io
import json

from fastapi import HTTPException
from sqlalchemy import or_

from backend.models.discovered_device import DiscoveredDevice as Device
from backend.services.csv_export import spreadsheet_safe_row

EXPORT_LIMIT = 5000


def discovery_predicates(
    owner_id,
    ip_address=None,
    ot_only=False,
    risk_min=None,
    risk_max=None,
    correlated=None,
    search=None,
    sensor_id=None,
    confidence=None,
):
    if risk_min is not None and risk_max is not None and risk_min > risk_max:
        raise HTTPException(status_code=400, detail="Minimum risk cannot exceed maximum risk")
    predicates = [Device.user_id == owner_id]
    if ip_address and ip_address.strip():
        predicates.append(Device.ip_address.icontains(ip_address.strip(), autoescape=True))
    if search and search.strip():
        term = search.strip()
        predicates.append(
            or_(
                *[
                    column.icontains(term, autoescape=True)
                    for column in (
                        Device.ip_address,
                        Device.mac_address,
                        Device.hostname,
                        Device.manufacturer,
                        Device.model,
                        Device.serial_number,
                        Device.firmware_version,
                    )
                ]
            )
        )
    if ot_only:
        predicates.append(Device.is_ot_device.is_(True))
    if risk_min is not None:
        predicates.append(Device.risk_score >= risk_min)
    if risk_max is not None:
        predicates.append(Device.risk_score <= risk_max)
    if correlated is not None:
        predicates.append(Device.is_correlated.is_(correlated))
    if sensor_id is not None:
        predicates.append(Device.sensor_id.is_(None) if sensor_id == 0 else Device.sensor_id == sensor_id)
    if confidence is not None:
        predicates.append(Device.confidence == confidence)
    return predicates


def discovery_order(sort="risk"):
    if sort == "newest":
        return (Device.last_seen.desc().nullslast(), Device.id.desc())
    if sort == "oldest":
        return (Device.last_seen.asc().nullslast(), Device.id.asc())
    if sort == "ip":
        return (Device.ip_address.asc(), Device.id.asc())
    return (Device.risk_score.desc().nullslast(), Device.last_seen.desc().nullslast(), Device.id.desc())


def discovery_csv(devices, total, applied):
    exported = len(devices)
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(
        [
            "id",
            "ip_address",
            "mac_address",
            "hostname",
            "manufacturer",
            "model",
            "serial_number",
            "firmware_version",
            "device_class",
            "ot_device_type",
            "is_ot_device",
            "risk_score",
            "confidence",
            "sensor_id",
            "asset_id",
            "is_correlated",
            "correlation_score",
            "protocols",
            "industrial_protocols",
            "first_seen",
            "last_seen",
            "notes",
            "scope_filters",
            "matching_total",
            "exported_count",
            "truncated",
            "evidence_scope",
        ]
    )
    for device in devices:
        writer.writerow(
            spreadsheet_safe_row(
                [
                    device.id,
                    device.ip_address,
                    device.mac_address,
                    device.hostname,
                    device.manufacturer,
                    device.model,
                    device.serial_number,
                    device.firmware_version,
                    device.device_class,
                    device.ot_device_type,
                    device.is_ot_device,
                    device.risk_score,
                    device.confidence,
                    device.sensor_id,
                    device.asset_id,
                    device.is_correlated,
                    device.correlation_score,
                    json.dumps(device.protocols) if device.protocols is not None else None,
                    json.dumps(device.industrial_protocols) if device.industrial_protocols is not None else None,
                    device.first_seen.isoformat() if device.first_seen else None,
                    device.last_seen.isoformat() if device.last_seen else None,
                    device.notes,
                    json.dumps(applied, sort_keys=True),
                    total,
                    exported,
                    total > exported,
                    f"Recorded discovery inventory, not a live scan. Maximum {EXPORT_LIMIT} matching devices "
                    "in applied order.",
                ]
            )
        )
    return "\ufeff" + stream.getvalue()
