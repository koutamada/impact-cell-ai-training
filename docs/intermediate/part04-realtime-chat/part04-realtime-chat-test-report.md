# 中級編 Part 4：リアルタイムチャットアプリ 実環境テスト報告書

## 1. 基本情報

| 項目 | 内容 |
|---|---|
| 実施日 | 2026-09-12〜2026-09-13 |
| 確認環境 | ローカル環境、GitHub Pages |
| バックエンド | Supabase実プロジェクト |
| テスト利用者 | テスト用2アカウント |

メールアドレス、利用者UUID、APIキー、認証トークン等の識別情報・秘密情報は本書に記載しない。

## 2. 確認済み項目

- `database/setup.sql`を同じプロジェクトで2回実行し、両方成功
- アカウント作成、メール確認、ログイン、ログアウト
- 2アカウントそれぞれのセッション復元
- パスワード再設定画面、パスワード変更、旧パスワード拒否、新パスワードでのログイン
- プロフィール初回登録、ユーザー名変更、相手画面への変更名のRealtime反映
- 2アカウント間のRealtime送受信と、自分・相手メッセージの左右表示
- 切断、再接続中、接続済みの状態遷移と再接続後の復帰
- Enter送信、Shift+Enter改行、1000文字上限
- 長文メッセージのPC・375px表示
- ユーザー名と本文へXSS確認用文字列を入力し、HTMLとして実行されず文字列として表示されること
- 105件のテストデータで、最新50件、追加50件、残り5件、履歴終端、重複なし、追加取得時の閲覧位置維持
- RLS・列権限テスト：12/12 PASS、FAIL 0件
- RLS試験で作成したテストデータの削除
- PC・375pxでページ全体に横スクロールが発生しないこと

## 3. RLS・列権限テスト結果

| No. | 確認内容 | 結果 |
|---:|---|:---:|
| 1 | 未認証で`profiles`をSELECTできない | PASS |
| 2 | 未認証で`messages`をSELECTできない | PASS |
| 3 | 認証済みでは`profiles`と`messages`をSELECTできる | PASS |
| 4 | ユーザーAがユーザーB名義の`messages`をINSERTできない | PASS |
| 5 | ユーザーAがユーザーBの`profiles`をUPDATEできない | PASS |
| 6 | ユーザーAが自分の`username`だけをUPDATEできる | PASS |
| 7 | `messages`をUPDATEできない | PASS |
| 8 | `messages`をDELETEできない | PASS |
| 9 | `messages`のINSERT時に任意の`id`を指定できない | PASS |
| 10 | `messages`のINSERT時に任意の`created_at`を指定できない | PASS |
| 11 | `profiles`のINSERT／UPDATE時にDB管理列を指定できない | PASS |
| 12 | 自分名義の通常メッセージINSERTは成功し、DBで採番される | PASS |

**集計：PASS 12件／FAIL 0件**

## 4. 静的確認

- JavaScript構文エラーなし
- HTMLのID重複なし
- ローカル参照切れなし
- DB由来のユーザー名・本文をXSS危険APIへ直接挿入していない
- secret key、service role key、DBパスワードの混入なし
- 同梱したsupabase-js 2.111.0と公式npmパッケージのSHA-256が一致
- supabase-jsの`LICENSE`を同梱
- 自作ファイルに対する`git diff --check`成功
- vendorファイルに元から存在する末尾空白は改変せず、公式ファイルとの一致を維持

## 5. 制約・補足

- Supabase標準SMTPには送信先の制限と、1時間当たり2通の送信制限がある。
- メールリンクの`redirectTo`修正後のURL生成と呼び出しは静的確認済みである。
- recovery処理自体は、認証コードをlocalhostのアプリURLへ引き継いだ状態で実動確認済みである。
- 一時的なRLSテストページ、入力した認証情報、認証トークンは削除済みである。

## 6. 公開先・実装commit

- 公開URL：[Part 4 リアルタイムチャットアプリ](https://koutamada.github.io/impact-cell-ai-training/apps/intermediate/part04-realtime-chat/)
- 実装commit：`6bcc3dc`

