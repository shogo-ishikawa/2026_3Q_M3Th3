"""Exercise production rules against a loopback Firestore emulator using its REST API."""
import base64
import json
import hashlib
from pathlib import Path
import re
import os
import time
import unittest
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4

PROJECT = "demo-meal-palette"
ADMIN_EMAIL = "admin@example.test"


def emulator_token(uid, email="reader@example.invalid", provider="google.com", verified=True):
    # The emulator accepts unsigned test users. This client only permits loopback requests.
    def b64(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    now = int(time.time())
    claims = {"sub": uid, "user_id": uid, "aud": PROJECT,
              "iss": "https://securetoken.google.com/" + PROJECT, "iat": now,
              "exp": now + 600, "auth_time": now, "email": email, "email_verified": verified,
              "firebase": {"sign_in_provider": provider, "identities": {}}}
    return b64({"alg": "none", "typ": "JWT"}) + "." + b64(claims) + "."


def document(**fields):
    types = {str: "stringValue", int: "integerValue", bool: "booleanValue"}
    return {"fields": {key: {types[type(val)]: val} for key, val in fields.items()}}


class FirestoreRules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        host = os.environ["FIRESTORE_EMULATOR_HOST"]
        base = urlsplit("http://" + host)
        if base.hostname not in {"127.0.0.1", "localhost", "::1"} or not base.port:
            raise ValueError("Start the local Firestore emulator first.")
        cls.docs = f"http://{host}/v1/projects/{PROJECT}/databases/(default)/documents"
        cls.http = build_opener(ProxyHandler({}))
        # Use a synthetic admin identity with the exact deployed hash and provider checks.
        rules = (Path(__file__).resolve().parents[1] / "firestore.rules").read_text()
        digest = hashlib.sha256(ADMIN_EMAIL.encode()).hexdigest()
        rules, count = re.subn(r"'[0-9a-f]{64}'", f"'{digest}'", rules)
        assert count == 1
        endpoint = f"http://{host}/emulator/v1/projects/{PROJECT}:securityRules"
        req = Request(endpoint, method="PUT", headers={"Content-Type": "application/json"},
                      data=json.dumps({"rules": {"files": [{"name": "firestore.rules", "content": rules}]}}).encode())
        with cls.http.open(req, timeout=20) as response:
            result = json.load(response)
            assert not result.get("issues"), result

    def setUp(self):
        self.uid = "reader-" + uuid4().hex
        self.owner = emulator_token(self.uid)
        self.other = emulator_token("other")
        self.admin = emulator_token("admin", ADMIN_EMAIL)
        self.manifest = "/users/" + self.uid + "/mealJournal/current"
        self.chunk = self.manifest + "/parts/0"
        self.vote = "/mealPaletteMenuVotes/" + self.uid
        self.meta = document(revision=str(uuid4()), partCount=1)

    def call(self, expected, method, path, token=None, body=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        request = Request(self.docs + path, method=method, headers=headers,
                          data=None if body is None else json.dumps(body).encode())
        try:
            response = self.http.open(request, timeout=10)
        except HTTPError as exc:
            response = exc
        with response:
            content = response.read().decode()
            self.assertEqual(response.status, expected, (method, path, content[:800]))
            return json.loads(content) if content else None

    def test_journal_owner_roundtrip_and_no_listing(self):
        self.call(200, "PATCH", self.manifest, self.owner, self.meta)
        self.call(200, "PATCH", self.chunk, self.owner, document(text="献立データ"))
        self.call(200, "GET", self.manifest, self.owner)
        saved = self.call(200, "GET", self.chunk, self.owner)
        self.assertEqual(saved["fields"], document(text="献立データ")["fields"])
        self.call(403, "GET", self.manifest + "/parts", self.owner)
        self.call(200, "DELETE", self.chunk, self.owner)

    def test_private_even_for_app_admin(self):
        self.call(200, "PATCH", self.manifest, self.owner, self.meta)
        self.call(200, "PATCH", self.chunk, self.owner, document(text="記録"))
        for token in [None, self.other, self.admin,
                      emulator_token(self.uid, verified=False), emulator_token(self.uid, provider="password")]:
            with self.subTest(identity=token):
                for path, payload in [(self.manifest, self.meta), (self.chunk, document(text="X"))]:
                    self.call(403, "GET", path, token)
                    self.call(403, "PATCH", path, token, payload)
                    self.call(403, "DELETE", path, token)
        self.call(403, "GET", "/users/" + self.uid + "/mealJournal", self.admin)

    def test_journal_shape(self):
        for count in [0, 33, "1"]:
            self.call(403, "PATCH", self.manifest, self.owner, document(revision=str(uuid4()), partCount=count))
        for payload in [document(revision="invalid", partCount=1), document(partCount=1),
                        document(revision=str(uuid4()), partCount=1, extra=True)]:
            self.call(403, "PATCH", self.manifest, self.owner, payload)
        self.call(403, "PATCH", self.manifest + "/parts/32", self.owner, document(text="X"))
        self.call(403, "PATCH", self.chunk, self.owner, document(text=1))
        self.call(403, "PATCH", self.chunk, self.owner, document(text="X", email="example"))
        self.call(403, "PATCH", self.chunk, self.owner, document(text="X" * 294913))
        self.call(403, "PATCH", "/users/" + self.uid + "/mealJournal/other", self.owner, self.meta)

    def test_menu_vote_and_withdrawal(self):
        self.call(200, "PATCH", self.vote, self.owner, document(interest="breakfast"))
        self.call(200, "PATCH", self.vote, self.owner, document(interest="world"))
        self.call(200, "GET", self.vote, self.owner)
        for invalid in [document(interest="free text"), document(interest="world", email="example"),
                        document(interest="world", kcal=500), document(note="allergy")]:
            self.call(403, "PATCH", self.vote, self.owner, invalid)
        for token in [None, self.other, self.admin, emulator_token(self.uid, verified=False)]:
            self.call(403, "GET", self.vote, token)
            self.call(403, "PATCH", self.vote, token, document(interest="regional"))
            self.call(403, "DELETE", self.vote, token)
        self.call(200, "DELETE", self.vote, self.owner)
        self.call(404, "GET", self.vote, self.owner)

    def test_only_verified_google_admin_can_count_votes(self):
        self.call(200, "PATCH", self.vote, self.owner, document(interest="seafood"))
        query = {"structuredQuery": {"from": [{"collectionId": "mealPaletteMenuVotes"}],
                 "where": {"fieldFilter": {"field": {"fieldPath": "interest"},
                           "op": "EQUAL", "value": {"stringValue": "seafood"}}}},
                 "aggregations": [{"alias": "count", "count": {}}]}
        body = {"structuredAggregationQuery": query}
        result = self.call(200, "POST", ":runAggregationQuery", self.admin, body)
        self.assertGreaterEqual(int(result[0]["result"]["aggregateFields"]["count"]["integerValue"]), 1)
        admin_email = ADMIN_EMAIL
        for denied in [None, self.owner, emulator_token("admin", admin_email, verified=False),
                       emulator_token("admin", admin_email, provider="password")]:
            self.call(403, "POST", ":runAggregationQuery", denied, body)
            self.call(403, "GET", "/mealPaletteMenuVotes", denied)
        self.call(200, "DELETE", self.vote, self.owner)


if __name__ == "__main__":
    unittest.main()
