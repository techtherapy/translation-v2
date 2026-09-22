"""Export one owner-scoped Google Docs review experiment as redacted JSON."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx
from pydantic import ValidationError

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.schemas.docs_review_export import DocsReviewExperimentExport  # noqa: E402
from app.services.docs_review.evaluation import redact_export  # noqa: E402


class ExportError(RuntimeError):
    """An authenticated export could not be safely completed."""


def validate_export(payload, experiment_id):
    sanitized = redact_export(payload)
    try:
        validated = DocsReviewExperimentExport.model_validate(sanitized)
    except ValidationError as exc:
        raise ExportError("BITS returned an invalid experiment export schema") from exc
    if validated.id != experiment_id:
        raise ExportError("BITS returned a different experiment than requested")
    return sanitized


def fetch_export(base_url, token, experiment_id, *, client=None):
    base_url = base_url.rstrip("/")
    if urlparse(base_url).scheme != "https":
        raise ExportError("BITS base URL must use HTTPS")
    if not token.strip():
        raise ExportError("A nonempty BITS access token is required")
    url = f"{base_url}/api/docs-review/experiments/{quote(experiment_id, safe='')}/export"
    own_client = client is None
    client = client or httpx.Client(timeout=30.0, follow_redirects=False)
    try:
        response = client.get(url, headers={"Authorization": f"Bearer {token}"}, follow_redirects=False)
        if response.status_code != 200:
            raise ExportError(f"BITS export request failed with HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise ExportError("BITS returned non-JSON export data") from exc
        return validate_export(payload, experiment_id)
    except httpx.HTTPError as exc:
        raise ExportError(f"BITS export request failed: {type(exc).__name__}") from exc
    finally:
        if own_client:
            client.close()


def read_token(token_file, token_env):
    try:
        token = token_file.read_text(encoding="utf-8").strip() if token_file else os.environ.get(token_env, "").strip()
    except OSError as exc:
        raise ExportError(f"Could not read BITS token file: {exc.strerror}") from exc
    if not token:
        source = str(token_file) if token_file else f"environment variable {token_env}"
        raise ExportError(f"No BITS access token found in {source}")
    return token


def write_export(payload, destination, *, force=False):
    destination.parent.mkdir(parents=True, exist_ok=True)
    mode = "w" if force else "x"
    try:
        with destination.open(mode, encoding="utf-8") as output:
            json.dump(payload, output, ensure_ascii=False, indent=2)
            output.write("\n")
    except FileExistsError as exc:
        raise ExportError(f"Output already exists: {destination}; use --force to replace it") from exc
    except OSError as exc:
        raise ExportError(f"Could not write export: {exc.strerror}") from exc


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("experiment_id", help="BITS experiment ID to export")
    parser.add_argument("output", type=Path, help="Explicit destination JSON file")
    parser.add_argument("--base-url", required=True, help="HTTPS origin of the selected BITS deployment")
    token = parser.add_mutually_exclusive_group()
    token.add_argument("--token-file", type=Path, help="UTF-8 file containing only the BITS JWT")
    token.add_argument(
        "--token-env",
        default="BITS_ACCESS_TOKEN",
        help="Environment variable containing the BITS JWT (default: BITS_ACCESS_TOKEN)",
    )
    parser.add_argument("--force", action="store_true", help="Replace an existing output file")
    args = parser.parse_args(argv)
    try:
        payload = fetch_export(
            args.base_url,
            read_token(args.token_file, args.token_env),
            args.experiment_id,
        )
        write_export(payload, args.output, force=args.force)
    except ExportError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
