# 中級編 Part 4：リアルタイムチャットアプリ 仕様書

- 実装先（将来）：`apps/intermediate/part04-realtime-chat/`
- 本仕様書：`docs/intermediate/part04-realtime-chat/part04-realtime-chat-spec.md`
- 受入チェックリスト：`docs/intermediate/part04-realtime-chat/part04-realtime-chat-acceptance.md`
- 公開先：GitHub Pages
- バックエンド：Supabase Auth / PostgreSQL / REST API / Realtime Postgres Changes
- 対応幅：viewport幅375px以上

---

## 0. 本文書の読み方

### 0.1 要件区分

| 区分 | 意味 | 実装義務 |
| --- | --- | --- |
| `[必須A]` | 課題文または依頼者が明示した要件 | 必須 |
| `[必須B]` | `[必須A]` を安全かつ検証可能に実装するための補完設計 | 必須 |
| `[MVP外]` | 今回は実装しない機能 | 実装禁止 |

### 0.2 実装時の基本方針

- Vanilla HTML/CSS/JavaScriptだけを使用し、ビルド工程を設けない。`[必須A]`
- Supabaseクライアントには公式npmパッケージ `@supabase/supabase-js` 2.111.0のブラウザ用成果物を、内容を変更せずローカル同梱する。CDN、canary、masterブランチのビルドは使用しない。`[必須B]`
- Supabase以外の外部API、分析通信、広告、外部Webフォントを使用しない。`[必須B]`
- 認証、DB権限、データ整合性は画面上の制御だけに依存せず、GRANT、DB制約、RLS Policyでも強制する。`[必須A][必須B]`
- ユーザー入力、DB値、認証・APIエラーを `innerHTML` へ直接挿入せず、`eval` / `new Function` を使用しない。`[必須B]`
- 本書と受入チェックリストに矛盾がある場合、実装で推測せず仕様不備として報告する。

### 0.3 想定ファイル構成 `[必須B]`

```text
apps/intermediate/part04-realtime-chat/
  index.html
  style.css
  app.js
  config.js
  config.example.js
  database/
    setup.sql
  vendor/
    supabase-js/
      supabase.js
      LICENSE
docs/intermediate/part04-realtime-chat/
  part04-realtime-chat-spec.md
  part04-realtime-chat-acceptance.md
```

- 実装時はnpmパッケージ `@supabase/supabase-js@2.111.0` に由来するブラウザ用配布物と同パッケージのライセンスを配置する。
- `node_modules`、`package.json`、lockfile、取得用一時ファイルは成果物へ残さない。
- `config.example.js` はプレースホルダーだけとする。`config.js` に置けるのは公開前提のProject URLとpublishable keyだけである。
- 本依頼では上記アプリファイル、Supabaseプロジェクト、SQLをまだ作成・変更しない。

## 1. 目的と対象範囲

### 1.1 目的 `[必須A]`

メールアドレスとパスワードで認証した利用者が、共通の1チャットルームで履歴を閲覧し、メッセージを送信し、他利用者の新着をリロードなしで受信できるアプリを作成する。Supabase Auth、PostgreSQL、REST、Realtime、RLSを組み合わせ、認証状態、DB権限、非同期競合、切断復旧を安全に扱うことを学習目的とする。

### 1.2 対象利用者 `[必須A]`

- メールアドレスを使ってアカウントを作成・確認できる利用者
- 認証後に一意のユーザー名を登録できる利用者
- デスクトップまたは375px幅のスマートフォンブラウザを利用する利用者

### 1.3 課題クリア条件 `[必須A]`

| クリア条件 | 対応章 |
| --- | --- |
| アカウント作成、ログイン、ログアウト、セッション復元ができる | 7章 |
| ユーザー名を登録・変更できる | 8章 |
| 共通ルームの履歴を50件単位で閲覧できる | 9章 |
| メッセージを送信できる | 10章 |
| 別利用者の新着をリアルタイム受信できる | 11章 |
| RLSにより未認証・他人名義・更新削除を拒否できる | 5章・6章 |
| 375px、キーボード、支援技術で主要操作ができる | 14章・15章 |

### 1.4 MVP範囲 `[必須A]`

- 全ログイン利用者共通の単一チャットルーム
- メール／パスワード認証、メール確認待ち、セッション復元、パスワード再設定
- プロフィールの初回登録と自分のユーザー名変更
- 最新50件、50件単位の過去履歴、Realtime INSERT
- 接続状態、新着案内、条件付き自動スクロール
- SQLで再現できるテーブル、制約、権限、RLS、Realtime publication
- セキュリティ、異常系、競合制御、375px対応

## 2. 固定値と用語

### 2.1 固定値 `[必須B]`

| 項目 | 値 |
| --- | --- |
| チャットルーム | 全ログイン利用者共通の1室 |
| 履歴取得件数 | 1回50件 |
| メッセージ本文 | trim後1〜1000文字 |
| ユーザー名 | trim後2〜30文字、大文字小文字を区別せず一意 |
| 新着自動スクロール判定 | スクロール領域下端から80px以内 |
| supabase-js | 2.111.0固定 |
| Realtime対象 | `public.messages` の `INSERT`、`public.profiles` の `UPDATE` |

### 2.2 用語 `[必須B]`

- 「認証済み」はSupabase Authの有効なセッションがある状態を指す。
- 「プロフィール完成」は現在の `auth.uid()` と同じ `profiles.id` の有効な行が存在する状態を指す。
- 「チャット利用可能」は認証済みかつプロフィール完成の状態を指す。
- 「履歴」はRESTで取得したメッセージ、「新着」はRealtimeまたは再接続補完で取得したメッセージを指す。画面状態ではIDにより同じ集合へマージする。
- 「最下部付近」はメッセージ一覧の `scrollHeight - scrollTop - clientHeight <= 80` とする。

