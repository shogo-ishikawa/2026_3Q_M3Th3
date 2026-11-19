"""本番の画面・同期ロジックで認証と端末間の保存を確認するためのテスト専用データ。"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import expect


class FixtureDatabase:
    def __init__(self):
        self.documents = {}
        self.version = 0

    def request(self, body):
        if body["op"] == "snapshot":
            return {"documents": self.documents, "version": self.version}
        assert body["op"] == "commit"
        if body["version"] != self.version:
            return False
        for path, fields in body["writes"].items():
            if fields is None:
                self.documents.pop(path, None)
            else:
                self.documents[path] = fields
        self.version += 1
        return True

    def connect(self, context):
        context.expose_function("mealFixtureDatabase", self.request)


def stage_fixture(app, dest):
    shutil.copytree(app, dest, ignore=shutil.ignore_patterns("dist", "node_modules", "__pycache__"))
    sdk = dest / "assets/firebase"
    sdk.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(Path(__file__).with_name("firebase-sdk.fixture.mjs"), sdk / "firebase-sdk.js")
    (sdk / "config.json").write_text(json.dumps({
        "projectId": "meal-fixture", "appId": "local-only", "apiKey": "local-only",
        "authDomain": "meal-fixture.firebaseapp.com",
    }))
    identity = dest / "account-identity.js"
    digest = hashlib.sha256(b"owner@example.test").hexdigest()
    code, substitutions = re.subn(r"(ADMIN_EMAIL_SHA256 = ')[0-9a-f]{64}(')", rf"\g<1>{digest}\2", identity.read_text())
    assert substitutions == 1
    identity.write_text(code)
    subprocess.run([sys.executable, str(dest / "tools/update_offline_shell.py")], check=True)


def login_as(page, uid="member"):
    page.evaluate("id => sessionStorage.setItem('meal-fixture-next', id)", uid)
    page.locator("#google-login").click()
    if uid == "invalid":
        expect(page.locator("#google-login")).to_be_enabled()
        return
    expect(page.locator("#account-content")).to_be_visible(timeout=30000)
    expect(page.locator("#account-gate")).to_be_hidden()
    if uid == "owner":
        expect(page.locator("#account-admin")).to_have_text("管理者画面")
        expect(page.locator("#account-greeting")).to_have_text("")
    else:
        name = {"member": "花子", "second": "次郎"}[uid]
        expect(page.locator("#account-greeting")).to_have_text(name + "さん、こんにちは。")
        expect(page.locator("#account-admin")).to_be_hidden()


def journal_bytes(page):
    return page.evaluate("""async () => {
      const {getAccountSession} = await import('./app-start.js');
      return getAccountSession().journal.exportLocal();
    }""")


def verify_accounts(browser, url, db):
    source = browser.new_context(service_workers="block")
    db.connect(source)
    page = source.new_page()
    for route in ("#settings", "?demo=week#nutrition"):
        page.goto(url + route)
        expect(page.locator("#google-login")).to_be_enabled()
        expect(page.locator("#account-content")).to_be_hidden()
        expect(page.locator("#account-content")).to_have_attribute("inert", "")
        expect(page.locator("#panel-nutrition")).to_be_hidden()
    login_as(page, "invalid")
    expect(page.locator("#account-content")).to_be_hidden()
    page.goto(url)
    login_as(page, "member")
    # UIで食べた記録と献立案を保存する。
    page.locator("#tab-record").click()
    page.locator("#record-view-detailed").click()
    page.get_by_text("見つからない食事を入力", exact=True).click()
    page.locator("#calendar-status").select_option("eaten")
    page.locator("#manual-name").fill("検証用の昼食")
    page.locator("#manual-kcal").fill("432")
    page.locator("#manual-form button[type=submit]").click()
    expect(page.locator("#calendar-entry-list")).to_contain_text("検証用の昼食")
    page.locator("#tab-planner").click()
    page.locator("#plan-days").select_option("1")
    page.locator("#plan-form button[type=submit]").click()
    expect(page.locator(".day-card").first).to_be_visible()
    page.locator("#tab-settings").click()
    expect(page.locator("#account-sync-state")).to_contain_text("同期しました")
    expect(page.locator("#account-sync-panel")).to_be_hidden()
    source.set_offline(True)
    page.locator("#settings-tab-display").click()
    page.locator("#start-tab").select_option("record")
    expect(page.locator("#account-sync-panel")).to_be_visible()
    expect(page.locator("#account-sync-retry")).to_be_visible()
    page.locator("#account-sync-retry").click()
    expect(page.locator("#account-sync-state")).to_contain_text("通信が戻ると")
    source.set_offline(False)
    expect(page.locator("#account-sync-panel")).to_be_hidden()
    page.locator("#start-tab").select_option("planner")
    expect(page.locator("#account-sync-state")).to_contain_text("同期しました")
    page.locator("#settings-tab-feedback").click()
    saved = json.loads(journal_bytes(page))
    assert saved["entries"] and saved["draftPlan"]
    feedback = page.locator("#taste-feedback")
    feedback.locator("summary").click()
    favorite_genre = feedback.get_by_label("お気に入りの料理")
    plan_genre = feedback.get_by_label("保存した献立")
    expect(favorite_genre).to_be_enabled()
    report_key = "mealPaletteTasteReports/member"
    assert report_key not in db.documents
    favorite_genre.select_option("中華")
    plan_genre.select_option("洋食")
    feedback.get_by_role("button", name="この内容を共有する").click()
    expect(feedback.get_by_role("status")).to_contain_text("共有しました")
    assert db.documents[report_key] == {"favoriteGenre": "中華", "planGenre": "洋食"}
    favorite_genre.select_option("和食")
    feedback.get_by_role("button", name="この内容を共有する").click()
    expect(feedback.get_by_role("button", name="この内容を共有する")).to_be_disabled()
    feedback.get_by_role("button", name="共有を取り消す").click()
    expect(feedback.get_by_role("status")).to_contain_text("取り消しました")
    assert report_key not in db.documents
    remote = browser.new_context(service_workers="block")
    db.connect(remote)
    other = remote.new_page()
    other.goto(url)
    login_as(other, "member")
    expect(other.locator(".day-card").first).to_be_visible()
    reread = json.loads(journal_bytes(other))
    assert reread["entries"] == saved["entries"] and reread["draftPlan"] == saved["draftPlan"]
    other.locator("#tab-nutrition").click()
    expect(other.locator("#panel-nutrition")).to_contain_text("432")
    remote.close()

    page.locator("#account-logout").click()
    expect(page.locator("#google-login")).to_be_enabled()
    expect(page.locator("#account-content")).to_be_hidden()
    login_as(page, "second")
    expect(page.locator(".day-card")).to_have_count(0)
    page.locator("#tab-record").click()
    expect(page.locator("#calendar-entry-list")).not_to_contain_text("検証用の昼食")
    page.locator("#account-logout").click()
    expect(page.locator("#google-login")).to_be_enabled()
    login_as(page, "owner")
    admin = page.locator("#account-admin")
    expect(admin).to_have_css("color", "rgb(161, 34, 36)")
    admin.click()
    expect(page.locator("#settings-panel-feedback")).to_be_visible()
    expect(page.locator("#admin-menu-proposals")).to_be_focused()
    page.locator("#admin-menu-proposals button").click()
    expect(page.locator("#admin-menu-proposals [role=status]")).to_contain_text("まだありません")
    trends = page.locator("#admin-taste-trends")
    for i in range(5):
        db.documents["mealPaletteTasteReports/test-" + str(i)] = {"favoriteGenre": "中華", "planGenre": "未共有"}
    trends.get_by_role("button").click()
    expect(trends.locator("li")).to_have_text(["お気に入りの料理　中華（5人）"])
    source.close()
