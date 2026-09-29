# FlowDesk 提出物チェックリスト

最終課題の提出時に提示する情報を、指定された7項目に対応させた一覧です。公開リポジトリへ秘密情報を保存しないため、テスト用共通パスワードだけは提出フォームなどの非公開欄へ別途記入します。

## 1. 完成したアプリケーション

- 公開URL: https://koutamada.github.io/impact-cell-ai-training/apps/final-workflow/
- アプリ名: FlowDesk（社内業務依頼ワークフロー）
- 公開環境: GitHub Pages + Supabase

## 2. ソースコード一式

- リポジトリ: https://github.com/koutamada/impact-cell-ai-training
- フロントエンド: `apps/final-workflow/`
- DBマイグレーション: `supabase/migrations/`
- 管理者用Edge Function: `supabase/functions/admin-users/`
- テスト・静的検査スクリプト: `scripts/setup-final-workflow-test-users.mjs`、`scripts/test-final-workflow.mjs`、`scripts/check-final-workflow.mjs`

## 3. README

- URL: https://github.com/koutamada/impact-cell-ai-training/blob/main/README.md
- 内容: 概要、技術構成と選定理由、機能、第三者向けセットアップ、テスト実行方法、セキュリティ要点
- 再構築手順: リポジトリ取得、Supabase反映、テストアカウント作成、フロントエンド設定・起動、テスト実行までを記載

## 4. データベース構成が分かる資料

- DB構成資料: https://github.com/koutamada/impact-cell-ai-training/blob/main/docs/final-workflow/database.md
- 設計書のデータモデル: https://github.com/koutamada/impact-cell-ai-training/blob/main/docs/final-workflow/final-workflow-spec.md
- 実装SQL: https://github.com/koutamada/impact-cell-ai-training/tree/main/supabase/migrations
- 内容: ER図、全9テーブル、状態遷移、RLS・RPC・Storage・Edge Functionの役割、マイグレーション対応

## 5. 使用技術と選定理由

- README「技術構成と選定理由」: https://github.com/koutamada/impact-cell-ai-training/blob/main/README.md#技術構成と選定理由
- 詳細設計: https://github.com/koutamada/impact-cell-ai-training/blob/main/docs/final-workflow/final-workflow-spec.md#3-技術構成
- 主な技術: HTML、CSS、Vanilla JavaScript、Supabase Auth / PostgreSQL / Storage / Edge Functions、GitHub Pages

## 6. テスト用アカウント

すべて同一のテスト用パスワードを使用します。パスワードはリポジトリへコミットせず、提出時に非公開欄へ記載します。

| 権限 | メールアドレス | 主な確認用途 |
|---|---|---|
| 一般ユーザーA | `requester-a@example.com` | 案件作成・申請・進捗確認 |
| 一般ユーザーB | `requester-b@example.com` | 他ユーザー案件の閲覧拒否 |
| 承認者 | `approver@example.com` | 承認・却下・差し戻し |
| 作業担当者A | `worker-a@example.com` | 作業開始・完了 |
| 作業担当者B | `worker-b@example.com` | 担当外操作の拒否 |
| 管理者 | `admin@example.com` | 担当者設定・管理機能 |

- 提出時の共通パスワード: **非公開の提出欄へ、設定済みの共通テスト用パスワードを記入する**
- 受入確認専用に追加したアカウントは、確認後に無効化済みのためログイン用として提出しない

## 7. 実施したテスト内容と結果

- テスト計画・結果: https://github.com/koutamada/impact-cell-ai-training/blob/main/docs/final-workflow/test-report.md
- 受入チェック: https://github.com/koutamada/impact-cell-ai-training/blob/main/docs/final-workflow/acceptance.md
- 必須シナリオ: 8 / 8 PASS
- 公開画面: 4ロールの正常系、通知・履歴・コメント・添付・検索・管理機能をPASS
- 異常系: 権限違反、担当外操作、却下・差し戻し理由空欄、添付形式・容量、競合、無効ユーザー、削除済み案件をPASS
- モバイル: iPhone Safari相当の375px・100%表示をPASS
- 静的検査: `node --check apps/final-workflow/app.js` および `node scripts/check-final-workflow.mjs` をPASS

## 提出直前の確認欄

- [ ] 公開URLをシークレットウィンドウで開き、ログイン画面が表示される
- [ ] リポジトリが提出先の閲覧者から参照できる
- [ ] README、DB構成資料、テスト報告、受入チェックのURLを提出欄へ記載する
- [ ] 上記6アカウントのメールアドレスを記載する
- [ ] 設定済みの共通テスト用パスワードを非公開欄へ記載する
- [ ] パスワード、Service Role Key、Secret Keyを公開リポジトリへ記載していない
