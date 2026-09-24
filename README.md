# Impact Cell AI駆動開発トレーニング

各トレーニング課題と最終課題を収録するリポジトリです。最終課題では、申請・承認・担当者割り当て・作業完了を一つにつないだ社内業務依頼ワークフロー「FlowDesk」を実装しています。

## 最終課題 FlowDesk

- アプリ: [`apps/final-workflow/`](apps/final-workflow/)
- 設計書: [`docs/final-workflow/final-workflow-spec.md`](docs/final-workflow/final-workflow-spec.md)
- DB構成: [`docs/final-workflow/database.md`](docs/final-workflow/database.md)
- テスト計画・結果: [`docs/final-workflow/test-report.md`](docs/final-workflow/test-report.md)
- DBマイグレーション: [`supabase/migrations/`](supabase/migrations/)
- 管理者用Edge Function: [`supabase/functions/admin-users/`](supabase/functions/admin-users/)

### 技術構成と選定理由

| 技術 | 用途 | 選定理由 |
|---|---|---|
| HTML / CSS / Vanilla JavaScript | フロントエンド | 既存の中間課題と構成を揃え、フレームワーク固有処理ではなく認証・権限・状態遷移を説明しやすくするため |
| Supabase Auth | ログイン・セッション | 既存プロジェクトを再利用でき、PostgreSQLの `auth.uid()` とRLSを直接連携できるため |
| Supabase PostgreSQL | 永続化・状態遷移 | トランザクション、制約、RLS、RPCによりサーバー側で不正操作を拒否できるため |
| Supabase Storage | 添付ファイル | 非公開バケットとRLSで案件閲覧権限とファイル権限を揃えられるため |
| Supabase Edge Functions | ユーザー管理 | Service Role Keyをブラウザへ公開せずAuth管理APIを実行するため |
| GitHub Pages | 静的ホスティング | 既存の公開方法を継続利用できるため |

### 主な機能

- 4権限（一般ユーザー、承認者、作業担当者、管理者）
- `下書き → 承認待ち → 承認済み → 対応中 → 完了` と、却下・差し戻し
- コメント、添付ファイル、通知と既読管理、操作履歴
- ステータス・カテゴリ・優先度・担当者・期限・キーワード検索
- ロール別ダッシュボード
- 管理者によるユーザー、部署、カテゴリ管理
- RLSと権限確認付きRPCによるURL/API直接操作対策

## セットアップ

### 1. 必要なもの

- Node.js 20以降
- Python 3（静的サーバー用。別のHTTPサーバーでも可）
- Supabase CLI
- Supabaseプロジェクトへの操作権限

### 2. Supabaseを反映

```bash
supabase login
supabase link --project-ref oootrzkkkzgshnmocnzw
supabase db push
supabase functions deploy admin-users
```

`SUPABASE_SERVICE_ROLE_KEY` はEdge Function側にSupabaseの組み込みシークレットとして提供されます。ソースコードや `config.js` へ記載しないでください。

### 3. テストアカウントを作成

サービスロールキーはSupabase Dashboardの Project Settings → API Keys から取得し、実行するシェルの環境変数にだけ設定します。

```bash
SUPABASE_URL=https://oootrzkkkzgshnmocnzw.supabase.co \
SUPABASE_SERVICE_ROLE_KEY='YOUR_SERVICE_ROLE_KEY' \
TEST_PASSWORD='12文字以上のテスト用パスワード' \
node scripts/setup-final-workflow-test-users.mjs
```

同じメールアドレスが存在する場合は再利用し、プロフィールと部署設定を更新するため、再実行できます。

### 4. フロントエンドを起動

```bash
python3 -m http.server 8000
```

[http://localhost:8000/apps/final-workflow/](http://localhost:8000/apps/final-workflow/) を開きます。別のSupabaseプロジェクトを使う場合は `apps/final-workflow/config.example.js` を `config.js` としてコピーし、公開可能なProject URLとPublishable Keyだけを設定します。

### 5. テストを実施

`docs/final-workflow/test-report.md` の順に4権限のブラウザセッションを切り替えて確認します。権限回避テストは、開発者ツールからRPCを直接実行してサーバーが拒否することまで確認してください。

## セキュリティ上の要点

- UIのボタン表示だけに依存せず、全テーブルをRLSで保護しています。
- 状態変更はテーブルへの直接更新ではなく、ロール・現在状態・対象者・楽観ロックを確認するRPCだけを許可しています。
- 管理APIはJWTを検証し、DB上で有効な管理者か再確認します。
- 添付ファイルは非公開バケットに保存し、ダウンロード時に短時間の署名URLを発行します。
- Service Role Key、DB接続情報、テストパスワードはコミットしません。