## 3. 画面構成

### 3.1 全体状態 `[必須A][必須B]`

画面は次のいずれか1つを主表示とし、認証・プロフィール状態が確定する前にチャット内容を見せない。

1. 初期確認中／設定未完了
2. 未ログイン認証画面
3. メール確認待ち画面
4. パスワード再設定画面
5. 認証済み・プロフィール未設定画面
6. チャット画面

全状態に、アプリ名、全体通知領域、処理中表示、設定・回復案内を必要に応じて表示する。

### 3.2 未ログイン画面 `[必須A]`

- アプリ説明
- 「アカウント作成」「ログイン」の切替
- メールアドレス入力
- パスワード入力
- 送信ボタン
- 「パスワードを再設定」導線
- 入力エラー、認証エラー、処理中状態

アカウント作成画面でユーザー名を入力させない。サインアップとプロフィール登録は別処理とする。

### 3.3 メール確認待ち・パスワード再設定 `[必須B]`

- メール確認が必要なサインアップでは、送信先メールアドレスを必要以上に再表示せず、確認メールを開いて手続きを完了する案内とログイン画面へ戻る操作を表示する。
- パスワード再設定要求ではメールアドレス入力と送信操作を表示する。送信結果は登録有無を断定しない共通文言とする。
- Supabase Authのrecovery状態では新しいパスワードと確認入力を表示し、正常更新後に通常の認証状態判定へ戻る。

### 3.4 プロフィール未設定画面 `[必須A]`

- ユーザー名入力
- 保存ボタン
- 入力・DBエラー
- ログアウトボタン

有効なプロフィール行の作成が完了するまで、メッセージ一覧、履歴API、Realtime購読、送信欄を利用させない。

### 3.5 チャット画面 `[必須A]`

- ヘッダー：アプリ名、自分のユーザー名、プロフィール編集、ログアウト
- チャットタイトル付近の小型Realtime接続状態：「接続中」「接続済み」「再接続中」「切断」
- メッセージ一覧上端中央の小型ピル型 `↑ 過去を読む` ボタン。独立ツールバーにはせず、約44pxの操作領域を維持する。読み込み中・取得エラー時だけ同位置に状態を表示し、過去がない通常時は操作と専用状態を完全に非表示にする。
- メッセージ一覧スクロール領域
- 上方閲覧時の「新着メッセージ」案内
- 本文入力と送信ボタン
- 送信エラーと送信中状態

チャット表示中はviewport内をトップヘッダー、通知、チャットカード、フッターに分け、チャットカードを `header / toolbar / history / messages / composer` のGridまたはFlexとして構成する。メッセージ一覧へ `min-height: 0` と `overflow-y: auto` を設定し、ページ全体ではなく一覧だけを主なスクロール領域にする。composerは一覧の直下に常時表示し、`fixed`配置で本文やモバイルキーボードへ重ねない。認証・プロフィール設定画面では内容に応じたページスクロールを許可する。

### 3.6 メッセージ表示 `[必須A][必須B]`

- 送信者名、本文、送信日時を表示する。
- 自分のメッセージには「自分」等の文言を併記して右寄せ、他人はユーザー名を表示して左寄せする。色だけに依存しない。
- 本文の改行を維持し、空白のない長い文字列も折り返す。
- 日時は `created_at` を利用者のローカル日時へ変換して表示する。DB値はUTCを含む `timestamptz` のまま保持する。
- Realtimeで受けた `user_id` に対応するプロフィールが未取得なら、認証済み権限で取得するまで「ユーザー名を確認中」等とし、メールアドレスを代替表示しない。

## 4. データモデル

### 4.1 `profiles` `[必須A][必須B]`

| 列 | SQL型・制約 |
| --- | --- |
| `id` | `uuid primary key references auth.users(id) on delete cascade` |
| `username` | `text not null`、trim後2〜30文字、制御文字のみ・制御文字を含む値を拒否 |
| `created_at` | `timestamptz not null default now()` |
| `updated_at` | `timestamptz not null default now()`、更新時にDB triggerで更新 |

- `created_at` はDBの `default` だけが設定し、クライアントのINSERT・UPDATE対象にしない。
- `updated_at` はDBの `default` と更新triggerだけが設定し、クライアントのINSERT・UPDATE対象にしない。
- `unique index on lower(btrim(username))` により大文字小文字と前後空白を無視して重複を拒否する。
- 保存値は `btrim(username)` と一致することをCHECK制約で要求し、クライアントもtrim後の値だけを送る。
- Unicodeの通常文字・空白は許可するが、空文字、空白だけ、制御文字を含む値は拒否する。
- メールアドレス、パスワード、アクセストークン等を独自プロフィール列へ保存しない。

### 4.2 `messages` `[必須A][必須B]`

| 列 | SQL型・制約 |
| --- | --- |
| `id` | `bigint generated always as identity primary key` |
| `user_id` | `uuid not null references public.profiles(id)` |
| `body` | `text not null`、trim後1〜1000文字、保存値はtrim済み |
| `created_at` | `timestamptz not null default now()` |

- `id` は `generated always as identity` だけが採番し、クライアントのINSERT・UPDATE対象にしない。
- `created_at` はDBの `default` だけが設定し、クライアントのINSERT・UPDATE対象にしない。
- 本文は先頭・末尾空白を除去して保存し、内部改行と空白は維持する。
- `id`、`created_at` はクライアント指定を信用せずDBで生成する。
- 履歴・Realtime表示用に `user_id` から `profiles.username` を取得する。履歴メッセージへユーザー名を複製保存しないため、ユーザー名変更は過去メッセージ表示にも反映してよい。
- 安定した並び順用に `(created_at desc, id desc)` のインデックスを作成する。

