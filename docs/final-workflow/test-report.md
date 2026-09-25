# FlowDesk テスト計画・結果

## 実行環境

- 対象ブランチ: `feat/final-workflow`
- ブラウザ: Chrome最新版を推奨
- DB/API: Supabase
- 実行前提: マイグレーション、`admin-users` Edge Function、テストアカウントの反映が完了していること

## テストアカウント

| 権限 | メールアドレス | 用途 |
|---|---|---|
| 一般ユーザーA | `requester-a@example.com` | 案件作成・申請 |
| 一般ユーザーB | `requester-b@example.com` | 他人の案件を閲覧できないことの確認 |
| 承認者 | `approver@example.com` | 営業部の承認 |
| 作業担当者A | `worker-a@example.com` | 割り当て・作業更新 |
| 作業担当者B | `worker-b@example.com` | 担当外更新の拒否確認 |
| 管理者 | `admin@example.com` | 担当者設定・ユーザー/マスタ管理 |

パスワードはリポジトリに保存せず、セットアップ時の `TEST_PASSWORD` を使用します。

## 自動・静的確認

| 確認項目 | 結果 | 根拠 |
|---|---|---|
| フロントエンドJavaScript構文 | PASS | `node --check apps/final-workflow/app.js` |
| SQL関数の重複定義 | PASS | 26関数を抽出し重複なし |
| SQL dollar quote対応 | PASS | `$$` の開始・終了数が一致 |
| 業務テーブル直接更新権限 | PASS | `authenticated` への直接INSERT/UPDATE/DELETE付与なし |
| 公開RPCの実行権限 | PASS | 17公開RPCすべてに個別GRANTあり |
| フロントの危険なHTML挿入 | PASS | `innerHTML` 未使用、ユーザー値は `textContent` で描画 |
| Service Role Keyの混入 | PASS | フロントエンドおよび設定ファイルに未記載 |
| 静的検査の再現性 | PASS | `scripts/check-final-workflow.mjs` を実行し全項目PASS |
| GitHub Actions | 実行待ち | push後に `Final workflow checks` が自動実行 |

## 必須シナリオ

DB反映後、`scripts/test-final-workflow.mjs` でAPIレベルの一括検証を行い、その後ブラウザでも以下を順番に確認して結果欄を更新します。現時点ではリモートSupabaseへ未反映のため、統合テストは `未実施` としています。未実施をPASSとして扱いません。

| # | 操作 | 期待結果 | 結果 |
|---|---|---|---|
| 1 | 一般Aが下書きを作成して申請。承認者でログイン | 承認待ち一覧へ表示 | 未実施 |
| 2 | 承認者が案件を承認 | 状態が承認済み、申請者へ通知 | 未実施 |
| 3 | 管理者が担当者Aを設定 | 担当者Aの担当案件へ表示、通知生成 | 未実施 |
| 4 | 担当者Aが開始後に完了 | 一般A側でも完了を確認 | 未実施 |
| 5 | 一般Bで一般Aの案件URL相当のIDを直接取得 | RLSにより0件または権限エラー | 未実施 |
| 6 | 一般AがREST/RPCで承認済みへ強制変更 | 直接更新権限なし、承認RPCはロール拒否 | 未実施 |
| 7 | 担当者Bが担当者Aの案件を開始/完了 | RPCが担当外として拒否 | 未実施 |
| 8 | 案件詳細の操作履歴を確認 | 作成、申請、承認、割当、状態変更が時系列表示 | 未実施 |

## 追加の異常系

| 操作 | 期待結果 |
|---|---|
| 却下・差し戻し理由を空にする | RPCが拒否し、画面に理由必須を表示 |
| 10 MiB超または許可外形式を添付 | ブラウザとStorage双方で拒否 |
| 同じ案件を別タブで編集 | `version` 不一致を検出し再読み込みを促す |
| 無効化済みユーザーの既存セッションで操作 | RLS/RPC/Edge Functionが拒否 |
| 管理者が自分を無効化・管理者以外へ変更 | Edge Functionが拒否 |
| 存在しない案件IDを開く | 内容を表示せずエラー表示、画面全体は維持 |

## 完了判定

必須8シナリオを実環境で実行し、すべてPASSに更新してから提出版とします。不具合が出た場合は、ブラウザのNetwork、Edge Functionログ、Postgresログの順に、認証・RLS・RPC・入力制約のどこで拒否されたかを切り分けます。
