"""Shared test setup for the Nova backend suite.

Imports backend.py with an isolated environment: a throwaway SQLite DB and no
auth passphrase (tests opt in by mutating backend.AUTH_TOKENS directly).
This must run BEFORE backend is imported anywhere.
"""
import os
import tempfile

os.environ["NOVA_HISTORY_DB"] = tempfile.mktemp(prefix="nova-test-", suffix=".db")
os.environ.pop("NOVA_AUTH_PASSPHRASE", None)
os.environ.pop("NOVA_AUTH_SECRET", None)
os.environ.setdefault("INCEPTION_API_KEY", "test-key-inception")  # passes the key check; network is faked
os.environ.setdefault("GEMINI_API_KEY", "test-key-gemini")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import backend  # noqa: E402


@pytest.fixture()
def client():
    """TestClient with auth disabled and a fresh throwaway DB per test."""
    db = tempfile.mktemp(prefix="nova-test-", suffix=".db")
    backend.HISTORY_DB = db
    backend.init_db()
    saved_tokens = dict(backend.AUTH_TOKENS)
    backend.AUTH_TOKENS = {}
    with TestClient(backend.app) as c:
        yield c
    backend.AUTH_TOKENS = saved_tokens
    try:
        os.unlink(db)
    except OSError:
        pass
    for suffix in ("-wal", "-shm"):
        try:
            os.unlink(db + suffix)
        except OSError:
            pass


@pytest.fixture()
def locked_client(client):
    """Same client, but with auth enabled (single 'owner' token)."""
    backend.AUTH_TOKENS = {"secret-owner-pass": "owner"}
    with TestClient(backend.app) as c:
        yield c
    backend.AUTH_TOKENS = {}