### 4.3 クライアントメッセージ `[必須B]`

```js
{
  id: string,
  userId: string,
  body: string,
  createdAt: string,
  username: string | null
}
```

- `id` はJavaScriptの安全な整数範囲を超える可能性を考慮し、REST / Realtimeから受けた正の10進整数を文字列として保持する。DOM配列indexや `Number` へ変換した値をIDにしない。
- API応答は必要な列、型、UUID、日時、本文制約を検証し、不正行を部分的に確定状態へ混ぜない。

## 5. DB初期化SQL

### 5.1 冪等性 `[必須A][必須B]`

`database/setup.sql` はSupabase SQL Editorへ貼り付けて繰り返し実行できる構成とする。

- `create table if not exists` を使用する。
- constraint、index、trigger、policy、publication membershipは存在確認後に作成または `drop ... if exists` 後に同一定義で再作成する。
- 実行途中で危険な全件削除を行わない。既存データをDROP/TRUNCATEしない。
- `public` schemaを明示し、関数の `search_path` を固定する。

### 5.2 DB制約とtrigger `[必須B]`

- username：`char_length(btrim(username)) between 2 and 30`、`username = btrim(username)`、制御文字を含まない。
- body：`char_length(btrim(body)) between 1 and 1000`、`body = btrim(body)`、改行・タブ以外の制御文字を含まない。
- `set_updated_at()` trigger関数は `security invoker` 相当の単純代入とし、`profiles` 更新時に `new.updated_at = now()` とする。
- case-insensitive一意制約は `create unique index ... on public.profiles (lower(btrim(username)))` とする。

### 5.3 GRANT `[必須A]`

- setup.sqlは以前の包括的権限が残らないよう、`anon` と `authenticated` から `profiles` / `messages` のテーブル単位権限および既存の列単位権限を一度REVOKEしてから、次の列単位GRANTだけを設定する。

| テーブル | role | 操作 | 許可列 |
| --- | --- | --- | --- |
| profiles | authenticated | SELECT | `id`, `username` |
| profiles | authenticated | INSERT | `id`, `username` |
| profiles | authenticated | UPDATE | `username` |
| profiles | authenticated | DELETE | なし |
| messages | authenticated | SELECT | `id`, `user_id`, `body`, `created_at` |
| messages | authenticated | INSERT | `user_id`, `body` |
| messages | authenticated | UPDATE / DELETE | なし |

- `anon` には `profiles` / `messages` のSELECT、INSERT、UPDATE、DELETEについて、テーブル単位・列単位とも権限を付与しない。
- `profiles.created_at` / `profiles.updated_at`、`messages.id` / `messages.created_at` をクライアントがINSERT・UPDATEできるGRANTを設けない。
- messagesのidentity sequenceは通常のINSERTで採番できる `USAGE` だけを `authenticated` へ付与し、`SELECT`・`UPDATE`等はREVOKEする。`anon` にはsequence権限を付与しない。
- table owner、postgres、service roleの管理権限をクライアント権限として扱わない。

### 5.4 RLS Policy `[必須A]`

両テーブルで `enable row level security` を実行する。Policy名を固定し、再実行時は同名policyを削除してから作成する。

| テーブル | 操作 | role | USING / WITH CHECK |
| --- | --- | --- | --- |
| profiles | SELECT | authenticated | `true` |
| profiles | INSERT | authenticated | `with check (id = (select auth.uid()))` |
| profiles | UPDATE | authenticated | `using (id = (select auth.uid())) with check (id = (select auth.uid()))` |
| profiles | DELETE | なし | Policyを作らない |
| messages | SELECT | authenticated | `true` |
| messages | INSERT | authenticated | `with check (user_id = (select auth.uid()))` |
| messages | UPDATE / DELETE | なし | Policyを作らない |

- `anon` 用Policyを作らない。
- 行の可否はRLS Policy、操作可能な列は列単位GRANTでそれぞれ制限し、両方を同時に満たす要求だけを許可する。
- クライアントはINSERT時に現在セッションのuser IDを設定するが、正当性はRLSの `auth.uid()` で再検証する。
- service_role、`sb_secret_...`、DBパスワード等でRLSを回避する実装を禁止する。

### 5.5 Realtime publication `[必須A][必須B]`

- `public.messages` と `public.profiles` を `supabase_realtime` publicationへ、それぞれ未登録の場合だけ追加する。
- クライアントは `messages` のINSERTと `profiles` のUPDATEだけを購読する。メッセージのUPDATE / DELETE UIはない。
- RLSとSELECT権限がRealtime配信に反映され、未ログイン利用者へpayloadが届かないことを実環境で確認する。

## 6. アプリケーション状態と競合制御

### 6.1 状態 `[必須B]`

```js
{
  configReady: false,
  authStatus: 'checking', // checking | signedOut | confirmationPending | recovery | signedIn | expired
  session: null,
  user: null,
  profile: null,
  profileStatus: 'idle', // idle | loading | missing | ready | saving | error
  messagesById: new Map(),
  orderedMessageIds: [],
  profileNames: new Map(),
  profileNameVersions: new Map(),
  oldestCursor: null,
  newestCursor: null,
  hasOlderMessages: true,
  historyStatus: 'idle', // idle | loadingInitial | loadingOlder | resyncing | error
  sendStatus: 'idle', // idle | sending | error
  realtimeStatus: 'disconnected', // connecting | connected | reconnecting | disconnected
  subscription: null,
  sessionGeneration: 0,
  subscriptionId: 0,
  unreadNewCount: 0,
  isNearBottom: true,
  errors: { auth: null, profile: null, history: null, send: null, realtime: null }
}
```

