#!/usr/bin/env python3
"""Process a Supabase SQL Editor backup export into per-table files.

Accepted inputs:
- CSV downloaded after running supabase-backup-export.sql
- JSON containing either the backup payload itself or a backup_json field

The script performs no network requests and never uploads data.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EXPECTED_TABLES = (
    "profiles",
    "study_dashboard",
    "comments",
    "task_submissions",
    "point_ledger",
    "point_redemptions",
)


class BackupError(RuntimeError):
    """Raised when a backup file is invalid or incomplete."""


def load_backup(path: Path) -> tuple[dict[str, Any], str | None, bool]:
    suffix = path.suffix.lower()

    if suffix == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            row = next(reader, None)
        if not row or "backup_json" not in row:
            raise BackupError("CSV 中未找到 backup_json 列。请确认它来自备份导出 SQL。")

        raw = row["backup_json"]
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise BackupError(f"backup_json 不是有效 JSON：{exc}") from exc

        expected_hash = (row.get("sha256") or "").strip() or None
        verified = False
        if expected_hash:
            actual_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
            verified = actual_hash.lower() == expected_hash.lower()
        return payload, expected_hash, verified

    if suffix == ".json":
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        if isinstance(value, dict) and "backup_json" in value:
            raw_value = value["backup_json"]
            payload = json.loads(raw_value) if isinstance(raw_value, str) else raw_value
            expected_hash = value.get("sha256")
            return payload, str(expected_hash) if expected_hash else None, False
        if isinstance(value, dict):
            return value, None, False
        raise BackupError("JSON 顶层必须是对象。")

    raise BackupError("只支持 .csv 或 .json 文件。")


def validate_payload(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    if payload.get("format_version") != 1:
        raise BackupError("不支持的备份格式版本。")

    tables = payload.get("tables")
    if not isinstance(tables, dict):
        raise BackupError("备份中缺少 tables 对象。")

    normalized: dict[str, list[dict[str, Any]]] = {}
    for table in EXPECTED_TABLES:
        rows = tables.get(table)
        if not isinstance(rows, list):
            raise BackupError(f"备份中缺少表 {table}，或其内容不是数组。")
        if not all(isinstance(row, dict) for row in rows):
            raise BackupError(f"表 {table} 中存在非对象记录。")
        normalized[table] = rows

    return normalized


def csv_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def write_table_files(output_dir: Path, table: str, rows: list[dict[str, Any]]) -> None:
    json_path = output_dir / f"{table}.json"
    json_path.write_text(
        json.dumps(rows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    csv_path = output_dir / f"{table}.csv"
    fieldnames = sorted({key for row in rows for key in row.keys()})
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        if not fieldnames:
            handle.write("")
            return
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: csv_value(row.get(key)) for key in fieldnames})


def protect_permissions(path: Path) -> None:
    if os.name == "posix":
        path.chmod(0o700 if path.is_dir() else 0o600)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="将 Supabase 一键备份拆分为六张表的 CSV 和 JSON 文件。"
    )
    parser.add_argument("input", type=Path, help="SQL Editor 下载的 CSV 或 JSON 文件")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="输出目录；默认创建 backups/processed-时间戳",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        print(f"错误：找不到输入文件：{args.input}", file=sys.stderr)
        return 2

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = args.output or Path("backups") / f"processed-{timestamp}"

    try:
        payload, expected_hash, hash_verified = load_backup(args.input)
        tables = validate_payload(payload)
    except (BackupError, OSError, json.JSONDecodeError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=False)
    protect_permissions(output_dir)

    for table, rows in tables.items():
        write_table_files(output_dir, table, rows)

    manifest = {
        "format_version": payload.get("format_version"),
        "source_file": args.input.name,
        "project_ref": payload.get("project_ref"),
        "backup_generated_at": payload.get("generated_at"),
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "expected_sha256": expected_hash,
        "sha256_verified": hash_verified,
        "row_counts": {table: len(rows) for table, rows in tables.items()},
        "warning": "Private backup. Do not commit or publish these files.",
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    for file_path in output_dir.iterdir():
        protect_permissions(file_path)

    print(f"处理完成：{output_dir}")
    for table in EXPECTED_TABLES:
        print(f"- {table}: {len(tables[table])} 行")
    if expected_hash:
        print("- SHA-256 校验：" + ("通过" if hash_verified else "未通过，请勿用于恢复"))

    return 0 if not expected_hash or hash_verified else 3


if __name__ == "__main__":
    raise SystemExit(main())
