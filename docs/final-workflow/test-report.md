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
| GitHub Actions | PASS | `Final workflow checks` run `36134991281` が成功 |

## 必須シナリオ

2026-09-25、リモートSupabase上で認証ユーザーを切り替えながら、RLS・RPC・監査履歴を含む一括統合テストを実施しました。テスト案件 `4507c596-116e-4b43-a612-ffe4f8464bfb` は `completed` まで到達し、不正操作はすべてサーバー側で拒否されました。

| # | 操作 | 期待結果 | 結果 |
|---|---|---|---|
| 1 | 一般Aが下書きを作成して申請。承認者でログイン | 承認待ち一覧へ表示 | PASS |
| 2 | 承認者が案件を承認 | 状態が承認済み、申請者へ通知 | PASS |
| 3 | 管理者が担当者Aを設定 | 担当者Aの担当案件へ表示、通知生成 | PASS |
| 4 | 担当者Aが開始後に完了 | 一般A側でも完了を確認 | PASS |
| 5 | 一般Bで一般Aの案件URL相当のIDを直接取得 | RLSにより0件または権限エラー | PASS |
| 6 | 一般AがREST/RPCで承認済みへ強制変更 | 直接更新権限なし、承認RPCはロール拒否 | PASS |
| 7 | 担当者Bが担当者Aの案件を開始/完了 | RPCが担当外として拒否 | PASS |
| 8 | 案件詳細の操作履歴を確認 | 作成、申請、承認、割当、状態変更が時系列表示 | PASS |

### 実行結果

- 必須シナリオ: **8 / 8 PASS**
- 最終状態: `completed`
- 申請者: `requester-a@example.com`
- 承認者: `approver@example.com`
- 担当者: `worker-a@example.com`
- 操作履歴: `created` → `submitted` → `approved` → `assigned` → `started` → `completed`
- 拒否確認: 他人の案件閲覧、一般ユーザーの直接更新・承認RPC、担当外作業者の開始RPC

画面表示や操作感の最終確認は、公開URLへフロントエンド設定を反映した後に別途行います。今回のPASSは、リモートDB上での権限・状態遷移・RLS・監査履歴の統合結果です。

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

必須8シナリオのサーバー側統合テストはすべてPASSです。公開URLでの画面確認を終えた後に提出版とします。不具合が出た場合は、ブラウザのNetwork、Edge Functionログ、Postgresログの順に、認証・RLS・RPC・入力制約のどこで拒否されたかを切り分けます。
