"""架空のアカウントで栄養の週比較と任意プロフィールの保存・削除を確認する。"""
import json
from pathlib import Path

from playwright.sync_api import expect

from account_flow import journal_bytes, login_as


def verify_weekly_review(page):
    page.locator('#tab-nutrition').click()
    panel = page.locator('#weekly-review')
    expect(panel).to_contain_text('この期間には記録を完了した日がありません')
    page.locator('#tab-record').click()
    page.locator('#record-view-detailed').click()
    for date, kcal in [('2026-04-01', '350'), ('2026-04-08', '450')]:
        page.locator('#calendar-date').fill(date)
        page.locator('#calendar-status').select_option('eaten')
        if not page.locator('#manual-name').is_visible():
            page.get_by_text('見つからない食事を入力', exact=True).click()
        name = '週比較のテスト食 ' + date
        page.locator('#manual-name').fill(name)
        page.locator('#manual-kcal').fill(kcal)
        page.locator('#manual-form button[type=submit]').click()
        expect(page.locator('#calendar-entry-list')).to_contain_text(name)
        page.locator('#day-complete').check()
    page.locator('#tab-nutrition').click()
    expect(panel).to_contain_text('2026/04/02 〜 2026/04/08')
    expect(panel).to_contain_text('2026/03/26 〜 2026/04/01')
    rows = panel.locator('tbody tr')
    expect(rows).to_have_count(6)
    for row, label in zip(rows.all(), ['エネルギー', 'たんぱく質', '脂質', '炭水化物', '食物繊維', '食塩相当量']):
        expect(row.get_by_role('rowheader')).to_contain_text(label)
    expect(rows.first.locator('td')).to_have_text(['4501日分', '3501日分', '+100'])
    expect(rows.nth(1).locator('td')).to_have_text(['—0日分', '—0日分', '—'])


def downloaded_json(page, button):
    page.locator('#settings-tab-data').click()
    with page.expect_download() as event:
        page.locator(button).click()
    return json.loads(Path(event.value.path()).read_text(encoding='utf-8'))


def import_json(page, record):
    page.locator('#settings-tab-data').click()
    page.locator('#import-file').set_input_files({'name': 'profile.json', 'mimeType': 'application/json',
                                                  'buffer': json.dumps(record).encode()})


