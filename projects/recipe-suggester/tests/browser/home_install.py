"""モバイルの追加案内と、ホーム画面アプリの表示を別々のブラウザー状態で確認する。"""
import re

from playwright.sync_api import expect
from account_flow import FixtureDatabase, login_as


INSTALL_LABEL = "スマホにアプリをインストール"
COURSE_LINKS = (
    'a[href="../../"]',
    'a[href*="SmartChef"]',
    'a[href*="colab.research.google"]',
    'a[href*="github.com/shogo-ishikawa/2026_3Q_M3Th3"]',
    'a[href^="dist/"][download]',
)


def verify_browser_install(browser, devices, url):
    for device, guide in (("iPhone 13", "#install-ios-guide"), ("Pixel 7", "#install-android-guide")):
        context = browser.new_context(**devices[device], locale="ja-JP", service_workers="block")
        FixtureDatabase().connect(context)
        # 自動判定のタイミングに依存せず、案内のみ／標準プロンプトありの順に試す。
        context.add_init_script("""
            window.addEventListener('beforeinstallprompt', event => {
              if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); }
            }, {capture: true});
        """)
        page = context.new_page()
        page.goto(url)
        locked_install = page.locator("#account-gate [data-install-app]")
        expect(locked_install).to_be_visible()
        locked_install.click()
        expect(page.locator(guide)).to_be_visible()
        page.locator("#close-install-guide").click()
        login_as(page)
        header = page.locator("#install-meal-palette-header")
        expect(header).to_have_accessible_name(INSTALL_LABEL)
        expect(header).to_be_in_viewport()
        header.click()
        expect(page.locator("#install-guide")).to_be_visible()
        expect(page.locator(guide)).to_contain_text("ホーム画面に追加")
        expect(page.locator(guide)).to_be_visible()
        other = "#install-android-guide" if device == "iPhone 13" else "#install-ios-guide"
        expect(page.locator(other)).to_be_hidden()
        page.locator("#close-install-guide").click()
        expect(header).to_be_focused()

        page.locator("#tab-settings").click()
        settings = page.locator("#install-meal-palette")
        expect(settings).to_have_accessible_name(INSTALL_LABEL)
        if device == "Pixel 7":
            page.evaluate("""() => {
              window.promptCount = 0;
              const offer = new Event('beforeinstallprompt', {cancelable: true});
              offer.prompt = async () => { window.promptCount++; };
              offer.userChoice = Promise.resolve({outcome: 'dismissed'});
              window.dispatchEvent(offer);
            }""")
            settings.click()
            assert page.evaluate("window.promptCount") == 1
            expect(page.locator("#install-guide")).to_be_hidden()
        settings.click()
        expect(page.locator(guide)).to_be_visible()
        page.keyboard.press("Escape")
        expect(settings).to_be_focused()
        if device == "Pixel 7":
            assert page.evaluate("window.promptCount") == 1
            page.evaluate("window.dispatchEvent(new Event('appinstalled'))")
            expect(settings).to_be_hidden()
            expect(header).to_be_hidden()
        # 通常タブでインストールが完了しても、ブラウザー版には作品へのリンクが残る。
        expect(page.locator('footer a[href*="SmartChef"]')).to_be_visible()
        context.close()


def check_app_only(page):
    for selector in COURSE_LINKS:
        expect(page.locator(selector + ":visible")).to_have_count(0)
    expect(page.locator("[data-install-app]:visible")).to_have_count(0)
    expect(page.locator("body")).not_to_contain_text(
        re.compile("学生の|作品ギャラリー|講義|この教材|外部の教材"), use_inner_text=True
    )


def verify_app_settings(page):
    page.locator("#tab-settings").click()
    expect(page.locator("#home-installed")).to_be_visible()
    expect(page.locator("#offline-state")).to_be_visible()
    # 折り畳んだ説明の中に教材リンクが残っていないかも調べる。
    for disclosure in page.locator(".about-section:visible").all():
        disclosure.locator("summary").click()
    check_app_only(page)


def verify_android_app(context, url):
    page = context.new_page()
    page.add_init_script("""
        const browserMatchMedia = window.matchMedia.bind(window);
        window.matchMedia = query => query === '(display-mode: standalone)'
          ? browserMatchMedia('(min-width: 0px)') : browserMatchMedia(query);
    """)
    page.goto(url)
    expect(page.locator("#panel-planner")).to_be_visible()
    check_app_only(page)
    verify_app_settings(page)
    page.reload()
    expect(page.locator("#panel-settings")).to_be_visible()
    check_app_only(page)
    sample_link = page.locator("#setup-actions [data-sample-link]")
    expect(sample_link).to_have_attribute("target", "_self")
    tabs = len(context.pages)
    sample_link.click()
    expect(page.locator("#sample-session")).to_be_visible()
    expect(page.locator("#panel-nutrition")).to_be_visible()
    check_app_only(page)
    page.get_by_role("link", name="お試しを終了").click()
    expect(page.locator("#sample-session")).to_be_hidden()
    expect(page.locator("#panel-planner")).to_be_visible()
    check_app_only(page)
    assert len(context.pages) == tabs
    page.close()
