# Crumbs 麵包屑 for Mac 🐦

整台電腦都能用的麵包屑。住在選單列，自動記下你切到哪個 App、哪個視窗、哪個網頁分頁；任何地方**連按兩下 ⌃**（或 ⌃⌥Z），螢幕下方浮出「剛剛你在…」；按「打開主頁」看接下來、足跡、罐子、一週回顧。

- 不用登入，資料只存在這台 Mac：`~/Library/Application Support/Crumbs/crumbs.json`
- 多個 Chrome 設定檔不用分開：它直接問 Chrome「最前面的分頁是哪個」，哪個設定檔的視窗都一樣

## 用法

| 動作 | 怎麼做 |
|---|---|
| 叫出浮動長條 | 任何 App 裡**連按兩下 ⌃**或按 ⌃⌥Z（Esc 收起來）；選單列可換成右 ⌥ / 右 ⌘ |
| 跳回剛剛的地方 | ↑↓ 選、Enter（或直接點）。網頁會切回那個分頁，文件會切回那個視窗 |
| 記下這頁要做什麼 | 直接打字，Enter 存起來；下次回來會提醒「你說過要：…」 |
| 刪掉某個足跡 | 選到它按 ⌫，或點右邊半透明的 ✕ |
| 暫停、開機自動啟動 | 點選單列的小麻雀 |

離開電腦 5 分鐘、螢幕鎖定或睡眠時，會自動停止計時。

## 第一次打開要授權

1. **輔助使用**（系統設定 → 隱私權與安全性 → 輔助使用 → 打開「麵包屑」）：才看得到視窗標題（例如 Word 開的是哪份檔案）。沒授權也能用，但只會記到 App 名稱。
2. **自動化**（切到 Chrome／Safari 時會跳出）：按「好」，才讀得到分頁網址、也才能幫你跳回那個分頁。

> 用 Developer ID 簽名後，重新編譯不會讓授權失效。（沒有憑證時會退回本機簽名，那樣每次編譯都要重新打勾。）

## 編譯

```bash
cd mac
./build.sh
open "build.noindex/Crumbs 麵包屑.app"
```

安裝到「應用程式」並重新開啟：`INSTALL=1 ./build.sh`

## 用 Apple 開發者帳號簽名（給朋友用之前做）

1. Xcode → Settings → Accounts → 登入你的 Apple ID → Manage Certificates → ＋ → **Developer ID Application**
2. 確認憑證名稱：`security find-identity -v -p codesigning`
3. 簽名編譯：
   ```bash
   CODESIGN_ID="Developer ID Application: 你的名字 (TEAMID)" ./build.sh
   ```
4. 公證（notarize），朋友打開才不會被擋：
   ```bash
   ditto -c -k --keepParent build/麵包屑.app build/Crumbs.zip
   xcrun notarytool submit build/Crumbs.zip --apple-id 你的AppleID --team-id TEAMID --password App專用密碼 --wait
   xcrun stapler staple build/麵包屑.app
   ```

## 檔案

```
Sources/main.swift      選單列、權限、開機啟動
Sources/Tracker.swift   追蹤 App／視窗／分頁、閒置偵測、跳回去
Sources/Describe.swift  「你在做什麼」的規則（寫文件、回訊息、做設計…）
Sources/Overlay.swift   ⌥Z 浮動長條
Sources/Hotkey.swift    全域快捷鍵
Sources/Store.swift     資料（足跡、每日時數）
```

## 下一步

- [ ] 一週回顧（整台電腦的版本，資料已經在記了）
- [ ] 接到 Chrome 插件（網頁上的筆記、專案設定共用）
- [ ] 快捷鍵自訂
- [ ] 「接下來做什麼」清單
