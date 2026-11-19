"""本番に別プロジェクトやテスト用の設定を配信しないことを確かめます。"""
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from configure_firebase import DEMO_PROJECT, HOSTING_CONFIG_URL, PROJECT, production_config, validated_config


class FirebaseWebConfigTests(unittest.TestCase):
    project = 'meal-palette-abc'
    config = {'projectId': project, 'authDomain': project + '.firebaseapp.com',
              'appId': '1:123456:web:abc123', 'messagingSenderId': '123456',
              'apiKey': 'AIza' + '0' * 35}

    def parse(self, **values):
        return validated_config(self.project, json.dumps({**self.config, **values}))

    def test_only_needed_public_fields_are_deployed(self):
        self.assertEqual(self.parse(), self.config)
        self.assertEqual(self.parse(storageBucket='example', measurementId='G-123'), self.config)

    def test_foreign_project_credentials_and_service_accounts_are_rejected(self):
        for fields in [{'projectId': 'other-project'}, {'authDomain': 'other-project.firebaseapp.com'},
                       {'messagingSenderId': '999'}, {'private_key': 'fake'}, {'apiKey': None},
                       {'appId': '1:123456:android:abc'}, {'apiKey': 'wrong'}]:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                self.parse(**fields)

    def test_missing_and_demo_configs_cannot_be_published(self):
        with self.assertRaises(ValueError):
            validated_config('', '')
        with self.assertRaises(ValueError):
            validated_config(DEMO_PROJECT, json.dumps({**self.config, 'projectId': DEMO_PROJECT,
                                                      'authDomain': DEMO_PROJECT + '.firebaseapp.com'}))

    @patch.dict(os.environ, {}, clear=True)
    @patch('configure_firebase.sleep')
    @patch('configure_firebase.urlopen')
    def test_reserved_configuration_retry_and_project_binding(self, fetch, sleep):
        config = {**self.config, 'projectId': PROJECT, 'authDomain': PROJECT + '.firebaseapp.com'}
        response = MagicMock()
        response.__enter__.return_value = response
        response.geturl.return_value = HOSTING_CONFIG_URL
        response.read.return_value = json.dumps(config).encode()
        fetch.side_effect = [URLError('temporarily offline'), response]
        self.assertEqual(production_config(), config)
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(fetch.call_args.args[0].full_url, HOSTING_CONFIG_URL)
        sleep.assert_called_once()

    @patch.dict(os.environ, {'MEAL_PALETTE_FIREBASE_PROJECT_ID': 'another-project'}, clear=True)
    @patch('configure_firebase.urlopen')
    def test_production_does_not_accept_another_project(self, fetch):
        with self.assertRaises(ValueError):
            production_config()
        fetch.assert_not_called()

    @patch('configure_firebase.urlopen')
    def test_explicit_public_config_works_without_hosting(self, fetch):
        config = {**self.config, 'projectId': PROJECT, 'authDomain': PROJECT + '.firebaseapp.com'}
        with patch.dict(os.environ, {'MEAL_PALETTE_FIREBASE_WEB_CONFIG': json.dumps(config)}, clear=True):
            self.assertEqual(production_config(), config)
        fetch.assert_not_called()