認証トークンそのものを画面状態のデバッグ表示、独自ログ、DOM属性へ複製しない。

### 6.2 世代管理 `[必須B]`

- 認証ユーザーが変わる、ログアウトする、セッションが失効するたび `sessionGeneration` を増やす。
- 非同期処理開始時にgeneration、user ID、subscriptionIdをスナップショット化し、完了時にすべて現在値と一致する場合だけ状態を更新する。
- 古い履歴、プロフィール、送信、購読コールバックは新しい利用者の画面へ反映しない。
- ログアウトと認証失効では購読を解除し、メッセージ、プロフィール、カーソル、入力中本文をメモリとDOMから消す。

### 6.3 状態変更の原則 `[必須B]`

- DBから成功応答を得た後だけプロフィール・送信結果を確定する。
- RealtimeとRESTはメッセージIDで同じMapへupsertし、表示配列を `(created_at asc, id asc)` で安定整列する。
- プロフィール名はuser IDごとのキャッシュと更新世代を持ち、Realtime UPDATE後に完了した古い補完取得では上書きしない。
- 失敗した送信本文は入力欄へ維持して手動再試行できるようにする。自動再送しない。
- エラーで関係のないセッション、プロフィール、取得済み履歴を消さない。ただし認証失効時は保護データを直ちに非表示・破棄する。

## 7. 認証

### 7.1 初期化とセッション復元 `[必須A][必須B]`

1. configとsupabase-jsを検証する。
2. `createClient` を1回だけ実行する。
3. `getSession`等による初期画面判定より先に `onAuthStateChange` を登録し、`INITIAL_SESSION` を含む認証イベントを直列化・世代管理する。
4. 有効セッションがあれば自分のプロフィールを取得する。
5. プロフィール完成後だけRealtime購読と履歴取得を開始する。

初期確認中に未ログイン画面やチャット履歴を一瞬表示しない。

### 7.2 アカウント作成 `[必須A]`

- メール、パスワードをクライアント検証後、Supabase Auth `signUp` を1回実行する。
- メール確認無効でsessionが返れば、プロフィール未設定画面へ進む。
- メール確認有効でuserは返るがsessionがなければ確認待ちを表示し、チャットへ入れない。
- 同一メールの有無を断定する文言を避け、「登録を完了できませんでした。入力内容またはメールを確認してください」等の共通案内とする。
- パスワード要件はSupabaseプロジェクト設定と整合させ、少なくとも空・設定未満を画面で拒否する。具体的最小長は実装前にプロジェクト設定と同じ値へ固定する。
- `emailRedirectTo` は現在表示中のPart 4アプリURLからqueryとhashだけを除いて生成する。localhostでは同じlocalhost上のPart 4へ、GitHub Pagesでは現在の公開Part 4へ戻す。任意の入力値や固定された別環境URLを使用しない。

### 7.3 ログイン・ログアウト `[必須A]`

- ログインは `signInWithPassword` を使用し、処理中の二重実行を防ぐ。
- 認証失敗はアカウント有無、メール確認有無、パスワード正誤を過度に区別しない。
- ログアウト開始時に送信・履歴の世代を無効化し、購読解除後に `signOut` を行う。送信中でも後着応答を採用しない。
- ログアウト失敗時も保護データを画面へ残すか否かは現在の実セッションを再確認して決め、見かけだけログアウト済みにしない。

### 7.4 認証状態変更と失効 `[必須B]`

- `SIGNED_IN`、`SIGNED_OUT`、`TOKEN_REFRESHED`、`USER_UPDATED`、`PASSWORD_RECOVERY` を処理する。
- `PASSWORD_RECOVERY` を受信したらsessionの有無にかかわらず明示的なrecovery状態を最優先にし、後続・先行する `SIGNED_IN`、`INITIAL_SESSION`、プロフィール取得応答で再設定画面を上書きしない。
- RESTまたはRealtimeがJWT失効を示したらセッションを再確認する。無効なら購読解除、データ破棄、未ログイン画面と再ログイン案内へ移る。
- 同じユーザーのtoken refreshだけで履歴を重複初期化しない。

### 7.5 パスワード再設定 `[必須B]`

- `resetPasswordForEmail` のredirect URLはサインアップと同じ安全な基底URL生成を使い、現在のPart 4アプリURLから既存queryとhashを除いた後、アプリ管理の `authFlow=password-recovery` だけを付与する。これによりSupabaseが `SIGNED_IN` / `INITIAL_SESSION` を返す場合も再設定リンクであることを識別する。
- 生成され得るlocalhost確認URLとGitHub Pages公開URLをSupabase AuthのRedirect URLsへ事前登録する。許可されていない別origin・別pathへは生成しない。
- 要求後はメール登録有無にかかわらず共通の完了案内を表示する。
- recoveryリンクで戻った場合は新パスワードを2回入力させ、一致とプロジェクト要件を検証して `updateUser({ password: newPassword })` する。
- 成功後は入力値とrecovery状態を消去して `signOut` し、チャットへ自動遷移させない。ログイン画面へ戻して「パスワードを変更しました。新しいパスワードでログインしてください。」と表示する。
- recovery中はセッション復元やプロフィール取得を開始せず、すでに開始済みの処理もgeneration不一致で破棄する。ページ再読み込み後は新しい認証イベントにPASSWORD_RECOVERYがない限りrecoveryへ戻さない。
- 初期URLのcode、Auth hash、エラー情報はSupabaseのURL認証処理前に削除・変更・ログ出力しない。更新成功または無効リンク判定の後だけquery/hashを除いたアプリURLへ置き換える。
- 使用済み・期限切れ・不正な再設定リンクは通常ログインへ黙って合流させず、「再設定リンクが無効または期限切れです。もう一度再設定メールを送信してください。」と表示する。