def verify_personal_nutrition(browser, url, db):
    context = browser.new_context(service_workers='block')
    db.connect(context)
    page = context.new_page()
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(url + '#settings')
    expect(page.locator('#account-content')).to_be_hidden()
    expect(page.locator('#personal-age')).to_be_hidden()
    login_as(page)
    page.locator('#tab-settings').click()
    expect(page.locator('#profile-mode')).to_have_value('manual')
    expect(page.locator('#profile-personal-fields')).to_be_hidden()
    verify_weekly_review(page)

    page.locator('#tab-settings').click()
    page.locator('#target-kcal').fill('2017')
    page.locator('#targets-form button[type=submit]').click()
    original = json.loads(journal_bytes(page))
    assert original['targets']['kcal'] == 2017 and 'personalProfile' not in original
    page.locator('#profile-mode').select_option('personal')
    page.locator('#personal-age').fill('38')
    # 栄養プロフィールの編集中に別の設定を保存しても、選択や入力を失わない。
    page.locator('#settings-tab-family').click()
    page.locator('#household-count-adult').fill('1')
    page.locator('#save-household').click()
    page.locator('#clear-household').click()
    page.locator('#settings-tab-profile').click()
    expect(page.locator('#profile-mode')).to_have_value('personal')
    expect(page.locator('#personal-age')).to_have_value('38')
    page.locator('#personal-height').fill('164.2')
    page.locator('#personal-weight').fill('60.8')
    page.locator('#personal-sex').select_option('female')
    page.locator('#personal-activity').select_option('moderate')
    page.locator('#profile-apply').click()
    expect(page.locator('#personal-consent')).not_to_be_checked()
    assert not page.locator('#personal-consent').evaluate('(e) => e.validity.valid')
    assert json.loads(journal_bytes(page)) == original
    page.locator('#personal-consent').check()
    page.locator('#profile-apply').click()
    expect(page.locator('#profile-summary')).to_contain_text('身長・体重を使った目安')
    expect(page.locator('#account-sync-state')).to_contain_text('同期しました')
    active = downloaded_json(page, '#export-records')
    assert active['personalProfile'] == {'age': 38, 'heightCm': 164.2, 'weightKg': 60.8,
                                         'sex': 'female', 'activity': 'moderate'}
    assert active['manualTargets'] == original['targets']
    assert active['targets']['kcal'] != 2017

    other_device = browser.new_context(service_workers='block')
    db.connect(other_device)
    remote = other_device.new_page()
    remote.goto(url)
    login_as(remote)
    remote.locator('#tab-settings').click()
    expect(remote.locator('#profile-mode')).to_have_value('personal')
    expect(remote.locator('#personal-weight')).to_have_value('60.8')
    assert json.loads(journal_bytes(remote)) == active

    assert 'mealPaletteMenuVotes/member' not in db.documents
    page.locator('#settings-tab-feedback').click()
    vote = page.locator('#menu-feedback')
    vote.locator('summary').click()
    vote.locator('select').select_option('regional')
    vote.locator('[data-send]').click()
    expect(vote.get_by_role('status')).to_have_text('希望を送信しました。')
    assert db.documents['mealPaletteMenuVotes/member'] == {'interest': 'regional'}

    # 以前の1件を含めて複数の希望を送信し、別端末の追加を保って1件ずつ更新する。
    vote.locator('select').select_option('seafood')
    vote.locator('[data-send]').click()
    expect(vote.get_by_role('status')).to_have_text('希望を送信しました。')
    expect(vote.locator('li')).to_have_count(2)
    remote.locator('#settings-tab-feedback').click()
    other_vote = remote.locator('#menu-feedback')
    other_vote.locator('summary').click()
    expect(other_vote.locator('li')).to_have_count(2)
    other_vote.locator('select').select_option('noodles')
    other_vote.locator('[data-send]').click()
    expect(other_vote.locator('li')).to_have_count(3)
    vote.locator('[data-edit="seafood"]').click()
    vote.locator('select').select_option('world')
    vote.locator('[data-send]').click()
    expect(vote.get_by_role('status')).to_have_text('希望を変更しました。')
    assert db.documents['mealPaletteMenuVotes/member'] == {'interests': ['regional', 'noodles', 'world']}
    vote.locator('[data-withdraw="regional"]').click()
    expect(vote.locator('li')).to_have_count(2)
    assert db.documents['mealPaletteMenuVotes/member'] == {'interests': ['noodles', 'world']}

    # 明示的な書き出し／読み込みは詳細を含み、自動退避は除外する。
    import_json(page, original)
    expect(page.locator('#profile-mode')).to_have_value('manual')
    expect(page.locator('#restore-journal-backup')).to_be_enabled()
    archived = downloaded_json(page, '#download-journal-backup')
    assert 'personalProfile' not in archived and archived['targets'] == original['targets']
    assert archived['entries'] == original['entries']
    import_json(page, active)
    expect(page.locator('#profile-mode')).to_have_value('personal')
    assert json.loads(journal_bytes(page)) == active
    page.locator('#settings-tab-profile').click()
    page.locator('#clear-personal-profile').click()
    expect(page.locator('#profile-mode')).to_have_value('manual')
    expect(page.locator('#personal-age')).to_have_value('')
    expect(page.locator('#clear-personal-profile')).to_be_hidden()
    expect(page.locator('#account-sync-state')).to_contain_text('同期しました')
    deleted = json.loads(journal_bytes(page))
    assert 'personalProfile' not in deleted and deleted['targets'] == original['targets']
    # 別端末で同期が再開したとき、開いたままの画面からも入力値が消える。
    remote.evaluate("window.dispatchEvent(new Event('online'))")
    expect(remote.locator('#personal-weight')).to_have_value('')
    expect(remote.locator('#profile-mode')).to_have_value('manual')
    expect(remote.locator('#target-kcal')).to_have_value('2017')
    other_device.close()
    page.locator('#settings-tab-data').click()
    page.locator('#restore-journal-backup').click()
    expect(page.locator('#app-message')).to_contain_text('変更前のデータへ戻しました')
    assert 'personalProfile' not in json.loads(journal_bytes(page))

    fresh = browser.new_context(service_workers='block')
    db.connect(fresh)
    after = fresh.new_page()
    after.goto(url)
    login_as(after)
    after.locator('#tab-settings').click()
    expect(after.locator('#profile-mode')).to_have_value('manual')
    expect(after.locator('#target-kcal')).to_have_value('2017')
    assert 'personalProfile' not in json.loads(journal_bytes(after))
    fresh.close()
    page.locator('#account-logout').click()
    expect(page.locator('#account-content')).to_be_hidden()
    login_as(page, 'second')
    page.locator('#tab-settings').click()
    expect(page.locator('#profile-mode')).to_have_value('manual')
    expect(page.locator('#target-kcal')).not_to_have_value('2017')
    expect(page.locator('#restore-journal-backup')).to_be_disabled()
    context.close()
