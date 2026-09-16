# Part 6 AI文書要約ツール 作業記録

作成日: 2026-09-16

## 1. 概要

中級編Part 6として、直接入力または文書ファイルを生成AIで要約し、要約項目と根拠の対応を確認、保存、再表示、コピー、ファイル出力できる認証付きWebアプリを作成した。Part 5のSupabase Auth、Edge Function、OpenAI Responses APIの構成を参照しつつ、Part 6内で独立して動作するフロントエンド、DB migration、RPC、Edge Function、仕様書、受入チェックリストを整備した。

仕様策定では、要約範囲と説明の詳しさを独立した2軸とし、原文の情報密度に応じて項目数を決める方針を確定した。その後、入力形式、長文・サイズ上限、根拠表示、履歴保存、未保存結果、エラー分類、セキュリティを仕様化し、ローカル実装、静的検査、Supabase反映、実ブラウザ・実接続確認を行った。

## 2. フロントエンド

- 配置: `apps/intermediate/part06-document-summarizer/`
- 構成: `index.html`、`style.css`、`app.js`、`config.js`、`config.example.js`、ローカル配置したSupabase JS
- Supabase Authのログイン、セッション復元、ログアウト、パスワード再設定に対応
- 直接入力、TXT、Markdown、PDF、DOC、DOCX、PPT、PPTXを選択可能
- 要約範囲は「重要点のみ／全体を網羅」、説明の詳しさは「短く／標準／詳しく」を独立指定
- 新規生成したテキスト系文書は検証済みsegmentsをブラウザメモリだけに保持し、PCでは要約と原文を2カラムで双方向参照できる
- 375pxでは各要約項目内のdetailsから根拠segment IDと原文全文を表示する
- 履歴再表示では原文を復元せず、1カラムの要約と保存済み根拠情報を表示する
- 成功は時限トースト、エラーと未保存警告は永続表示とした
- コピー、Markdown、TXT出力に対応し、JSON出力はMVP対象外とした
- 未保存結果はWeb Storageへ保存せず、ページ内メモリだけで保持する

## 3. Supabase DB、RLS、RPC

適用済みmigrationは`20260913151116_part06_document_summarizer.sql`である。Part 4・5のオブジェクトとは分離し、次を作成した。

- `document_summary_requests`: request ID、利用者、状態、入力形式、文書hash、結果hash、固定エラーコード、処理日時を管理
- `document_summaries`: 利用者、文書名、文書hash、入力形式、要約設定、主要言語、要約項目・根拠、生成日時を保存
- request状態: `processing / generated / completed / failed`
- RLS: 両テーブルで有効
- Policy: 本人の要約履歴SELECT、本人の要約履歴DELETE
- authenticated権限: 履歴表示に必要な列だけのSELECTとDELETE
- service role: テーブル直接権限を撤回し、内部RPC 4本のEXECUTEだけを付与

RPCは次の4本である。

1. `part06_claim_summary_request`
2. `part06_mark_summary_generated`
3. `part06_complete_summary_request`
4. `part06_fail_summary_request`

claim RPCはユーザー単位のtransaction-scoped advisory lockを取得し、期限切れprocessingの解消、履歴100件上限、同時処理1件、直近1時間10件を同一transaction内で判定する。complete RPCは生成済みrequestと要約保存を原子的に完了する。

## 4. Edge FunctionとResponses API

`supabase/functions/summarize-document/index.ts`を`summarize-document`としてデプロイ済みである。認証tokenを検証し、service roleはサーバー環境だけで使用する。OpenAI APIキーもEdge Functionの環境変数だけに置く。

OpenAI Responses APIの固定設定は次のとおりである。

- model: `gpt-5.6-luna`
- reasoning effort: `none`
- `max_output_tokens: 12000`
- `store: false`
- strict JSON SchemaによるStructured Outputs
- OpenAI呼び出しはgenerate経路の1回だけ
- 自動再試行なし

直接入力、TXT、Markdownはsegment ID付きテキストを送る。PDF、DOC、DOCX、PPT、PPTXはBase64 data URLの`input_file`として送る。クライアントからmodel、instructions、schema、token設定を変更できない。

## 5. 保存とプライバシー

DBへ保存するのは文書名、文書hash、入力形式、設定、主要言語、要約項目、根拠IDまたは根拠候補、生成日時である。原文全文、原文segment本文、アップロードファイル、OpenAI生応答は保存しない。

新規生成直後だけブラウザメモリ内のsegmentsを原文表示に利用する。履歴からの再表示では原文を復元せず、保存済みの根拠IDまたは根拠候補だけを表示する。AI検証後のDB保存失敗では結果を未保存として一時表示し、OpenAIを再呼び出さず保存だけを再試行できる。

## 6. DOCX location契約不一致

初回のDOCX実接続では、日本語・英語とも`invalid_ai_response`となった。原因は、Structured Outputsの共通Schemaが全ファイル形式でpageNumberとslideNumberの整数を許可していた一方、後段の`validateLocation`はPDFだけにpageNumber、PPT／PPTXだけにslideNumber、DOC／DOCXにはsectionLabelだけを許可していたことである。

Schemaを入力形式別に修正し、PDFではslideNumberをnull、PPT／PPTXではpageNumberをnull、DOC／DOCXでは両番号をnullに固定した。locationオブジェクトの3プロパティはrequiredのままとし、sectionLabelとlocation nullを許可した。AI instructionsにも形式別制約を明記し、固定fixtureで正常・不正ケースを確認した。修正後、日本語・英語DOCXの要約、根拠候補、sectionLabel表示、保存成功を実接続で確認した。