## 8. プロフィール

### 8.1 取得と未設定状態 `[必須A]`

- 認証後、`profiles.id = auth.uid()` を1件取得する。
- 0件はプロフィール未設定として扱い、チャットへ進めない。複数件はDB不整合として停止・通知する。
- 取得失敗を未設定と誤認せず、再試行可能なエラーとして表示する。

### 8.2 登録・変更 `[必須A][必須B]`

- trim後2〜30文字、制御文字なしを画面で検証する。
- 初回登録は `insert({ id: auth.uid(), username })`、変更は自分の行だけを `update({ username })` する。
- 重複はPostgreSQL unique violationを安全な「このユーザー名は使用できません」へ変換し、他情報を表示しない。
- 保存成功後にDBから返されたプロフィールを採用する。
- 編集キャンセルではDB・表示を変更しない。

### 8.3 他利用者プロフィール `[必須A]`

- 認証済み利用者はメッセージ表示に必要な `id` と `username` を閲覧できる。
- 他人のメールアドレス、Auth metadataを取得・表示しない。
- 他人のプロフィールUPDATEはUIを設けず、直接RESTでもRLSにより拒否する。
- `profiles` UPDATEを受信したらプロフィールキャッシュを更新し、同じ `user_id` の表示済みメッセージと以後の新着へ新しいusernameを反映する。自分自身の変更ではチャットヘッダーも更新する。
- メッセージ受信時に送信者プロフィールがキャッシュになければ、認証済み権限でそのIDだけを補完取得する。
- プロフィール補完取得開始時の世代を記録し、その後に届いたRealtime UPDATEより古いREST結果でキャッシュを上書きしない。UPDATEとメッセージの到着順にかかわらず、既知の新しい名前を旧名へ戻さない。
- 表示済みメッセージの名前を再描画するときは、一覧の閲覧位置、入力中本文、フォーカスを維持する。usernameは `textContent` 相当で表示する。

## 9. 履歴取得とスクロール

### 9.1 初回同期 `[必須A][必須B]`

取りこぼしを避ける基本順序を固定する。

1. `messages` INSERT購読を作成する。
2. Realtime channelが `SUBSCRIBED` になったことを確認する。
3. そのsubscriptionId・sessionGenerationのまま最新50件をRESTで取得する。
4. 購読開始後に届いたINSERTとREST結果をIDでマージする。
5. `(created_at asc, id asc)` で描画し、初回だけ最下部へ移動する。

購読確立に失敗した場合、履歴を「リアルタイム接続済み」として表示しない。手動再接続・再取得が可能な案内を出す。

### 9.2 最新50件 `[必須A]`

- RESTでは `created_at desc, id desc` で50件取得し、画面では逆順にして古いものから新しいものへ表示する。
- 0件は正常な空状態とし、送信欄は利用できる。
- 取得行と関連プロフィールを検証してから一括マージする。

### 9.3 過去履歴カーソル `[必須A][必須B]`

- 最古メッセージの `(created_at, id)` をカーソルとする。
- 次ページ条件は `created_at < cursor.created_at OR (created_at = cursor.created_at AND id < cursor.id)`、並びは `created_at desc, id desc`、limit 50とする。
- 50件未満なら `hasOlderMessages = false` とし、読込ボタンを無効化または終了表示にする。
- 同じcursorでの二重要求を防ぎ、応答はIDで重複排除する。

### 9.4 スクロール維持 `[必須A][必須B]`

- 過去履歴追加前の `scrollHeight` と `scrollTop` を記録し、追加後の高さ差を加えて閲覧中メッセージの位置を維持する。
- 過去履歴中に最下部へ移動しない。
- 新着受信直前に最下部付近なら描画後に最下部へ移動する。
- 上方閲覧中なら自動移動せず、新着件数付き案内を表示する。案内操作で最下部へ移動して件数を0にする。

### 9.5 再接続補完 `[必須A][必須B]`

- Realtime再接続後、現在の最新 `(created_at, id)` より後をRESTで取得する。
- 条件は `created_at > newest.created_at OR (created_at = newest.created_at AND id > newest.id)` とし、古い順にページングして欠落をすべて取得する。
- 補完中に届くRealtime INSERTとIDでマージし、重複・欠落を防ぐ。
- 補完完了後だけ「接続済み」とし、失敗時は「再接続中」または「切断」と再試行案内を維持する。

## 10. メッセージ送信

### 10.1 入力 `[必須A]`

- textareaを使用し、trim後1〜1000文字とする。
- 空白だけ、1001文字以上は送信せず入力エラーを表示する。
- Enter単独で送信し、Shift+Enterは改行を挿入する。
- `compositionstart`〜`compositionend` 中、またはKeyboardEvent `isComposing` / keyCode 229相当ではEnter送信しない。
- 入力値、文字数、エラーを関連付け、送信可能状態を文字または属性で伝える。

### 10.2 INSERT `[必須A][必須B]`

- チャット利用可能で送信中でない場合だけ実行する。
- `insert({ user_id: currentUser.id, body: trimmedBody }).select(...).single()` 相当でDBの返却行を取得する。
- 送信者IDを画面表示や任意入力から取得せず、現在の認証セッションから設定し、RLSでも検証する。
- 送信中は入力と送信ボタンを適切に無効化し、二重送信を防ぐ。
- 成功時はDB返却行をIDマージし、その送信操作に対応する入力だけを空にする。Realtimeが先着しても重複表示しない。
- 失敗時は本文を維持し、理由と手動再試行を案内する。自動再送しない。

