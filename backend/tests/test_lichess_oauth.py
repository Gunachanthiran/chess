"""Tests for the Lichess OAuth (PKCE) login flow.

`generate_pkce_pair`/`build_authorize_url` are pure and tested directly.
`exchange_code_for_token`/`fetch_account_username` talk to Lichess over HTTP,
so their tests monkeypatch `httpx.Client` the way the rest of this module
would be exercised in production, without any real network call — the same
scope of coverage `chesscom_client.py`/`lichess_client.py` have today (none),
extended here because PKCE correctness is worth pinning down explicitly.
"""

from __future__ import annotations

import base64
import hashlib
from urllib.parse import parse_qs, urlparse

import pytest

from app.errors import ExternalAPIError
from app.services import lichess_oauth


class TestPKCE:
    def test_challenge_is_the_sha256_of_the_verifier(self):
        verifier, challenge = lichess_oauth.generate_pkce_pair()

        expected = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
            .rstrip(b"=")
            .decode("ascii")
        )
        assert challenge == expected

    def test_challenge_has_no_base64_padding(self):
        _, challenge = lichess_oauth.generate_pkce_pair()
        assert "=" not in challenge

    def test_successive_pairs_are_not_reused(self):
        first_verifier, first_challenge = lichess_oauth.generate_pkce_pair()
        second_verifier, second_challenge = lichess_oauth.generate_pkce_pair()

        assert first_verifier != second_verifier
        assert first_challenge != second_challenge

    def test_state_values_are_not_reused(self):
        assert lichess_oauth.generate_state() != lichess_oauth.generate_state()


class TestBuildAuthorizeUrl:
    def test_points_at_lichess_oauth(self):
        url = lichess_oauth.build_authorize_url(
            state="s1", code_challenge="c1", redirect_uri="http://localhost:8000/cb"
        )
        assert url.startswith("https://lichess.org/oauth?")

    def test_carries_every_required_param(self):
        url = lichess_oauth.build_authorize_url(
            state="my-state", code_challenge="my-challenge", redirect_uri="http://x/cb"
        )
        params = parse_qs(urlparse(url).query)

        assert params["response_type"] == ["code"]
        assert params["code_challenge_method"] == ["S256"]
        assert params["state"] == ["my-state"]
        assert params["code_challenge"] == ["my-challenge"]
        assert params["redirect_uri"] == ["http://x/cb"]
        assert params["client_id"] == [lichess_oauth.settings.LICHESS_OAUTH_CLIENT_ID]

    def test_requests_no_scope(self):
        """Only the username is ever read (`/api/account`), which needs no
        special permission — an unscoped token is the minimum-privilege ask."""
        url = lichess_oauth.build_authorize_url(
            state="s", code_challenge="c", redirect_uri="http://x/cb"
        )
        assert "scope=" not in url


class _FakeResponse:
    def __init__(self, status_code: int, json_body=None, raise_on_json: bool = False):
        self.status_code = status_code
        self._json_body = json_body
        self._raise_on_json = raise_on_json

    def json(self):
        if self._raise_on_json:
            raise ValueError("not json")
        return self._json_body


class _FakeClient:
    """Stands in for `httpx.Client` as a context manager returning one
    canned response, regardless of the request made."""

    def __init__(self, response: _FakeResponse):
        self._response = response

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def post(self, *args, **kwargs):
        return self._response

    def get(self, *args, **kwargs):
        return self._response


def _patch_client(monkeypatch, response: _FakeResponse) -> None:
    monkeypatch.setattr(lichess_oauth.httpx, "Client", lambda **kwargs: _FakeClient(response))


class TestExchangeCodeForToken:
    def test_returns_the_access_token_on_success(self, monkeypatch):
        _patch_client(
            monkeypatch, _FakeResponse(200, {"access_token": "tok_123", "token_type": "Bearer"})
        )
        token = lichess_oauth.exchange_code_for_token(
            code="c", code_verifier="v", redirect_uri="http://x/cb"
        )
        assert token == "tok_123"

    def test_raises_on_non_2xx(self, monkeypatch):
        _patch_client(monkeypatch, _FakeResponse(400, {"error": "invalid_grant"}))
        with pytest.raises(ExternalAPIError):
            lichess_oauth.exchange_code_for_token(
                code="c", code_verifier="v", redirect_uri="http://x/cb"
            )

    def test_raises_when_the_payload_has_no_access_token(self, monkeypatch):
        _patch_client(monkeypatch, _FakeResponse(200, {"token_type": "Bearer"}))
        with pytest.raises(ExternalAPIError):
            lichess_oauth.exchange_code_for_token(
                code="c", code_verifier="v", redirect_uri="http://x/cb"
            )

    def test_raises_on_unparseable_json(self, monkeypatch):
        _patch_client(monkeypatch, _FakeResponse(200, raise_on_json=True))
        with pytest.raises(ExternalAPIError):
            lichess_oauth.exchange_code_for_token(
                code="c", code_verifier="v", redirect_uri="http://x/cb"
            )


class TestFetchAccountUsername:
    def test_returns_the_username_on_success(self, monkeypatch):
        _patch_client(monkeypatch, _FakeResponse(200, {"id": "drnykterstein", "username": "DrNykterstein"}))
        assert lichess_oauth.fetch_account_username("tok") == "DrNykterstein"

    def test_raises_on_non_2xx(self, monkeypatch):
        _patch_client(monkeypatch, _FakeResponse(401, {}))
        with pytest.raises(ExternalAPIError):
            lichess_oauth.fetch_account_username("tok")

    def test_raises_when_the_payload_has_no_username(self, monkeypatch):
        _patch_client(monkeypatch, _FakeResponse(200, {"id": "x"}))
        with pytest.raises(ExternalAPIError):
            lichess_oauth.fetch_account_username("tok")
