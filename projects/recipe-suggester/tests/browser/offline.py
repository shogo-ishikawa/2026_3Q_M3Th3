"""スマートフォン幅のChromeで、サーバー停止後にも買い物と在庫の更新を続けられるか確認する。"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import shutil
from tempfile import TemporaryDirectory
from threading import Thread

from playwright.sync_api import expect, sync_playwright
from account_flow import FixtureDatabase, journal_bytes, login_as, stage_fixture, verify_accounts
from nutrition_profile import verify_personal_nutrition
from birthday_family import verify_birthday_family
from drive_photos import verify_drive_photos
from home_install import check_app_only, verify_android_app, verify_app_settings, verify_browser_install


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class LocalSite(ThreadingHTTPServer):
    request_queue_size = 128


def verify(context, url, server):
    page = context.new_page()
    errors = []
    context.on("weberror", lambda error: errors.append(str(error.error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.goto(url)
    login_as(page)
    expect(page.locator("#launch-screen")).to_be_hidden()
    assert page.locator("#launch-screen img").get_attribute("src") is None
    page.locator("#first-setup").click()
    page.locator("#setup-omit-common").check()
    page.locator("#quick-setup-form button[type=submit]").click()
    expect(page.locator("#quick-setup")).not_to_be_visible()

    # 講義用サンプルを編集しても通常画面の保存データは同じ。
    original = journal_bytes(page)
    assert original and json.loads(original)["settings"]["shoppingOmittedIds"]
    page.locator("#tab-settings").click()
    page.locator("#settings-tab-data").click()
    sample_link = page.locator("#setup-actions [data-sample-link]")
    expect(sample_link).to_have_attribute("target", "_blank")
    with context.expect_page() as new_page:
        sample_link.click()
    sample = new_page.value
    expect(sample.locator("#sample-session")).to_be_visible()
    expect(sample.locator("#panel-nutrition")).to_be_visible()
    sample.locator("#tab-kitchen").click()
    sample_rows = sample.locator(".shopping-check-row")
    remaining = sample_rows.count()
    sample_rows.first.locator("input[type=checkbox]").click()
    expect(sample_rows).to_have_count(remaining - 1)
    assert journal_bytes(page) == original
    sample.close()

    page.locator("#tab-planner").click()
    page.locator("#plan-days").select_option("1")
    page.locator("#servings").select_option("3")
    page.locator("#plan-form button[type=submit]").click()
    card = page.locator(".day-card").first
    card.get_by_role("button", name="調理モード").click()
    dialog = page.locator("#recipe-dialog")
    expect(dialog.locator("select")).to_have_value("3")
    dialog.get_by_role("checkbox").first.check()
    dialog.locator("select").select_option("1")
    dialog.get_by_role("button", name="作り方").click()
    assert dialog.locator("summary").count() >= 1
    assert dialog.evaluate("e => e.scrollWidth <= e.clientWidth + 1")
    page.locator("#close-dialog").click()
    page.locator("#plan-save-calendar").click()
    page.locator("#tab-kitchen").click()
    page.locator("#kitchen-tab-menus").click()
    page.locator("#shopping-source").select_option("calendar")
    page.locator(".shopping-prepare").click()
    rows = page.locator(".shopping-check-row")
    expect(rows.first).to_be_visible()
    item = rows.first.get_attribute("data-ingredient-id")
    quantity = rows.count()
    exported = page.locator("#shopping-copy-text").input_value()
    assert exported

    page.locator("#tab-settings").click()
    page.locator("#settings-tab-display").click()
    expect(page.locator("#offline-state")).to_contain_text("オフラインで使えます", timeout=90000)
    page.wait_for_function("navigator.serviceWorker.controller !== null")
    assert page.evaluate("async () => (await navigator.serviceWorker.ready).scope") == url
    manifest = context.new_cdp_session(page).send("Page.getAppManifest")
    assert not manifest["errors"] and json.loads(manifest["data"])["display"] == "standalone"
    page.close()

    # タブをすべて閉じて配信も止め、未購入リストへのショートカットから起動。
    server.shutdown()
    server.server_close()
    context.set_offline(True)
    verify_android_app(context, url)
    page = context.new_page()
    # iOSのホーム画面が伝えるフラグを与え、起動用の絵も通信なしで表示できるか確かめる。
    page.add_init_script("""
        Object.defineProperty(navigator, 'standalone', {value: true});
        document.addEventListener('load', event => {
          if (event.target.matches?.('#launch-screen img')) {
            const bounds = event.target.getBoundingClientRect();
            window.seenSplash = [event.target.naturalWidth, event.target.naturalHeight,
              getComputedStyle(event.target).objectFit, !event.target.parentElement.hidden,
              bounds.width <= innerWidth + 1 && bounds.height <= innerHeight + 1];
          }
        }, true);
    """)
    page.goto(url + "#shopping")
    page.wait_for_function("window.seenSplash")
    assert page.evaluate("window.seenSplash") == [1143, 2048, "contain", True, True]
    expect(page.locator("#launch-screen")).to_be_hidden()
    expect(page.locator("#panel-kitchen")).to_be_visible()
    check_app_only(page)
    expect(page.locator(".shopping-check-row")).to_have_count(quantity)
    assert page.locator("#shopping-copy-text").input_value() == exported
    page.locator(f'.shopping-check-row[data-ingredient-id="{item}"] input[type=checkbox]').click()
    page.locator("#kitchen-tab-purchased").click()
    page.locator(".shopping-stock-receipt").first.click()
    page.reload()
    page.locator("#kitchen-tab-purchased").click()
    expect(page.locator("#shopping-purchased-list")).to_contain_text("手持ちに追加済み")
    state = json.loads(journal_bytes(page))
    receipt = next(r for r in state["shoppingReceipts"] if r["ingredientId"] == item)
    assert receipt["stocked"]
    assert any(p["id"] == item and p["amount"] == receipt["amount"] for p in state["pantry"])
    verify_app_settings(page)
    assert not errors, errors


if __name__ == "__main__":
    app = Path(__file__).resolve().parents[2]
    with TemporaryDirectory() as temp:
        site = Path(temp)
        folder = site / "course" / "projects"
        folder.mkdir(parents=True)
        stage_fixture(app, folder / "recipe-suggester")
        with LocalSite(("127.0.0.1", 0), partial(Handler, directory=str(site))) as server:
            Thread(target=server.serve_forever, daemon=True).start()
            with sync_playwright() as runner:
                chrome = shutil.which("google-chrome") or shutil.which("chromium")
                with runner.chromium.launch(executable_path=chrome, args=["--no-sandbox"]) as browser:
                    url = f"http://127.0.0.1:{server.server_port}/course/projects/recipe-suggester/"
                    verify_accounts(browser, url, FixtureDatabase())
                    verify_personal_nutrition(browser, url, FixtureDatabase())
                    verify_birthday_family(browser, url, FixtureDatabase())
                    verify_drive_photos(browser, url)
                    verify_browser_install(browser, runner.devices, url)
                    context = browser.new_context(viewport={"width": 390, "height": 844}, locale="ja-JP")
                    FixtureDatabase().connect(context)
                    verify(context, url, server)
    print("スマホの追加案内・講義リンクの切り替え・デモ分離・調理・オフライン再起動・購入と在庫保存を確認しました。")
