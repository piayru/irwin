# Irwin 六項開發工作流程驗收

日期：2026-10-06（Asia/Taipei）。本次僅實作使用者指定的六項功能；保留原有未提交修改。驗收包版本沿用 `0.1.2`，未發布。

## 已完成的功能

| 項目                   | 實作結果                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安裝及常見部署驗收     | 增加 Windows 安裝／覆裝／解除安裝、WSL Docker standalone／帳密／單節點 replica set，以及外部服務唯讀驗收指令；JSON 收據列明實測與待驗項目。              |
| 匯出範圍及命名         | 結果統一「匯出結果」入口，區分已載入與全部符合條件；名稱含 `loaded`／`all-matching`，完整 BSON JSON 串流使用 `.jsonl`，不套用目前頁面 offset。           |
| Aggregation 語法與除錯 | 增加現代唯讀階段、已知版本檢查、完整 Pipeline 貼入、實際錯誤階段定位與階段輸入／輸出取樣比較；巢狀寫入階段仍拒絕。                                       |
| 查詢交付與團隊查詢包   | Node.js／TypeScript、Python Driver 程式碼交付；Find／Shell／Pipeline 查詢包含名稱、分組、描述與型別參數，先預覽再交易式匯入，產生新 ID，套用不自動執行。 |
| 可重現效能診斷         | Find／Aggregation 保存最近 200 筆 Explain、條件、Hint／Collation／Skip、索引、版本、環境與時間；可命名、比較、匯入／匯出及重啟後載入。                   |
| 右下角狀態通知         | 成功與錯誤通知皆可手動關閉，最新通知顯示五秒後消失；失敗的草稿與表單錯誤保留。                                                                           |

操作說明見 [查詢與資料探索](../EXPLORATION_GUIDE.md)，驗收指令見 [TESTING](../TESTING.md#developer-workflow-and-deployment-acceptance)。

## 自動測試與封裝

- `pnpm typecheck`：通過。
- `pnpm test --maxWorkers=4`：72 個測試檔、397 項測試全數通過。
- `pnpm build`：通過；沿用既有 Vite 大型 chunk 提示。
- 第三方授權清單與 Database Tools 檢查：通過。
- `node scripts/verify-package.mjs --unpacked .runtime/workflow-release/win-unpacked`：`PASSED`。
- 封裝版開發工作流程：9 項通過，無 Renderer 錯誤，見 [workflow 收據](developer-workflows.json)。
- 封裝版既有桌面流程：59 項通過，無 Renderer 錯誤；系統剪貼簿回讀未完成，僅驗證 Electron copy API 的內容，見 [桌面收據](desktop.json)。
- 已儲存查詢既有 E2E：12 項通過；既有 Aggregation E2E 與真實 Renderer 成功／錯誤通知 E2E 通過。
- 實際匯出的 Node Driver 對 205 筆資料執行成功，Int64 `9007199254740993` 保留；Python 匯出檔經 Python AST 語法檢查通過，未對實際 PyMongo 服務執行。

桌面場景使用隔離設定與 MongoDB 8.0.18 可拋棄測試資料。查詢包、參數與診斷的儲存重啟、BSON 型別、匯入交易與唯讀限制有單元／整合測試及實際 Electron 流程覆蓋。

## 常見 MongoDB 部署

Windows 經 WSL Ubuntu 執行 Docker，使用本機 `mongo:8.0` 映像；實際伺服器版本 **8.0.29**。

| 部署               | 結果     |
| ------------------ | -------- |
| Standalone         | 9 項通過 |
| 帳密驗證           | 9 項通過 |
| 單節點 Replica Set | 9 項通過 |
| 本次專屬容器清理   | 3 項通過 |

27 項涵蓋連線、BSON 精度、分頁與取消、Aggregation、Explain／索引、巢狀寫入拒絕、生產唯讀保護、條件式欄位更新及重連。清理前核對 run label、名稱與完整容器 ID；收據不含 URI 或密碼。見 [部署收據](deployments.json)。

## Windows 安裝實測

| 項目                           | 記錄                                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| 系統                           | Windows x64，`10.0.26200.0`                                        |
| 安裝包                         | `Irwin-0.1.2-win-x64.exe`，152,902,537 bytes                       |
| SHA-256                        | `1bce154acccb85197f90655aa029b34f3226aa9ab50ead043beef456083dad6f` |
| 簽章                           | `NotSigned`                                                        |
| 原生安裝、啟動、Database Tools | 通過                                                               |
| 同版覆裝保留設定與已儲存查詢   | 通過                                                               |
| 移除工作區測試安裝             | 通過，人工補驗                                                     |
| 修正後腳本拒絕既有安裝         | 通過                                                               |

安裝／覆裝在工作區專屬目錄及隔離 user data 中執行。首次驗收腳本未辨識 `Irwin <版本>` 的登錄名稱，且在產生收據時碰到繼承 PowerShell 7 模組路徑的問題，未完整自動結束。已修正版本名稱／GUID 辨識、HKCU 精確安裝位置驗證與 Windows PowerShell 模組環境。之後核對本次 HKCU InstallLocation，使用該目錄的 uninstaller `/currentuser` 完成人工補驗；既有全機執行檔的 SHA-256 及登錄安裝位置確認未變。

修正後腳本在此機辨識既有全機安裝並於安裝前停止，未再次安裝。完整自動腳本仍須在乾淨 Windows profile／VM 重新跑；本次原生安裝結果是自動安裝／覆裝與人工解除安裝的組合，不能宣稱乾淨機器全自動驗收通過。細節見 [安裝收據](installation.json)。

## 仍待實機驗收

- 乾淨 Windows 機器的完整自動安裝流程、下載後 SmartScreen 行為、從較舊 release 升級。
- 原生 macOS 與 Ubuntu 安裝、啟動及桌面操作；WSL 測試不代表原生 Linux 桌面驗收。
- Atlas／外部 TLS 與 Cosmos DB 真實帳號；已提供 `pnpm accept:external`，使用環境變數設定並只讀指定集合。
- 多主機 Replica Set 選主與真正 Sharded Cluster。
- GitHub Actions 已加入驗收步驟，本次未觸發雲端 CI。

階段除錯比較的是兩次獨立取樣，診斷索引在 Explain 後讀取；兩者皆非同一時間點快照。匯出的查詢包與診斷可包含實際資料值，分享前可在預覽／JSON 檢視確認內容。效能比較須考慮資料、快取與負載差異。