### 10.3 送信中の状態変更 `[必須B]`

- ログアウト、認証失効、ユーザー変更時はgenerationを更新する。
- 古い送信成功を新セッションへ表示せず、別ユーザーの入力欄を消さない。
- DBでINSERT済みだが応答前にログアウトした場合、再ログイン後の履歴で取得されることは許容する。クライアントが推測で再送しない。

## 11. Realtime

### 11.1 購読 `[必須A]`

- 同一channelで `messages` のINSERTと `profiles` のUPDATEを購読する。
- 各payloadを検証し、現在のsubscriptionIdとsessionGenerationに一致する場合だけ採用する。
- 自分のREST送信応答とRealtime通知は同じIDとしてマージする。
- profile UPDATEはuser ID単位のキャッシュへ反映し、表示済み履歴と新着の送信者名をリロードなしで更新する。

### 11.2 接続状態 `[必須A][必須B]`

| Supabase channel状態等 | 画面表示 |
| --- | --- |
| 購読開始〜SUBSCRIBED前 | 接続中 |
| SUBSCRIBEDかつ補完完了 | 接続済み |
| TIMED_OUT / CHANNEL_ERROR後の再試行・補完中 | 再接続中 |
| CLOSED、明示解除、再試行不能 | 切断 |

- 状態を色だけでなく文言とアイコンで表示する。
- 初回の正常接続では上部通知へ成功メッセージを表示せず、チャットタイトル横の `● 接続済み` とその `aria-live` 更新で示す。切断、再接続中、接続失敗等の認識・対応が必要な状態は上部通知でも案内する。
- 接続失敗でアプリ全体を停止させず、取得済み履歴と入力を可能な範囲で維持する。
- `online` 復帰または再接続操作で新しい購読を作る前に古いchannelを解除する。
- 再接続時は表示中メッセージに関係するプロフィールも再取得し、切断中のusername変更を補完する。再取得とRealtime UPDATEが競合した場合はUPDATE後の名前を優先する。

### 11.3 解除 `[必須A][必須B]`

- ログアウト、認証失効、ユーザー変更、`pagehide` / 終了処理でchannelを解除する。
- 解除後のコールバックはsubscriptionId不一致として無視する。
- 同一セッションで複数の有効channelを残さない。

## 12. 設定とライブラリ

### 12.1 `config.js` `[必須A][必須B]`

```js
window.APP_CONFIG = {
  SUPABASE_URL: "YOUR_SUPABASE_PROJECT_URL",
  SUPABASE_PUBLISHABLE_KEY: "YOUR_SUPABASE_PUBLISHABLE_KEY"
};
```

- `config.example.js` は上記プレースホルダーだけとする。
- 実装時の `config.js` はProject URLとpublishable keyを分離して保持する。publishable keyはブラウザ公開前提で、保護はRLSとAuthで行う。
- `sb_secret_...`、service_role key、DBパスワード、JWT秘密鍵をリポジトリ、HTML、JS、ブラウザ、Consoleへ絶対に置かない。
- URLはHTTPSのSupabase Project URL、キーはpublishable key形式であることを起動時に検証する。値をエラーへ含めない。
- 未設定・不正時は認証・DB・Realtime操作を無効化し、画面全体をクラッシュさせず設定方法を案内する。

### 12.2 Auth Storage `[必須B]`

- supabase-js標準のAuthセッション保存と自動refreshは、ログイン維持のため許可する。
- アプリ独自にパスワード、メッセージ、プロフィール、検索履歴をlocalStorage、sessionStorage、Cookie、IndexedDBへ保存しない。
- Storage確認時はSupabase Authが管理するセッション項目とアプリ独自データを区別する。

### 12.3 ライセンス `[必須B]`

- `@supabase/supabase-js` 2.111.0のバージョンとライセンス所在をフッターまたはソースから確認できるようにする。
- 同梱ファイルが公式npmパッケージ由来であることをpackage metadataまたは取得時checksumで検証する。
- CDN、外部URLからライブラリを読み込まない。

## 13. 入力検証とエラー処理

### 13.1 共通原則 `[必須B]`

- ブラウザ標準制約に加え、JavaScriptとDB制約の両方で検証する。
- エラーを入力付近と全体通知へ必要な粒度で表示し、色だけに依存しない。
- Supabaseの生レスポンス、スタック、URL、token、key、パスワードを利用者向け文言へ連結しない。
- 回復可能な失敗では関係のない認証状態、履歴、入力を維持する。

### 13.2 エラー一覧 `[必須A][必須B]`

| 状態 | 必須動作 |
| --- | --- |
| 設定未完了 | 保護画面へ進まず設定方法を表示する |
| ネットワークエラー | 処理を解除し、再試行を案内する |
| サインアップ失敗 | アカウント有無を断定しない安全な文言を表示する |
| メール確認待ち | 未ログイン相当でチャットを隠し、確認手順を示す |
| ログイン失敗 | メール・パスワードのどちらが正しいかを断定しない |
| セッション失効 | 購読解除・保護データ破棄後、再ログインを案内する |
| プロフィール未設定 | 設定画面を表示し、履歴・購読・送信を開始しない |
| ユーザー名重複 | 使用できない旨を表示し、別名入力を維持する |
| RLS拒否 | 権限不足として処理し、他利用者の情報やSQL詳細を出さない |
| 履歴取得失敗 | 取得済み履歴を維持し、対象読込だけ再試行可能にする |
| 送信失敗 | 本文を維持し、自動再送せず手動再試行可能にする |
| Realtime失敗・切断 | 接続状態を更新し、再接続・欠落補完を行う |
| 初期履歴とRealtime競合 | IDマージで重複と取りこぼしを防ぐ |
| 二重送信 | 2件目を実行しない |
| 送信中ログアウト | 古い応答を新状態へ反映しない |
| 取得途中のユーザー変更 | generation不一致の応答を破棄する |
| API応答形式不正 | 部分採用せず安全なエラーへ変換する |

