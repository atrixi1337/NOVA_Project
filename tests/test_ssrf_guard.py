"""Deterministic SSRF-guard tests for the public fetch tools.

These exercise the validators directly — no network required. We probe against
IP literals and ``localhost`` (which don't need DNS) plus a few public IP
literals. Public hostnames that require live DNS are intentionally not asserted
here to keep the suite hermetic.
"""
import ipaddress

import backend

# Public IP literals used to confirm the allowlist isn't over-broad.
_PUBLIC_IPS = {"1.1.1.1", "8.8.8.8", "93.184.216.34"}


def test_ip_blocked_catches_internal_and_metadata():
    for bad in (
        "127.0.0.1", "169.254.169.254", "10.0.0.1", "10.255.255.255",
        "192.168.1.1", "172.16.0.1", "172.31.255.255", "0.0.0.0",
        "255.255.255.255", "::1", "fc00::1", "fe80::1",
    ):
        assert backend._ip_blocked(ipaddress.ip_address(bad)) is True, bad


def test_ip_blocked_allows_public():
    for good in _PUBLIC_IPS:
        assert backend._ip_blocked(ipaddress.ip_address(good)) is False, good


def test_host_is_public_rejects_local_names_and_literals():
    for bad in ("localhost", "127.0.0.1", "169.254.169.254", "0.0.0.0",
                "10.1.2.3", "192.168.0.1", "172.16.0.1", "::1"):
        assert backend._host_is_public(bad) is False, bad


def test_host_is_public_accepts_public_ip_literals():
    for good in _PUBLIC_IPS:
        assert backend._host_is_public(good) is True, good


def test_url_is_public_blocks_bad_schemes_and_internal_targets():
    for url in (
        "file:///etc/passwd",
        "gopher://x",
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost:8000/api/usage",
        "http://127.0.0.1:8000",
        "http://10.0.0.1/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "http://[::1]/",
        "http://0.0.0.0/",
    ):
        ok, _why = backend._url_is_public(url)
        assert ok is False, url


def test_url_is_public_allows_public():
    ok, why = backend._url_is_public("http://1.1.1.1/")
    assert ok is True, why


def test_url_is_public_strips_port_before_resolution():
    ok, _why = backend._url_is_public("http://1.1.1.1:8080/path")
    assert ok is True