## 7. 入力形式別の実接続結果

| 入力形式 | 確認結果 |
|---|---|
| 直接入力 | 要約項目、segment根拠、保存、PC双方向参照、モバイル根拠展開を確認 |
| TXT | 要約生成と保存成功を確認 |
| Markdown | 見出し・リスト・表等を含むテスト文書の要約生成と保存成功を確認 |
| PDF | 日本語PDFの要約生成、根拠候補表示、保存成功を確認 |
| DOCX | 日本語・英語で要約生成、根拠候補、sectionLabel、保存成功を確認 |
| PPTX | 日本語・英語で要約生成と保存成功を確認 |
| DOC | 未確認 |
| PPT | 未確認 |

## 8. UI調整とモバイル対応

- ヘッダーを小型化し、ログイン情報とログアウト操作を狭い画面でも維持
- 入力方式切替を入力見出しと同じ上段へ配置
- 成功通知を4.5秒で消える小型トーストへ変更
- 要約項目と原文segmentの大きなカード枠を廃止し、連続した文書表示へ変更
- 選択中の要約・原文を淡い背景と左線で強調
- PCでは要約／原文の2カラム、履歴では最大860pxの1カラム表示
- 375pxでは要約項目内のdetailsに根拠原文を表示し、PCとのリサイズ切替にも追従
- 履歴では原文非保存の説明と非操作の根拠ラベルを表示
- 横スクロール、フォーカス復帰、reduced motion、外部文字列の安全なDOM描画を確認

## 9. 頻度制限

直近1時間の新規claimが10件に達した状態で、次の生成が拒否されることを実接続で確認した。画面には生エラーではなく固定日本語メッセージを表示し、取得済みの既存履歴を維持した。同一request IDの再送、保存再試行、completed結果の再取得は新規件数へ加算しない設計である。

## 10. 実ブラウザ確認

次を実ブラウザで確認した。

- 履歴の切替、要約項目と根拠の表示
- PC表示、375px表示、横スクロールなし
- 全文コピー、Markdown出力、TXT出力
- 履歴削除キャンセル時の起点フォーカス復帰
- 頻度制限時の生成拒否、固定日本語エラー、既存履歴維持
- 日本語／英語DOCX、日本語／英語PPTX、日本語PDF、TXT、Markdownの生成・保存
- DOCXの根拠候補とsectionLabel表示

## 11. 公開環境の認証確認

GitHub Pagesの公開環境で、既存アカウントを登録フォームへ入力した場合に、登録済みであることを明示せず共通の登録受付画面を表示することを確認した。Supabase Authでは、メール確認が必要な新規登録と既存アカウントの再登録をクライアントから確実に区別できないため、見出しを「登録手続きを受け付けました」、説明を「確認メールが届いた場合は、メール内のリンクを開いてください。すでに登録済みの場合はログインしてください。」へ変更した。アカウントの存在を推測・表示する分岐は追加していない。

同じ既存アカウントで公開環境からログインし、Part 6の入力画面へ遷移すること、保存履歴0件の空状態を表示することを実ブラウザで確認した。

Supabaseの標準SMTPには送信先と送信数の制限があり、任意の宛先を用いた本番相当の配信試験には適さない場合がある。完全な新規アカウントへの確認メール実受信、確認リンクからPart 6公開URLへの復帰、パスワード再設定メールの実受信は未確認である。

## 12. 未確認項目と既知の制限

- 旧Office形式のDOC、PPTの実接続
- 画像中心PDF、暗号化・破損ファイルの各実エラー経路
- TXTのUTF-8 BOM、上限境界、Shift_JIS／UTF-16拒否の全組合せ
- 100,000コードポイント、1MiB、6MiB、各AI出力上限の実境界
- 2利用者によるRLS分離、他利用者アクセス拒否の実試験
- 同一利用者の並列claim、履歴100件境界、期限切れprocessingの実競合試験
- DB保存失敗後の未保存結果と保存再試行の実障害注入
- 完全な新規アカウントへの確認メール実受信と、確認リンクからPart 6公開URLへの復帰
- パスワード再設定メールの実受信と、再設定リンクからの復帰
- GitHub Pages公開環境でのCORS、CSP、全入力形式の総合確認（既存アカウントのログインとPart 6遷移は確認済み）
- アプリ独自OCR、OCR設定、OCR結果編集は対象外
- Office文書は主にテキスト抽出であり、画像、グラフ、レイアウトが十分に反映されない場合がある
- AIが生成する根拠候補と位置情報は厳密な証明ではない

## 13. commit前のGit状態と対象範囲

commit前はPart 6のアプリ、文書、Edge Function、migrationが未追跡で、ブランチは`main`、`origin/main`との差分はなかった。今回のcommit対象は次に限定する。

初回Part 6 commit後の仕上げ作業開始時は、`main`と`origin/main`が同期し、Part 6に未commit差分はなかった。無関係な未追跡ファイル2件だけが残っていることを確認してから、登録結果の共通文言、仕様、受入結果、本記録を更新した。

- `apps/intermediate/part06-document-summarizer/`
- `docs/intermediate/part06-document-summarizer/`
- `supabase/functions/summarize-document/`
- `supabase/migrations/20260913151116_part06_document_summarizer.sql`

次の無関係な未追跡ファイルは変更、削除、stage、commitしていない。

- `docs/intermediate/part05-ai-assistant/part05-ai-assistant-work-log.md`
- `docs/part03-memo-issues/part03-memo-export-20260902-1830.json`

Part 6文書ディレクトリ内の`.DS_Store`も成果物ではないためcommit対象外とする。
