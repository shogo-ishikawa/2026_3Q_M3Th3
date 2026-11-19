"""実際の写真の再符号化と画面を使い、Google Driveの外部通信だけを置き換える。"""
import base64
from email.parser import BytesParser
from email.policy import default
import json
from urllib.parse import urlparse

from playwright.sync_api import expect
from account_flow import FixtureDatabase, journal_bytes, login_as


def verify_drive_photos(browser, url):
    context = browser.new_context(viewport={"width": 390, "height": 844}, locale="ja-JP", service_workers="block")
    FixtureDatabase().connect(context)
    files, calls = {}, []
    enabled = True

    def drive_api(route):
        req = route.request
        headers = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS"}
        if req.method == "OPTIONS":
            route.fulfill(status=204, headers=headers)
            return
        account = req.headers.get("authorization")
        assert account == "Bearer test-drive-member"
        calls.append(req.url)
        path = urlparse(req.url).path
        if not enabled:
            route.fulfill(status=403, headers=headers, json={"error":{"details":[{"reason":"SERVICE_DISABLED"}]}})
        elif path.endswith("/generateIds"):
            route.fulfill(headers=headers,json={"ids":["photo-1"]})
        elif path.startswith("/upload/"):
            mime = BytesParser(policy=default).parsebytes(("Content-Type: "+req.headers["content-type"]+"\r\n\r\n").encode()+req.post_data_buffer)
            meta, pixels = mime.iter_parts()
            item = json.loads(meta.get_payload(decode=True))
            stored = pixels.get_payload(decode=True)
            assert stored.startswith(b"\xff\xd8") and b"PRIVATE-EXIF-LOCATION" not in stored
            assert "permissions" not in item and "parents" not in item
            files[item["id"]] = (item,stored)
            route.fulfill(headers=headers,json={"id":item["id"]})
        elif path.endswith("/files"):
            items = [{"id":key,"name":meta["name"],"size":str(len(photo)),"createdTime":"2026-11-19T03:00:00Z"}
                     for key,(meta,photo) in files.items() if meta["appProperties"]["mealPaletteRecipeV1"] in req.url]
            route.fulfill(headers=headers,json={"files":items})
        else:
            route.fulfill(headers=headers,content_type="image/jpeg",body=files[path.split("/")[-1]][1])

    context.route("https://www.googleapis.com/**", drive_api)
    page = context.new_page()
    page.goto(url)
    login_as(page)
    # 手入力から本人専用のレシピを保存し、そのレシピ詳細を使う。
    page.locator("#tab-record").click()
    page.locator("#manual-form").evaluate("e => { for(let n=e; n; n=n.parentElement) if(n.tagName==='DETAILS') n.open=true; }")
    page.locator("#manual-name").fill("テストの野菜スープ")
    page.locator("#manual-save-db").check()
    page.locator('#manual-form button[type="submit"]').click()

    def open_custom():
        page.locator("#tab-catalog").click()
        page.locator("#custom-catalog-list").evaluate("e => { for(let n=e; n; n=n.parentElement) if(n.tagName==='DETAILS') n.open=true; }")
        entry = page.locator("#custom-catalog-list").get_by_role("button",name="テストの野菜スープ",exact=True)
        entry.click()
        expect(page.locator("#recipe-dialog")).to_be_visible()

    open_custom()
    assert not calls
    panel = page.locator(".drive-photo-panel")
    panel.locator("summary").click()
    panel.get_by_role("button",name="Google Driveに接続").click()
    expect(panel).to_contain_text("まだ保存されていません")
    b64 = page.evaluate("""() => {const c=document.createElement('canvas');c.width=2000;c.height=1000;
      const ctx=c.getContext('2d');ctx.fillStyle='#358';ctx.fillRect(0,0,2000,1000);return c.toDataURL('image/jpeg').split(',')[1];}""")
    raw = base64.b64decode(b64)
    exif = b"Exif\x00\x00PRIVATE-EXIF-LOCATION"
    with_location = raw[:2]+b"\xff\xe1"+(len(exif)+2).to_bytes(2,"big")+exif+raw[2:]
    panel.locator("input[type=file]").set_input_files({"name":"photo.jpg","mimeType":"image/jpeg","buffer":with_location})
    save = panel.get_by_role("button",name="この写真をDriveに保存")
    expect(save).to_be_enabled()
    assert panel.locator("img").evaluate("async e=>{await e.decode();return e.naturalWidth}") == 1600
    save.click()
    expect(panel).to_contain_text("写真をGoogle Driveに保存しました")
    fallback = page.locator(".drive-photo-links")
    fallback.locator("summary").click()
    link = "https://drive.google.com/file/d/fixture_valid_link/view"
    fallback.locator('input[type="url"]').fill(link)
    fallback.get_by_role("button",name="このレシピにリンクを保存").click()
    expect(fallback.locator('li a')).to_have_attribute("href",link)
    before = len(calls)
    page.reload()
    expect(page.locator("#account-content")).to_be_visible()
    open_custom()
    panel.locator("summary").click()
    expect(panel.get_by_role("button",name="Google Driveに接続")).to_be_visible()
    assert len(calls) == before
    panel.get_by_role("button",name="Google Driveに接続").click()
    panel.locator("li button").click()
    expect(panel.locator("img")).to_be_visible()
    assert panel.locator("img").evaluate("async e=>{await e.decode();return e.naturalWidth}") == 1600
    expect(fallback.locator("li a")).to_have_attribute("target","_blank")
    context.route(link,lambda route:route.fulfill(body="private drive viewer",content_type="text/html"))
    with context.expect_page() as event:
        fallback.locator("li a").click()
    event.value.wait_for_url(link)
    event.value.close()
    fallback.get_by_role("button",name="写真 1 のリンクを外す").click()
    expect(fallback.locator("li a")).to_have_count(0)
    state = json.loads(journal_bytes(page))
    assert "drivePhotoLinks" not in state and "data:image" not in json.dumps(state)
    enabled = False
    panel.get_by_role("button",name="写真の一覧を更新").click()
    expect(panel).to_contain_text("APIが有効になっていません")
    context.close()