## 14. レスポンシブ対応

### 14.1 375px `[必須B]`

- ページ全体の横スクロールを発生させない。
- 認証、プロフィール、チャットの各画面を1列にし、長いメール、ユーザー名、本文、エラーを折り返す。
- 本文入力と送信操作を無理なく行える幅とし、必要なら縦配置にする。
- `100vh` をfallback、`100dvh` を対応ブラウザの実表示高として使用し、チャット表示中はメッセージ一覧だけを縮小・内部スクロールさせる。
- composerをチャットカードの最終行として可能な限り常時表示し、ソフトウェアキーボード表示時も入力と送信ボタンを操作できる構造にする。
- 375pxではチャットヘッダーを「みんなのチャット － SHARED ROOM」と、「自分：ユーザー名／接続状態／プロフィール編集／ログアウト」の2行相当にする。usernameは残り幅で省略でき、完全な値はプロフィール編集画面の入力値として確認できる。
- プロフィール編集とログアウトは意味を表すインラインSVGのアイコンボタンとし、それぞれ `aria-label="プロフィールを編集"`、`aria-label="ログアウト"` と約44×44pxの操作領域を持つ。
- composerでは可視ラベルを隠した全幅textareaを初期2〜3行程度とし、文字数と44×44px程度の送信SVGボタンを入力コンポーネント内に配置する。送信ボタンは `aria-label="メッセージを送信"` を持つ。
- 文字数はtextareaラッパー内右下へ重ね、入力文字と競合しないpaddingを確保する。カウンターは操作を受け取らず、900〜999文字を注意色、1000文字を警告色で示す。
- 520px以下ではEnter／Shift+Enterの操作説明を視覚的に隠すが、`aria-describedby`でスクリーンリーダー向け説明を維持する。文字数は表示する。
- 正常な初回接続では上部通知を非表示とし、タイトル横の接続済み表示とそのlive regionで伝える。切断、再接続、失敗等の認識・対応が必要な状態は上部通知にも表示する。
- 375pxのトップヘッダーはeyebrow、改行しないタイトル、小型バッジ行の順に縦配置する。
- トップヘッダー、同一行の小型バッジ、通知、接続・履歴操作、フッターの余白をモバイルだけ圧縮し、375×830でメッセージ一覧をおおむね180px以上確保する。
- 入力、送信、プロフィール編集、ログアウト等は約44pxの操作対象を維持する。

### 14.2 広い画面 `[必須B]`

- 認証・プロフィールフォームは読みやすい最大幅にする。
- チャット全体は過度に広げず、本文を追いやすい最大幅とする。
- ヘッダー、履歴操作、接続状態、メッセージ一覧、入力の関係を明確にする。
- トップ帯はSTEP、タイトル、説明、バッジを横方向に整理し、タイトルと上下余白を抑える。
- 1280×800および1440×900ではページ全体をスクロールせずcomposerまで表示し、メッセージ一覧だけを内部スクロールさせる。

### 14.3 長文 `[必須B]`

- 空白のない1000文字本文、30文字ユーザー名、長いエラーでもコンテナ幅を超えない。
- 自分／他人の配置差を保ちながら、吹き出し幅は読みやすい上限を持つ。

## 15. アクセシビリティ

### 15.1 フォームとキーボード `[必須B]`

- 認証、再設定、プロフィール、チャットの全入力に `label` を関連付ける。
- Tab、Shift+Tab、Enter、Spaceで登録、ログイン、プロフィール設定・変更、履歴読込、新着移動、送信、ログアウトを完了できる。
- Enter送信、Shift+Enter改行、IME制御をキーボード実機で確認する。
- 主要操作は44px程度の押下領域と明瞭な `:focus-visible` を持つ。

### 15.2 状態・エラー `[必須B]`

- 入力エラーは `aria-invalid` と `aria-describedby` で対象入力へ関連付ける。
- 認証、プロフィール保存、送信、全体エラーは適切な `aria-live` / `role=status` または `role=alert` で通知する。
- Realtime接続状態はテキストで表示し、変化をpoliteに通知する。
- 新着ごとにメッセージ一覧全体をlive regionにせず、件数等の短い案内だけを通知する。
- 履歴追加時に既読メッセージを大量再読み上げしない。

### 15.3 メッセージ識別 `[必須B]`

- 自分と他人を配置、送信者名、「自分」の文言で区別する。
- 日時は機械可読な `datetime` を持つ `time` 要素としてよい。
- 新着案内、接続状態、エラーを色だけで伝えない。

### 15.4 動き `[必須B]`

- `prefers-reduced-motion: reduce` では不要なスクロールアニメーションや遷移を無効化する。
- 自動スクロールは条件を満たす場合だけ行い、上方閲覧者の位置を奪わない。

## 16. セキュリティとプライバシー

### 16.1 機密情報 `[必須A][必須B]`

- パスワード、access token、refresh token、publishable keyを画面、Console、エラー文、独自DBテーブルへ出力しない。
- パスワード入力は適切な `type=password` とautocomplete属性を持ち、DOMへ平文複製しない。
- secret/service_role/DB/JWT秘密情報はクライアントへ一切配布しない。

