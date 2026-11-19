"""日本の日付で誕生日を迎えるアカウントの献立と家族の買い物を確認する。"""
import json
from datetime import datetime, timezone

from playwright.sync_api import expect

from account_flow import journal_bytes, login_as


def verify_birthday_family(browser, url, db):
    context = browser.new_context(timezone_id='Asia/Tokyo', service_workers='block')
    db.connect(context)
    page = context.new_page()
    page.on('dialog', lambda modal: modal.accept())
    # 日本の4月10日と11日の境界。保存後に日を変えて同じ端末を開き直す。
    page.clock.set_fixed_time(datetime(2026, 4, 10, 14, 30, tzinfo=timezone.utc))
    page.goto(url)
    login_as(page)
    page.locator('#first-visit').get_by_role('link', name='誕生日・家族構成を設定').click()
    page.locator('#birth-date').fill('1990-04-11')
    page.locator('#birthday-consent').check()
    page.locator('#save-birth-date').click()
    expect(page.locator('#birthday-age')).to_contain_text('35')
    expect(page.locator('#account-birthday')).to_be_hidden()

    page.locator('#settings-tab-family').click()
    page.locator('#household-count-adult').fill('2')
    page.locator('#household-count-child').fill('1')
    page.locator('#household-use-servings').check()
    page.locator('#save-household').click()
    page.locator('#disliked-search').fill('生しいたけ')
    page.locator('#disliked-matches').get_by_role('button', name='＋ 生しいたけ', exact=True).click()
    expect(page.locator('#disliked-selections')).to_contain_text('生しいたけ')
    expect(page.locator('#account-sync-state')).to_contain_text('同期しました')

    page.clock.set_fixed_time(datetime(2026, 4, 10, 15, 1, tzinfo=timezone.utc))
    page.reload()
    expect(page.locator('#account-birthday')).to_have_text('花子さん、お誕生日おめでとうございます！')
    page.locator('#tab-settings').click()
    expect(page.locator('#birthday-age')).to_contain_text('36')
    page.locator('#settings-tab-family').click()
    expect(page.locator('#household-count-child')).to_have_value('1')
    expect(page.locator('#disliked-selections')).to_contain_text('生しいたけ')
    page.locator('#tab-planner').click()
    page.locator('#start-date').fill('2026-04-11')
    page.locator('#plan-days').select_option('1')
    expect(page.locator('#servings')).to_have_value('3')
    page.locator('#plan-form button[type=submit]').click()
    expect(page.locator('[data-menu-occasion="birthday"]').first).to_be_visible()
    card = page.locator('.day-card').first
    card.get_by_role('button', name='調理モード').click()
    expect(page.locator('#recipe-dialog select')).to_have_value('3')
    page.locator('#close-dialog').click()
    page.locator('#plan-save-calendar').click()
    entries = json.loads(journal_bytes(page))['entries']
    assert entries and all(row['shoppingServings'] == 3 for row in entries)
    items = [item for row in entries for item in row['items']]
    ids = [item.get('recipeId') for item in items]
    assert page.evaluate("""async ids => {
        const {recipeOccasionIds} = await import('./celebration-recipes.js');
        return ids.some(id => recipeOccasionIds({id}).includes('birthday'));
    }""", ids)
    assert not any(part['id'] == 'shiitake' for item in items for part in item.get('ingredients', []))
    page.locator('#tab-kitchen').click()
    page.locator('#kitchen-tab-menus').click()
    page.locator('#shopping-source').select_option('calendar')
    expect(page.locator('.shopping-menu-context').first).to_contain_text('3人分')

    # 誕生日以外にもカレンダーの日に合わせて献立を作れる。
    for date, occasion in [('2026-12-25', 'christmas'), ('2027-01-01', 'new-year')]:
        page.locator('#tab-planner').click()
        page.locator('#start-date').fill(date)
        page.locator('#plan-form button[type=submit]').click()
        expect(page.locator(f'[data-menu-occasion="{occasion}"]').first).to_be_visible()
    # 登録した毎年の記念日が翌年の献立に現れ、取り消せる。
    page.locator('#family-event-editor summary').click()
    page.locator('#family-event-date').fill('2026-06-18')
    page.locator('#family-event-kind').select_option('anniversary')
    page.locator('#family-event-annual').check()
    page.locator('#family-event-add').click()
    expect(page.locator('#family-event-list')).to_contain_text('2026-06-18 記念日（毎年）')
    page.locator('#start-date').fill('2027-06-18')
    page.locator('#plan-form button[type=submit]').click()
    expect(page.locator('[data-menu-occasion="anniversary"]').first).to_be_visible()
    expect(page.locator('.dish-reason-tags').filter(has_text='記念日の料理').first).to_be_visible()
    page.locator('#family-event-list button').click()
    expect(page.locator('#family-event-list li')).to_have_count(0)
    assert 'familyCalendar' not in json.loads(journal_bytes(page))
    # 生年月日を消しても、既に編集した料理・分量・買い物の識別子は保つ。
    page.locator('#start-date').fill('2026-04-11')
    page.locator('#plan-form button[type=submit]').click()
    expect(page.locator('[data-menu-occasion="birthday"]').first).to_be_visible()
    first_dish = page.locator('.day-card input[type=checkbox]').first
    first_dish.uncheck()
    before = json.loads(journal_bytes(page))['draftPlan']
    assert '誕生日の料理' in json.dumps(before, ensure_ascii=False)
    page.locator('#tab-settings').click()
    page.locator('#clear-birth-date').click()
    expect(page.locator('#account-birthday')).to_be_hidden()
    expect(page.locator('#account-greeting')).to_have_text('花子さん、こんにちは。')
    page.locator('#tab-planner').click()
    expect(page.locator('.day-card')).to_have_count(len(before['days']))
    after = json.loads(journal_bytes(page))
    assert 'birthDate' not in after and '誕生日の料理' not in json.dumps(after['draftPlan'], ensure_ascii=False)
    for original, retained in zip(before['days'], after['draftPlan']['days'], strict=True):
        for key in ('recipeIds', 'quantities', 'itemIds', 'omittedRecipeIds'):
            assert original[key] == retained[key]
    expect(page.locator('#account-sync-state')).to_contain_text('同期しました')

    page.locator('#account-logout').click()
    expect(page.locator('#google-login')).to_be_enabled()
    login_as(page, 'owner')
    admin = page.locator('#account-admin')
    expect(admin).to_be_visible()
    expect(page.locator('#account-greeting')).to_be_hidden()
    expect(page.locator('#account-birthday')).to_be_hidden()
    page.locator('#tab-settings').click()
    page.locator('#birth-date').fill('1980-04-11')
    page.locator('#birthday-consent').check()
    page.locator('#save-birth-date').click()
    expect(page.locator('#account-birthday')).to_have_text('テスト管理者さん、お誕生日おめでとうございます！')
    expect(admin).to_be_visible()
    expect(admin).to_have_css('color', 'rgb(161, 34, 36)')
    expect(page.locator('#account-greeting')).to_be_hidden()
    context.close()
