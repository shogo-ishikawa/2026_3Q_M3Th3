"""公開用の Firebase Web 設定を検査し、SDK とともにオフライン保存の対象にします。"""
import argparse
import json
import os
from pathlib import Path
import re
from time import sleep
from urllib.error import URLError
from urllib.request import Request, urlopen

from update_module_map import update as update_shell

ROOT = Path(__file__).resolve().parents[1]
PROJECT = 'meal-palette-98d2c'
DEMO_PROJECT = 'demo-meal-palette'
HOSTING_CONFIG_URL = f'https://{PROJECT}.firebaseapp.com/__/firebase/init.json'
REQUIRED = {'apiKey', 'projectId', 'authDomain', 'appId'}
OPTIONAL = {'messagingSenderId', 'storageBucket', 'measurementId', 'databaseURL'}


def validated_config(project_id, contents, *, fixture=False):
    if not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', project_id):
        raise ValueError('Meal Palette 専用プロジェクトの ID を指定してください。')
    if project_id == DEMO_PROJECT and not fixture:
        raise ValueError('テスト用の Firebase 設定は本番で使用できません。')
    try:
        config = json.loads(contents)
    except (ValueError, TypeError):
        raise ValueError('Firebase コンソールの公開 Web アプリ設定を JSON で指定してください。') from None
    if not isinstance(config, dict) or not REQUIRED <= config.keys() or config.keys() - (REQUIRED | OPTIONAL):
        raise ValueError('Firebase Web アプリ設定の項目を確認してください。')
    if config['projectId'] != project_id or config['authDomain'] != f'{project_id}.firebaseapp.com':
        raise ValueError('Web アプリ設定と指定プロジェクトの ID・認証ドメインが一致しません。')
    if not isinstance(config['apiKey'], str) or not re.fullmatch(r'AIza[\w-]{35}', config['apiKey'], re.ASCII):
        raise ValueError('Web アプリ用 API キーの形式を確認してください。')
    app_id = config['appId']
    if not isinstance(app_id, str) or not re.fullmatch(r'1:\d+:web:[0-9a-f]+', app_id, re.ASCII):
        raise ValueError('Firebase Web アプリ ID の形式を確認してください。')
    sender = app_id.split(':')[1]
    if 'messagingSenderId' in config and config['messagingSenderId'] != sender:
        raise ValueError('アプリ ID と送信者 ID が同じプロジェクトに属しているか確認してください。')
    # 起動・ログイン・Firestoreに必要な公開値だけを書き出します。
    return {key: config[key] for key in sorted(REQUIRED | ({'messagingSenderId'} & config.keys()))}


def production_config():
    if (os.environ.get('MEAL_PALETTE_FIREBASE_PROJECT_ID') or PROJECT) != PROJECT:
        raise ValueError(f'本番の Meal Palette は {PROJECT} を使用します。')
    supplied = os.environ.get('MEAL_PALETTE_FIREBASE_WEB_CONFIG')
    if supplied:
        return validated_config(PROJECT, supplied)

    # Hosting の予約 URL で取得できるのは Web クライアント用の公開設定です。
    request = Request(HOSTING_CONFIG_URL, headers={'Accept': 'application/json'})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=10) as response:
                if response.geturl() != HOSTING_CONFIG_URL:
                    raise ValueError('Firebase の設定 URL が変更されています。')
                contents = response.read(16385)
            if len(contents) > 16384:
                raise ValueError('Firebase Web アプリ設定のサイズを確認してください。')
            return validated_config(PROJECT, contents)
        except (URLError, TimeoutError):
            if attempt < 2:
                sleep(2 ** attempt)
    raise ValueError('Firebase Hosting の公開 Web 設定を取得できませんでした。'
                     'Web アプリを登録し、必要に応じて MEAL_PALETTE_FIREBASE_WEB_CONFIG を設定してください。')


def configure(fixture):
    if fixture:
        config = validated_config(DEMO_PROJECT, json.dumps({
            'apiKey': 'AIza' + '0' * 35, 'projectId': DEMO_PROJECT,
            'authDomain': f'{DEMO_PROJECT}.firebaseapp.com', 'appId': '1:123456789:web:face1234'
        }), fixture=True)
    else:
        config = production_config()
    folder = ROOT / 'assets' / 'firebase'
    if not (folder / 'firebase-sdk.js').is_file():
        raise ValueError('先に tools/firebase-sdk で npm ci と npm run build を実行してください。')
    (folder / 'config.json').write_text(json.dumps(config, indent=2) + '\n')
    update_shell()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--test-fixture', action='store_true', help='自動テスト専用の公開設定を生成')
    args = parser.parse_args()
    try:
        configure(args.test_fixture)
    except ValueError as error:
        parser.exit(1, str(error) + '\n')
