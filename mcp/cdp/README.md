# cdp MCP

Chromium-এর **আসল** DevTools Protocol backend-এ কথা বলে এমন একটি local stdio MCP
server (`server.mjs`, শূন্য npm dependency)। Node-এর built-in `WebSocket` দিয়ে
সরাসরি CDP command পাঠায় — কোনো Playwright/Puppeteer wrapper নেই, কোনো mock page
নেই। DOM, marker, console, network, screenshot, interaction — সব real browser
থেকে আসে।

## Browser খোঁজার ক্রম

1. `CDP_ENDPOINT` / `--endpoint` — আগে থেকে চলা Chromium (127.0.0.1/localhost/::1 only)
2. `CDP_BROWSER_PATH`
3. PATH-এর `chromium`, `google-chrome`, `google-chrome-stable`, `chrome`
4. Playwright cache (`~/.cache/ms-playwright/...`, macOS/Windows path সহ)

Ubuntu-র `/usr/bin/chromium-browser` snap stub একটা shell script — ওকে browser ধরা
হয় না। শুধু real ELF/Mach-O/PE executable গ্রহণ করা হয়। তাই snap না থাকলেও
Playwright-এর bundled Chromium পাওয়া গেলে CDP কাজ করে।

`cdp_status` শুধু পড়ে — MCP boot-এ কোনো browser launch হয় না। `cdp_launch` একটি
temporary profile বানিয়ে `--headless=new --remote-debugging-port=0` দিয়ে চালায়,
`DevToolsActivePort` পড়ে endpoint নেয়, আর session শেষে browser+profile পরিষ্কার
করে। কোথাও Chromium না থাকলে honest ভাবে:

```json
{ "ok": false, "code": "CDP_UNAVAILABLE", "editor_fallback": "browser" }
```

তখন OpenCode editor-এর নিজস্ব `browser` tools (Chromium-backed) ব্যবহার করতে হবে।

## Tools (১২টি; mounted name = `cdp_<tool>`)

| Tool | কী দেয় |
|---|---|
| `status` | endpoint/browser/protocol, launchable binary; browser চালু করে না |
| `launch` | discovered Chromium + temp profile, endpoint/pid/profile ফেরত |
| `targets` | real page target list (`/json/list`) |
| `navigate` | URL navigate + `Page.loadEventFired` + final url/title/readyState (+exact viewport) |
| `dom` | selector-এর real outerHTML/innerHTML/text/attributes (`max_chars` cap) |
| `markers` | এক pass-এ headings, landmarks, `data-*`/`aria-*`/`id`/`role` markers, missing-alt image, unnamed control, empty link, unlabeled field, duplicate id |
| `audit` | navigate + markers + console + exceptions + failed request + HTTP ≥400 |
| `screenshot` | exact viewport PNG/JPEG (+`full_page`), real pixel dimension ফেরত |
| `console` | console message + uncaught exception (load-time catch করতে reload) |
| `network` | failed request + HTTP ≥400 (request count সহ) |
| `act` | selector-এ `click`/`focus`/`fill` (native setter + input/change event) |
| `eval` | page-এ JS expression (`awaitPromise` default true) |

সব tool-এ `target_id` দেওয়া যায়; না দিলে প্রথম page target। `cdp_act`/`cdp_eval`
page-এর ভিতরে চলে, OS shell-এ নয়।

## উদাহরণ

```jsonc
// পুরো audit এক pass-এ
{ "url": "http://127.0.0.1:3000/", "width": 1440, "height": 900, "wait_ms": 800 }

// exact-size screenshot (project-এর assets-এ)
{ "width": 1200, "height": 630, "output": "assets/og-1200x630.png" }

// form fill তারপর click
{ "selector": "#email", "action": "fill", "value": "test@example.com" }
{ "selector": "button[type=submit]", "action": "click" }
```

## Safety

- Endpoint শুধু local host; remote URL refuse করা হয় (`CDP_ENDPOINT`)।
- `navigate` শুধু `http(s)`, `file`, `about`, `data` scheme নেয়।
- Own temp profile ব্যবহার করে; user-এর চালু browser profile ছোঁয় না।
- `eval` page context-এ চলে; project ফাইল পড়া/লেখার ক্ষমতা নেই (সেটা `read`/`edit`)।
- কেউ selector না পেলে `{ "ok": false, "reason": "selector not found" }` ফেরত দেয় —
  success নাটক করে না।

## যাচাই

```bash
node mcp/cdp/selfcheck.mjs        # 12 tools + honest status
node --test mcp/cdp/test/*.test.mjs
node mcp/cdp/e2e-live.mjs        # real Chromium: dom+markers+console+network+png+click+eval
```