### 16.2 DOMとXSS `[必須B]`

- メッセージ、ユーザー名、メール、エラーを `textContent` 等で出力する。
- 本文の改行はCSS `white-space: pre-wrap` 等で維持し、HTML変換で実現しない。
- URLやイベント属性をユーザー入力から生成しない。

### 16.3 認証済み情報 `[必須A][必須B]`

- 未ログイン時はRESTとRealtimeからprofiles/messagesを取得できず、画面にもキャッシュを残さない。
- 認証済み利用者へ他人のメールやtokenを表示しない。
- ブラウザで変更可能な `user_id`、disabled、非表示UIを権限根拠にしない。
- RLSによる行制限、列単位GRANTによる列制限、FK、CHECK、unique indexを最終防御とする。

### 16.4 外部通信 `[必須B]`

| 送信先 | 用途 | 送信内容 |
| --- | --- | --- |
| 設定した `https://<project-ref>.supabase.co/auth/v1/...` | Auth | メール、パスワード、Auth token等 |
| 同 `/rest/v1/profiles` | プロフィール取得・登録・変更 | user ID、username、Auth token |
| 同 `/rest/v1/messages` | 履歴取得・送信・補完 | message列、カーソル、Auth token |
| 同ProjectのRealtime WebSocket | INSERT購読 | topic、Auth token、許可されたpayload |

Supabaseプロジェクト以外へ認証情報・チャットデータを送信しない。

## 17. 対象外 `[MVP外]`

- 複数ルーム、DM、招待、ルーム権限
- OAuth、匿名ログイン、MFA
- アバター、自己紹介、オンライン状態、Presence
- メッセージ編集・削除
- 添付ファイル、画像、音声、ファイルStorage
- リアクション、既読、入力中表示、メンション
- 未送信メッセージの自動再送・オフライン送信キュー
- 全文検索、絞り込み、ピン留め、OS・ブラウザへのプッシュ通知（画面内の状態・エラー通知は必須）
- 管理者画面、ユーザー削除、プロフィール削除
- メールテンプレートの高度なカスタマイズ
- アプリ独自のメッセージ・プロフィール永続化

## 18. 実装完了の判定条件

### 18.1 機能 `[必須A]`

- 2利用者が登録、必要なメール確認、ログイン、プロフィール登録を完了できる。
- 最新50件と過去履歴を安定順で取得できる。
- Enter、ボタンで送信し、Shift+EnterとIMEを正しく扱える。
- 2ブラウザ間で新着を重複なくリアルタイム表示できる。
- 自分または他利用者のusername変更が、別ブラウザの表示済みメッセージと以後の新着へリロードなしで反映される。
- 切断・再接続で欠落を補完できる。
- パスワード再設定を完了できる。

### 18.2 権限・整合性 `[必須A][必須B]`

- setup.sqlを繰り返し実行でき、テーブル、制約、index、trigger、列単位GRANT、最小sequence権限、RLS、publicationを再現できる。
- 未認証SELECT、他人名義INSERT、他人プロフィールUPDATE、messages UPDATE/DELETEが拒否される。
- クライアントがprofilesの日時列またはmessagesのID・日時列を設定できず、通常のINSERTではDB default・trigger・identityが正しく働く。
- username重複、長さ、制御文字、body長さ・空白だけがDBでも拒否される。
- 初期購読・履歴競合、送信応答・Realtime競合、ユーザー変更競合で重複・漏洩がない。

### 18.3 品質 `[必須B]`

- 375pxと広い画面で横スクロールなく利用できる。
- キーボードと支援技術で主要操作、エラー、接続状態を確認できる。
- XSS文字列が実行されず、機密情報が画面、Console、リポジトリへ漏れない。
- 未捕捉例外がなく、設定・ネットワーク・Auth・DB・Realtime失敗後も安全に回復できる。
- `@supabase/supabase-js` 2.111.0とライセンスをローカルで確認できる。

## 19. 解釈を固定した事項

- usernameの「制御文字のみ拒否」だけでは本文中の制御文字が残り得るため、安全な表示と一意性を優先し、制御文字を1文字でも含むusernameを画面・DB双方で拒否する。
- メッセージ本文は改行を許可するため、改行以外の制御文字を拒否する。改行だけはtrim後空として拒否する。
- profilesの公開範囲はチャット送信者名表示に必要な `id` と `username` に限定する。Authのメールはprofilesへ複製しない。
- 初期取りこぼし対策は「SUBSCRIBED後に最新履歴を取得し、IDでマージ」を正とする。
- DBが同じ `created_at` を複数行へ付けても安定するよう、カーソルと並び順に `id` を必ず併用する。
- パスワード最小長はSupabaseプロジェクト設定に依存するため、本書では値を創作せず、実装開始前にプロジェクト設定と画面文言へ同じ値を固定する。
- supabase-jsは文書作成時点の公式安定版2.111.0へ固定する。将来の最新版へ自動追従しない。

## 20. 未確定事項と実装前確認

次は機能拡張ではなく、実環境へ安全に接続するため実装開始前に確定が必要である。

1. Supabase Project URLと公開用publishable key
2. Authのメール確認有効／無効とSite URL・許可redirect URL
3. Authのパスワード最小長・強度設定
4. GitHub Pagesの最終公開URL
5. SMTP送信制限と受入試験用2メールアドレス
6. Auth利用者削除時の既存messagesの保持・匿名化・削除方針（アカウント削除UIはMVP外であり、本仕様では決めない）

これらが未確定でも、設定未完了として安全に停止する画面と、メール確認あり／なし双方の分岐を実装対象とする。
