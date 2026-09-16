# 中級編 Part 6：AI文書要約ツール 仕様書

- 実装先（将来）：`apps/intermediate/part06-document-summarizer/`
- Edge Function（将来）：`supabase/functions/summarize-document/`
- DB migration（将来）：`supabase/migrations/`
- 本仕様書：`docs/intermediate/part06-document-summarizer/part06-document-summarizer-spec.md`
- 受入チェックリスト：`docs/intermediate/part06-document-summarizer/part06-document-summarizer-acceptance.md`
- 公開先：GitHub Pages
- バックエンド：Supabase Auth / PostgreSQL / Edge Functions
- 生成AI：OpenAI Responses API
- 対応幅：viewport幅375px以上

---

## 0. 本文書の読み方

### 0.1 要件区分

| 区分 | 意味 | 実装義務 |
| --- | --- | --- |
| `[必須A]` | 課題文または依頼者が明示した機能要件 | 必須 |
| `[必須B]` | 必須Aを安全かつ検証可能に実装するための補完要件 | 必須 |
| `[任意]` | 実装してよいが、MVP合格条件には含めない機能 | 任意 |
| `[対象外]` | MVPでは実装しない機能 | 実装しない |

本書と受入チェックリストに矛盾がある場合は実装で推測せず、仕様不備として報告する。本書末尾の確認事項は確定仕様を変更せず実装・接続試験で確認し、運用事項はアプリ実装開始を止めるゲートにしない。

### 0.2 Part 5との関係

- Part 5の認証画面、セッション復元、ログアウト、パスワード再設定、静的フロント、公開config、CORS、固定エラー、RLS、request ID、後着応答破棄の考え方を踏襲する。`[必須B]`
- Part 6専用のテーブル、Policy、RPC、DB関数、Edge Functionを使用し、Part 5の`ai_conversations`、`ai_messages`、`ai_requests`、`part05_*`、`ai-chat`へ依存または変更しない。`[必須B]`
- Part 5の受入チェックリストには未確認項目が残っているため、その実装を完全検証済みとはみなさない。再利用する処理はPart 6の受入試験で改めて検証する。`[必須B]`
- Vanilla HTML/CSS/JavaScriptを基本とし、GitHub Pagesには静的フロントだけを配信する。ブラウザからOpenAI APIを直接呼ばない。`[必須A][必須B]`

## 1. 目的と対象範囲

### 1.1 目的 `[必須A]`

認証済み利用者が、直接入力または対応文書ファイルを送信し、要約範囲と説明の詳しさを独立指定して、原文との対応を確認しやすい要約を生成する。生成結果は利用者単位で保存し、再表示、削除、コピー、ファイル出力を可能にする。ファイル処理、生成AI、保存にまたがる信頼境界、入力上限、構造化出力、根拠候補、秘密情報保護を学ぶ。

### 1.2 MVPの課題クリア条件 `[必須A]`

- テキスト直接入力または対応ファイルを入力できる。
- OpenAI Responses APIをEdge Functionから1回呼び出して要約できる。
- 「要約範囲」と「説明の詳しさ」を独立指定できる。
- 各要約項目に原文の根拠IDまたは根拠候補を対応付けて確認できる。
- 要約履歴を本人だけが保存、一覧、再表示、削除できる。
- 要約全文をコピーし、MarkdownとTXTで出力できる。
- 空入力、境界超過、破損・抽出不能ファイル、timeout、AI・DBエラーを安全に処理できる。
- 375px幅で主要操作を完了できる。

### 1.3 対象入力 `[必須A]`

| 入力形式 | 拡張子等 | MVPでの扱い |
| --- | --- | --- |
| 直接入力 | なし | ブラウザでプレーンテキスト化し、段落ごとにセグメントIDを付ける |
| TXT | `.txt` | ブラウザで文字コードを検証してテキスト化し、段落ごとにセグメントIDを付ける |
| Markdown | `.md`, `.markdown` | ブラウザでプレーンテキストとして読み、段落ごとにセグメントIDを付ける。HTMLを実行しない |
| PDF | `.pdf` | Edge FunctionからResponses APIの`input_file`として直接送信し、標準的なPDF処理へ委ねる |
| Word | `.doc`, `.docx` | Edge FunctionからResponses APIの`input_file`として直接送信する |
| PowerPoint | `.ppt`, `.pptx` | Edge FunctionからResponses APIの`input_file`として直接送信する |

PDF以外のOffice文書は主にテキスト抽出となり、埋め込み画像、グラフ、図表、レイアウト情報が十分に要約へ反映されない場合があることを入力画面に常時明示する。図表や画像も含めたい場合はPDFへ変換して読み込むよう案内する。`[必須A]`

### 1.4 対象外

- アプリ独自のOCR、OCR精度設定、OCR結果編集 `[対象外]`
- 音声・動画の文字起こし `[対象外]`
- 埋め込みマクロ、スクリプト、外部リンク、添付オブジェクトの実行 `[対象外]`
- 文書の共同編集、共有リンク、他利用者への共有 `[対象外]`
- 原文全文またはアップロードファイルの永続保存 `[対象外]`
- 複数回のAI呼び出し、分割要約、map-reduce要約 `[対象外]`
- 上限超過文書の切り捨て・部分要約 `[対象外]`
- 自動再試行、バックグラウンドジョブ `[対象外]`
- AI回答のストリーミング表示 `[対象外]`
- JSONファイル出力 `[対象外]`

## 2. 用語と固定選択肢

### 2.1 用語

- 「文書」は、直接入力文字列または利用者が選択した1ファイルを指す。
- 「セグメント」は直接入力、TXT、Markdownを段落境界で分け、空段落を除外した原文単位を指す。
- 「セグメントID」はクライアントが文書内の順序に従って付ける`S0001`形式の識別子を指す。
- 「要約項目」は構造化AI応答内の、1つの論点とその根拠をまとめた単位を指す。
- 「根拠」は直接入力、TXT、Markdownでは実在するセグメントIDを指す。
- 「根拠候補」はPDF、Word、PowerPointについてAIが選定した短い原文抜粋と任意の位置情報を指し、厳密な証明ではない。
- 「入力形式」は`direct`、`txt`、`markdown`、`pdf`、`doc`、`docx`、`ppt`、`pptx`のいずれかを指す。
- 「要約範囲」は`key_points`（重要点のみ）または`comprehensive`（全体を網羅）を指す。
- 「説明の詳しさ」は`brief`（短く）、`standard`（標準）、`detailed`（詳しく）を指す。
- 「履歴」は原文を含まず、DBへ保存された要約結果と根拠情報を指す。

### 2.2 初期値と許可値 `[必須A]`

| 項目 | 値 |
| --- | --- |
| 要約範囲の初期値 | `key_points`（重要点のみ） |
| 説明の詳しさの初期値 | `standard`（標準） |
| 入力件数 | 直接入力または1ファイルのどちらか一方 |
| AI呼び出し回数 | 1要約要求につき最大1回 |
| OpenAI model | `gpt-5.6-luna` |
| reasoning effort | `none` |
| `max_output_tokens` | 12,000 |
| OpenAI保存 | `store: false` |
| timeout初期値 | OpenAI要求開始から45秒 |
| 自動再試行 | なし |
| AI検証済み・DB未保存結果 | 「未保存」として一時表示し、保存だけ再試行可能 |
| セグメントID | `S0001`から原文順に連番 |
| 同時処理 | 1ユーザー1件 |
| 利用頻度 | 直近1時間に最大10件 |
| 履歴ページサイズ | 20件 |
| 最大保存履歴 | 1ユーザー100件。到達時は自動削除せず新規生成を拒否 |
| 履歴保持 | 利用者が削除するまで |

model、`reasoning.effort`、`max_output_tokens`、schema、instructions、各上限はサーバー固定とし、クライアントから自由指定させない。modelとreasoningはPart 5の仕様および`ai-chat`実装で固定されている`gpt-5.6-luna`、`none`を採用する。

## 3. 要約設定の意味

### 3.1 要約範囲 `[必須A]`

- **重要点のみ**：文書全体から重要度の高い論点を選定し、補助的な説明、反復、細かな例示を省略する。
- **全体を網羅**：原文の主要な章、セクション、論点をできるだけ漏らさず取り上げる。内容の薄い章を項目数確保のために無理に独立させない。

### 3.2 説明の詳しさ `[必須A]`

- **短く**：原則1項目1文。背景、例示、細かな条件は省略するが、理解に不可欠な数値、固有名詞、結論は保持する。
- **標準**：原則1項目1〜3文。要点に加えて主要な背景、理由、条件を含める。
- **詳しく**：必要に応じて1項目を複数文で説明し、背景、理由、根拠、条件、例外、重要な数値、固有名詞を可能な限り保持する。

### 3.3 共通規則 `[必須A][必須B]`

- 項目数は固定せず、原文の構造、長さ、情報密度、要約範囲に応じて決める。
- 「短く」は項目数が少ないことを意味せず、「詳しく」は項目数の水増しを意味しない。
- 「全体を網羅」かつ「短く」の組み合わせを許可する。
- 同一内容を重複させず、原文にない情報で水増ししない。
- AIは文書の主要言語を`documentLanguage`として返し、要約も主要言語で生成する。固有名詞、引用、専門用語は原文表記を保持してよい。複数言語の比率を厳密に計算しない。
- Edge Functionは両設定を列挙済み許可値から固定指示へ変換する。クライアントから任意の指示文、system prompt、モデル名、token上限を受け付けない。

## 4. 画面構成

### 4.1 主要ビュー `[必須A][必須B]`

主表示は認証状態と処理状態に応じ、次を使い分ける。認証確認前に履歴や文書内容を表示しない。

1. 初期確認中
2. 設定未完了
3. ログイン／アカウント作成
4. メール確認待ち
5. パスワード再設定要求／新パスワード設定
6. 入力・設定画面
7. 要約結果・原文比較画面
8. 保存履歴一覧・再表示画面
9. 履歴削除確認ダイアログ

### 4.2 入力・設定画面 `[必須A]`

- 直接入力とファイル入力を明確に切り替える。
- 直接入力にはlabel、文字数／上限表示、入力エラーを関連付ける。
- ファイル入力には対応形式、選択ファイル名、サイズ、読込状態、取消・再選択を表示する。
- Office文書の抽出制約とPDF変換案内を表示する。アプリ独自のOCR、OCR精度設定、OCR結果編集が対象外であることを表示する。
- 要約範囲を2択、説明の詳しさを3択で独立指定する。
- 送信前に入力形式、サイズ、空入力、許可値を検証する。

### 4.3 結果・根拠画面 `[必須A]`

- 文書名または「直接入力」、入力形式、選択設定、生成日時を表示する。
- 要約項目を順序付きで表示し、各項目から根拠を確認できるようにする。
- 直接入力、TXT、Markdownでは、要約項目から該当セグメントへ移動・強調し、原文セグメントから参照している要約項目も強調する。
- PDF、Word、PowerPointでは短い根拠抜粋と、特定できる場合だけページ、章、見出し等を表示する。
- PDF、Word、PowerPointの根拠は「AIが選定した根拠候補であり、厳密な証明ではない」と明示する。
- コピー、Markdown出力、TXT出力を提供する。JSON出力はMVP対象外とする。

### 4.4 履歴画面 `[必須B]`

- 本人の保存済み要約を新しい順に一覧表示する。
- 一覧から要約、設定、保存済み根拠情報を再表示できる。
- 原文を保存していないため、履歴再表示では原文全文への移動・双方向強調を提供せず、保存済み根拠IDまたは抜粋だけを表示する。
- 削除は対象名を示した確認後に実行し、成功後だけ一覧から除く。

## 5. クライアント状態と状態遷移

### 5.1 状態モデル `[必須B]`

```js
{
  configReady: false,
  authStatus: "checking", // checking | signedOut | confirmationPending | recovery | signedIn | expired
  session: null,
  user: null,
  inputMode: "direct", // direct | file
  directText: "",
  selectedFile: null,
  inputFormat: "direct",
  segments: [],
  coverage: "key_points",
  detail: "standard",
  readStatus: "idle", // idle | reading | ready | error
  generationStatus: "idle", // idle | submitting | generating | saving | unsaved | success | error
  activeRequestId: null,
  result: null,
  histories: [],
  historyCursor: null,
  selectedHistoryId: null,
  authGeneration: 0,
  inputGeneration: 0,
  requestGeneration: 0,
  errors: { auth: null, input: null, generation: null, history: null, deletion: null }
}
```

### 5.2 遷移規則 `[必須B]`

- 認証確認成功後だけ入力・履歴画面を表示する。
- ログアウトまたはセッション失効時は、原文、選択ファイル、要約、根拠、履歴、request IDをメモリとDOMから消す。
- 入力方式またはファイル変更時に`inputGeneration`を増やし、旧ファイル読込結果を破棄する。
- 送信時に`requestGeneration`を増やし、入力方式変更、ログアウト、別履歴選択後の後着応答を採用しない。
- `reading`、`submitting`、`generating`、`saving`を区別して表示する。
- 処理中は同一要求を開始できない。自動再試行せず、失敗後に利用者が手動で再実行する。
- 失敗後も安全に保持できる直接入力、選択設定、ファイルメタデータ、ブラウザ内のFile参照を可能な限り維持する。
- AI応答のschema検証まで成功しDB保存だけが失敗した場合は、検証済み結果を`unsaved`としてメモリ内に一時表示する。コピー、Markdown、TXT出力と、OpenAIを再呼出ししない「保存だけ再試行」を許可する。
- 未保存結果はページ再読込、ログアウト、別入力開始で失われることを画面に明示し、localStorage、sessionStorage、IndexedDB、Cookieへ保存しない。

## 6. 入力読込と文書処理

### 6.1 共通検証 `[必須A][必須B]`

- 直接入力とファイルの同時送信を拒否する。
- ファイルは1件だけ受け付ける。
- 拡張子、申告MIME type、代表的なファイルシグネチャ、サイズを組み合わせて形式を判定する。申告値だけを信用しない。
- 空ファイル、直接入力またはTXT／Markdownの空白だけ・抽出結果0文字、許可外形式、上限超過をOpenAI呼出し前に拒否する。
- PDF／Office文書を独自解析せずには判定できない破損、暗号化、抽出不能状態の完全な事前検出は要件にしない。OpenAIが読み取れなかった場合に生エラーを隠して`document_unreadable`へ分類する。
- 上限超過内容を切り捨てない。どの上限を超えたかを固定メッセージで案内する。
- 制御文字、NUL、異常なUnicode、ファイル名を検証し、表示・出力ファイル名へ安全に反映する。
- クライアント検証に加え、Edge Functionでも入力形式、受信データのサイズ、粒度、本文／ファイルの相互排他を再検証する。TXT／Markdownのraw bytesは送信しないため、元ファイルのraw byte数とUTF-8 decodeはクライアント、Edge Functionは受信セグメントのUTF-8 byte数、コードポイント数、ID、ハッシュを検証する。

### 6.2 直接入力、TXT、Markdown `[必須A]`

- UTF-8およびUTF-8 BOMだけを受け付ける。Shift_JIS、UTF-16等は対象外とし、文字化けの可能性がある場合は`file_read_failed`としてUTF-8への変換を案内する。
- ブラウザでテキスト化し、CRLFとCRをLFへ正規化し、前後の空白行を除く。MarkdownをHTMLへ変換・実行しない。
- 空行の連続を段落境界とする。Markdown見出しは独立セグメント、Markdownのリスト項目は原則1項目1セグメントとする。
- 1セグメントが1,000 Unicodeコードポイントを超える場合は句点等の文境界を優先して分割し、文境界で分割できない場合だけ1,000コードポイントでUnicodeコードポイント境界を壊さず分割する。
- 空セグメントを除外し、原文順に`S0001`から採番する。最大1,000セグメントとする。
- 表示用原文は正規化前の見た目を可能な限り維持し、表示範囲とAI送信用セグメントの対応を保持する。
- Edge Functionへ文書名、入力形式、ハッシュ、設定、セグメント配列をJSONで送る。
- 直接入力は最大100,000 Unicodeコードポイント、TXT／Markdownは最大1MiBかつ抽出後100,000 Unicodeコードポイントとする。
- SHA-256は、改行正規化後かつセグメントIDを除いた要約対象テキストのUTF-8 bytesを対象とする。

### 6.3 PDF、DOC、DOCX、PPT、PPTX `[必須A]`

- ブラウザはファイルをEdge Functionへ送り、Edge Functionは認証、拡張子、MIME type、代表的シグネチャ、サイズ等を検証した後、Responses APIの`input_file`として直接送る。
- PDF、DOC、DOCX、PPT、PPTXはすべて最大6MiBとする。SHA-256は選択ファイルのraw bytesを対象とし、ファイル名、要約範囲、説明の詳しさを含めない。
- DOC、DOCX、PPT、PPTXをアプリ側で展開、変換、本文抽出せず、Office解析ライブラリも追加しない。
- PDFはResponses APIの標準的なPDF処理へ委ねる。抽出テキストとページ画像がモデル入力に利用され得る。アプリ独自のOCR、OCR精度設定、OCR結果編集は行わない。
- OpenAIでも読み取り結果が得られない場合だけ、生エラーを隠して`document_unreadable`とする。
- PDF以外のOffice文書は主にテキスト抽出として扱われ、画像、グラフ、図表、レイアウトの反映が不完全になり得ることを明示する。
- ファイルをSupabase StorageまたはDBへ永続保存しない。OpenAIへ渡す一時表現と一時メモリの保持期間を最小化する。

### 6.4 長文と同期処理 `[必須A][必須B]`

- MVPは同期処理かつAI呼出し1回とする。
- 上限内の文書全体だけを処理し、分割要約、部分送信、先頭だけの送信は行わない。
- PDF／Officeのraw byte上限、直接入力系のUnicodeコードポイント数、セグメント数はクライアントとEdge Functionの両方で強制する。TXT／Markdownのraw byte上限とUTF-8 decodeはクライアントで、抽出後セグメントのUTF-8 byte上限はEdge Functionでも強制する。
- OpenAI要求開始から45秒、ファイル受信、検証、DB処理を含むEdge Function全体で60秒を上限とし、超過時は全体を失敗させる。

## 7. AI入出力

### 7.1 Edge Functionへの要求 `[必須B]`

`action=generate`要求は`action`、`requestId`、`inputFormat`、`sourceName`、`mimeType`、`documentHash`、`coverage`、`detail`、`segments`、`fileData`の全キーだけを受け付ける。直接入力では`sourceName`と`mimeType`をnullとし、表示名はサーバーで生成する。直接入力、TXT、Markdownは`segments`だけを本文として送り`fileData=null`、PDFとOfficeは`fileData`だけを送り`segments=null`とする。`action=save`要求は`action`、`requestId`、`result`の全キーだけを受け付ける。未知キー、欠落キー、未知設定、複数ファイル、クライアント指定instructionsを拒否する。

### 7.2 Responses API要求 `[必須A][必須B]`

- `POST https://api.openai.com/v1/responses`をEdge Functionだけから呼ぶ。
- model=`gpt-5.6-luna`、`reasoning.effort=none`、`max_output_tokens=12000`、instructions、構造化出力schemaはサーバー固定とする。これはPart 5の実装・仕様で実際に固定されているmodelとreasoningを継承した値である。
- structured outputはResponses APIの`text.format`へ`type: "json_schema"`、固定`name`、`strict: true`、固定`schema`を指定してschema準拠を要求する。クライアントからschema、model、instructions、reasoning、token設定を受け付けない。
- `store: false`を必須とする。
- 直接入力、TXT、MarkdownはセグメントIDと本文を、PDF、DOC、DOCX、PPT、PPTXは`input_file`を入力する。
- 文書内容はデータとして明確に分離し、文書内の命令によってsystem instructions、認可、出力schema、秘密保護方針を変更しないよう固定instructionsで指示する。
- 原文と同じ言語で、選択した要約範囲・詳しさに従わせる。
- 自動再試行、別モデルへの自動切替、追加AI要求を行わない。

### 7.3 構造化出力 `[必須A][必須B]`

概念schemaは次とする。実装時はResponses APIが要求する厳格なJSON Schemaとして固定する。

```json
{
  "documentLanguage": "ja",
  "items": [
    {
      "id": "I001",
      "summary": "要約本文",
      "evidence": [
        {
          "segmentId": "S0001",
          "excerpt": null,
          "location": {
            "pageNumber": null,
            "slideNumber": null,
            "sectionLabel": null
          }
        }
      ]
    }
  ]
}
```

- `items`は1〜30件で、`I001`から重複のない連番とする。
- `summary`は1〜1,200 Unicodeコードポイントとし、空白だけと許可外制御文字を拒否する。
- 各要約項目は1〜3件の根拠を持つ。
- 直接入力、TXT、Markdownの根拠は`segmentId`必須、`excerpt`と`location`はnullとする。
- PDF、DOC、DOCX、PPT、PPTXの根拠は1〜400 Unicodeコードポイントの`excerpt`必須、`segmentId`はnullとする。
- `location`はnull、または`pageNumber`、`slideNumber`、`sectionLabel`だけを持ち、3プロパティすべてを必須とする固定オブジェクトとする。sectionLabelは各ファイル形式でnullまたは1〜200 Unicodeコードポイントとする。
- PDFではpageNumberをnullまたは1以上の整数とし、slideNumberはnullに固定する。PPT／PPTXではslideNumberをnullまたは1以上の整数とし、pageNumberはnullに固定する。DOC／DOCXではpageNumberとslideNumberをともにnullに固定する。Word／PDF／PowerPointではsectionLabelを使用できる。不明な値を推測して埋めない。JSON Schemaと後段検証の許可範囲を形式ごとに一致させる。
- Edge Functionは未知フィールド、型不正、空配列、件数・長さ超過、重複ID、許可外制御文字を拒否する。
- 直接入力、TXT、Markdownでは、すべての`segmentId`が送信済みセグメントに実在することをサーバー側で照合する。1件でも不正なら全応答を失敗とし、部分採用しない。
- PDF／Officeの抜粋・位置情報はAI生成の根拠候補であり、原文上の位置や内容の正確性を保証しない。
- `documentLanguage`は文書の主要言語を表す1〜16 ASCII文字とし、許可外文字を拒否する。要約はこの主要言語で生成する。
- 検証済み`summary_items` JSONはUTF-8換算最大256KiBとし、超過時は全応答を拒否する。

### 7.4 応答採用 `[必須B]`

- HTTP成功だけでなくJSONとschemaを検証する。
- reasoning、tool call、通常テキスト、未知type、生レスポンスを要約本文として採用しない。
- schema不正、空要約、根拠不正、上限超過は`invalid_ai_response`とし、DBへ要約を保存しない。

## 8. データモデル

実装時の物理名はPart 6専用prefixを維持する。以下を論理モデルとする。

### 8.1 `document_summaries` `[必須A][必須B]`

| 列 | 型・制約 |
| --- | --- |
| `id` | `uuid primary key default gen_random_uuid()` |
| `user_id` | `uuid not null references auth.users(id) on delete cascade` |
| `request_id` | `uuid not null`、利用者内で一意 |
| `source_name` | `text not null`、1〜255 Unicodeコードポイント。直接入力時は生成時刻を使う固定表示名 |
| `document_hash` | `text not null`、SHA-256の固定長表現 |
| `input_format` | `text not null`、許可値のみ |
| `coverage` | `text not null`、`key_points` / `comprehensive` |
| `detail` | `text not null`、`brief` / `standard` / `detailed` |
| `document_language` | `text not null`、1〜16 ASCII文字の検証済み主要言語識別子 |
| `summary_items` | `jsonb not null`、検証済み要約項目と根拠情報、UTF-8換算最大256KiB |
| `created_at` | `timestamptz not null default now()` |

- 原文全文、アップロードファイル、OpenAI APIキー、service role key、アクセストークン、OpenAI生レスポンス、生エラーを保存しない。
- `(user_id, request_id)`をuniqueにし、同一要求の重複保存を防ぐ。
- `(user_id, created_at desc, id desc)`に履歴一覧用indexを置く。
- `summary_items`はDB制約だけに依存せず、保存RPC前にEdge Functionでも検証する。
- 直接入力の`source_name`は生成時刻を`Asia/Tokyo`で整形した`直接入力 YYYY-MM-DD HH:mm`とし、任意タイトル入力は設けない。

### 8.2 `document_summary_requests` `[必須B]`

| 列 | 型・制約 |
| --- | --- |
| `id` | `uuid primary key`、クライアントのrequest ID |
| `user_id` | `uuid not null references auth.users(id) on delete cascade` |
| `status` | `text not null`、`processing` / `generated` / `completed` / `failed` |
| `input_format` | `text not null`、許可値のみ |
| `document_hash` | `text not null` |
| `result_hash` | `text null`、`generated`以降では検証済み要約JSONのcanonical UTF-8 bytesに対するSHA-256 |
| `error_code` | `text null`、安全な固定分類のみ |
| `started_at` | `timestamptz not null default now()` |
| `finished_at` | `timestamptz null` |

- 冪等化、同時実行、利用頻度判定に使用し、ブラウザへSELECT・変更権限を与えない。
- 原文、ファイル、要約本文、生エラーを保存しない。
- `generated`はAI応答が検証済みだがsummary保存が完了していない状態を表す。検証済み要約自体はrequest行へ保存せず、改変検出用`result_hash`だけを保存する。保存再試行に使う内容は同一ページのクライアントメモリだけに保持する。

## 9. RLS・列権限・所有権 `[必須B]`

- Part 6の全テーブルでRLSを有効化し、包括的権限をREVOKEして必要な列・操作だけをGRANTする。
- `anon`には全テーブルのSELECT / INSERT / UPDATE / DELETEおよびPart 6 RPC実行を許可しない。
- `authenticated`は自分の`document_summaries`だけを一覧・再表示・削除できる。
- ブラウザから要約行や要求管理行を直接INSERT / UPDATEできない。要約保存はEdge Functionから専用RPCを通す。
- RLSは`auth.uid() = user_id`を強制する。履歴削除はブラウザからDBへ要求し、DBのDELETE Policyで本人所有を検証する。
- service roleはEdge Function内だけで使用する。Part 6テーブルへの直接権限を与えず、固定`search_path`の4本のSECURITY DEFINER RPCにだけ実行権限を与える。
- Part 5以前のテーブル、Policy、権限、関数をmigrationで変更しない。

## 10. RPCと整合性

### 10.1 `part06_claim_summary_request` `[必須B]`

- 認証済みuser ID、request ID、入力形式、文書ハッシュを受け取る。
- 所有者、形式、ハッシュ、直近1時間10件の利用頻度、1ユーザー1件の同時処理、保存履歴100件未満を検証する。
- 新規要求を`processing`として確保する。
- 同一request IDが完了済みなら保存済み要約を返し、OpenAIを再呼出ししない。
- 同一request IDで文書ハッシュ、形式または利用者が異なる場合は拒否する。
- 処理中の重複要求は`busy`として拒否する。
- claim時に開始から65秒を超えた`processing`を`failed`へ遷移してから同時処理を判定する。`generated`はAI処理中ではないため新規生成を妨げず、保存再試行に備えて自動失効させない。
- 履歴が100件なら古い履歴を自動削除せず、利用者へ削除を案内して新規生成を開始しない。

### 10.2 `part06_mark_summary_generated` `[必須B]`

- AI応答のschema検証完了後、対象requestを`processing`から`generated`へ遷移させる。
- 原文、ファイル、検証済み要約、根拠をrequestテーブルへ保存しない。検証済み要約JSONを決定的にcanonical化し、UTF-8 bytesのSHA-256だけを`result_hash`へ保存する。
- 遷移失敗時も検証済み結果をDB保存済みとは扱わない。

### 10.3 `part06_complete_summary_request` `[必須B]`

- `generated`中の同一利用者・request IDだけを完了できる。
- 検証済みメタデータと構造化要約を`document_summaries`へ保存し、要求を`completed`へ原子的に遷移させる。
- 同じrequest IDで要約を重複保存しない。
- AI生成直後の初回保存と、クライアントが保持する同じ検証済み結果の保存再試行で共用する。保存再試行ではOpenAIを呼ばない。
- 保存再試行時もschema、document hash、result hash、入力形式、設定、所有者、request IDを再検証する。クライアントから再送された結果のcanonical SHA-256が`result_hash`と一致しなければ拒否する。

### 10.4 `part06_fail_summary_request` `[必須B]`

- 対象要求を`failed`へ遷移させ、安全な固定`error_code`と終了時刻だけを保存する。
- 要約行や部分結果を作成しない。
- timeout、上流失敗、schema不正等、AI生成が完了していない失敗で処理中状態を残さない。
- AI検証成功後のDB保存失敗では`generated`を維持し、保存だけの再試行を許可する。検証済み結果はクライアントメモリだけにあり、ページ離脱後は復元できないことを前提とする。

RPC名は上記を既定案とするが、migration作成前に既存schemaとの衝突を確認する。

## 11. Edge Function

### 11.1 信頼境界 `[必須A][必須B]`

Edge Functionは次を順に実行する。

1. OriginとOPTIONSを検証し、許可OriginだけへCORS headerを返す。
2. POSTと許可Content-Typeだけを受け付け、要求ボディのバイト上限を先に確認する。
3. Bearer tokenをSupabase Authで検証しuser IDを確定する。
4. request ID、入力形式、ファイル、設定、文書ハッシュ、本文／セグメントを検証する。
5. RPCで要求をclaimし、所有権、頻度、冪等性、同時実行を確定する。
6. サーバー固定のAI設定へ変換し、Responses APIを最大1回呼ぶ。
7. 構造化応答、根拠、長さ、IDを検証する。
8. RPCでrequestを`generated`へ遷移させる。
9. RPCで要約と根拠情報を原子的に保存し、成功時は`completed`の保存済み結果を返す。
10. 保存だけが失敗した場合は、同じ検証済み結果とrequest IDを`unsaved`応答としてクライアントへ返し、保存再試行用の別actionを許可する。そのactionはOpenAIを呼ばない。
11. AI生成前またはschema検証までの失敗はrequestを`failed`へ遷移させ、固定エラーだけを返す。

### 11.2 CORS・環境変数 `[必須B]`

- 許可Originは少なくとも`http://localhost:8000`と`https://koutamada.github.io`とし、Originを無条件反射しない。
- `OPENAI_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY`等はEdge Function環境変数／Supabase Secretだけから取得する。
- `OPENAI_API_KEY`、service role key、JWT、DB接続情報をGit、ブラウザ、DB、応答、ログへ出さない。
- FunctionのJWT検証を無効化せず、Function内部でもtokenを検証する。
- OpenAI呼出し開始から45秒、Edge Function全体で60秒を超えないように中断する。

## 12. 保存履歴・削除・プライバシー

### 12.1 保存 `[必須B]`

保存対象は、元ファイル名または直接入力表示名、文書ハッシュ、入力形式、要約範囲、説明の詳しさ、要約項目、根拠IDまたは根拠抜粋・位置、生成日時、検出言語とする。

原文全文とアップロードファイルは保存しない。OpenAIへ送信されること、`store:false`を使用すること、Supabaseには要約と根拠情報だけを保存することを送信前に説明する。

### 12.2 一覧・再表示 `[必須B]`

- 本人の履歴を`created_at desc, id desc`で20件ずつページング取得する。
- 履歴0件、読込中、追加読込、終端、失敗を区別する。
- 再表示時は保存済み要約と根拠情報だけを表示し、存在しない原文全文を復元したように見せない。
- 保存上限は1ユーザー100件とし、利用者が削除するまで保持する。100件到達時は自動削除せず、新規生成前に削除を案内する。

### 12.3 削除 `[必須B]`

- 確認ダイアログで対象名を示し、確定後だけ削除する。
- 削除成功後だけ一覧と選択状態から除く。失敗時は表示を維持する。
- 他利用者のIDを指定しても存在差や内容を漏らさず、削除できない。
- ゴミ箱・復元はMVP対象外であることを確認文へ示す。

## 13. コピーとファイル出力

### 13.1 必須出力 `[必須A][必須B]`

- コピー、Markdown、TXTには文書名、要約範囲、説明の詳しさ、生成日時、要約項目、根拠IDまたは根拠候補を含める。
- PDFまたはOffice文書の場合は「根拠はAIが選定した候補であり、原文上の位置や内容を保証するものではありません」という注意文も含める。
- 「要約全文をコピー」では上記内容をプレーンテキストとしてClipboard APIへ渡す。
- Markdown出力は上記内容を見出しとリストで表現する。
- TXT出力は上記内容を読みやすいプレーンテキストで表現する。
- ファイルはブラウザで生成し、出力のためにサーバーへ再送信しない。
- ファイル名からパス区切り、制御文字、予約文字、先頭末尾空白等を除去し、空になる場合は安全な既定名を使用する。
- AI出力をHTMLとして解釈せず、出力先でも実行形式を生成しない。

### 13.2 対象外出力

- JSON出力はMVP対象外とし、操作を設けない。`[対象外]`

## 14. エラー分類

| code | 状況 | 画面動作 |
| --- | --- | --- |
| `unauthorized` | 未認証、JWT不正・失効 | 原文・結果を消し、再ログインを案内 |
| `invalid_input` | 空入力、直接入力とファイルの競合、入力不正 | 該当入力へ関連付け、外部要求しない |
| `unsupported_file_type` | 許可外・偽装形式 | 対応形式を案内し、外部要求しない |
| `input_too_large` | バイト、文字、token、segment上限超過 | 切り捨てず、上限内文書を案内 |
| `file_read_failed` | ブラウザ読込失敗 | 選択情報を可能な限り維持して再選択を案内 |
| `document_unreadable` | PDF／OfficeをOpenAIが読み取れない、抽出結果を得られない | 上流の生エラーを隠し、読取不能を固定文言で案内 |
| `busy` | 二重要求、処理中 | 既存処理中を案内し、追加AI要求しない |
| `rate_limited` | 利用者頻度上限 | 時間を置いた手動再試行を案内 |
| `upstream_timeout` | OpenAI timeout | 入力を維持し、手動再試行を案内 |
| `upstream_rate_limited` | OpenAI 429等 | 入力を維持し、時間を置くよう案内 |
| `upstream_unavailable` | OpenAI認証・設定・network・5xx | 秘密を伏せた一般化メッセージ |
| `invalid_ai_response` | schema、根拠、空回答、長さ不正 | 保存せず、AI応答を確認できない旨を表示 |
| `database_error` | claim、保存、履歴、削除失敗 | AI検証済み結果は未保存表示と保存再試行を許可し、それ以外は取得済み安全状態を維持 |
| `history_limit_reached` | 保存履歴100件 | 古い履歴を自動削除せず、削除後の新規生成を案内 |
| `forbidden` | Origin・所有権・操作拒否 | 対象の存在差を漏らさない固定文言 |

- OpenAI／Supabaseの生エラー、SQL、URL、header、token、キー、原文、AI応答をブラウザへ返さない。
- 自動再試行しない。再試行は利用者操作で新しい試行として行う。ただし通信結果不明時の同一論理要求では同じrequest IDを使い、完了済みなら保存済み結果を返す。
- AI応答のschema検証後にDB保存だけが失敗した場合は、結果を「未保存」と明示して一時表示し、コピー、Markdown、TXT出力と同一結果の保存再試行を許可する。保存再試行でOpenAIを呼ばない。
- 未保存結果がページ再読込、ログアウト、別入力開始で失われることを明示し、ブラウザの永続領域へ保存しない。

## 15. セキュリティ

- ファイル名、原文、DB値、AI出力を`textContent`またはText nodeで描画し、`innerHTML`へ直接挿入しない。`[必須A][必須B]`
- Markdown入力・出力を画面上でHTMLとしてレンダリングしない。`[必須B]`
- CSPの`connect-src`をSupabase Projectと必要なWebSocketへ限定し、ブラウザから`api.openai.com`へ接続できない構成とする。`[必須B]`
- ファイル拡張子、MIME、代表的シグネチャ、サイズを検証する。Office文書をアプリ側で展開・解析せず、独自解析なしでは分からない破損等の完全な事前検出を要件にしない。`[必須B]`
- マクロ、JavaScript、外部参照、埋め込みオブジェクト、リンク先コンテンツを実行・取得しない。`[必須B]`
- 文書内prompt injectionを完全防止できるとは扱わず、秘密や他利用者データをモデル入力へ混ぜないこと、system instructionsと文書データを分離することを主防御とする。`[必須B]`
- 原文、ファイル、要約、token、API生応答、生エラーをサーバーログへ出さない。安全なrequest ID、処理段階、固定コード、時間等の診断メタデータだけを記録できる。`[必須A][必須B]`
- Auth管理のセッション以外に、原文、ファイル、要約、tokenをlocalStorage、sessionStorage、Cookie、IndexedDBへ独自保存しない。`[必須B]`
- ファイル一時データとObject URLは完了、失敗、取消、ログアウト時に解放する。`[必須B]`
- 出力ファイル名を安全化し、Content-Typeと文字コードを固定する。`[必須B]`
- OpenAI Project側の予算上限・利用量アラートを運用で設定する。具体値は未決事項。`[必須B]`

## 16. アクセシビリティとレスポンシブ

### 16.1 共通 `[必須A][必須B]`

- 認証、入力切替、ファイル選択、設定変更、送信、根拠確認、コピー、出力、履歴、削除、ログアウトをキーボードだけで操作できる。
- 入力にlabelを付け、エラー時は`aria-invalid`と`aria-describedby`で関連付ける。
- 読込、送信、要約生成、保存、成功、失敗を短い`aria-live`と`aria-busy`で通知し、結果全体を毎回再読上げしない。
- 状態や入力方式、選択設定、根拠対応を色だけで表現しない。
- フォーカス強調を維持し、根拠移動後は対象を視覚・支援技術の両方で識別可能にする。
- 削除確認はフォーカストラップ、Escapeキャンセル、起点へのフォーカス復帰を行う。
- `prefers-reduced-motion`では滑らかな移動や強調アニメーションを抑制する。

### 16.2 PC `[必須A]`

- 要約と原文を比較しやすい2ペイン相当の配置とし、どちらも独立して読める。
- 要約項目選択時に原文側の対応箇所を表示・強調する。
- 長いファイル名、要約、原文、URLで横スクロールを発生させない。

### 16.3 375px `[必須A][必須B]`

- ページ全体の横スクロールを発生させない。
- 2ペインを狭い横並びにせず、要約項目内で根拠を展開する。
- 入力、設定、送信、コピー、出力、履歴の主要操作を利用可能な位置に保つ。
- 操作対象はおおむね44×44px以上とし、ソフトウェアキーボード表示時も操作を本文へ重ねない。

## 17. 制限値一覧

### 17.1 確定済み

| 制限 | 値 |
| --- | --- |
| 直接入力 | 最大100,000 Unicodeコードポイント |
| TXT／Markdown | 最大1MiBかつ抽出後100,000 Unicodeコードポイント、UTF-8またはUTF-8 BOM |
| PDF／DOC／DOCX／PPT／PPTX | 最大6MiB |
| 同時入力ファイル数 | 1 |
| 最大セグメント数 | 1,000 |
| 1要求のOpenAI呼出し | 最大1回 |
| OpenAI timeout | 45秒 |
| Edge Function総処理時間 | 60秒 |
| model | `gpt-5.6-luna` |
| reasoning effort | `none` |
| `max_output_tokens` | 12,000 |
| 最大要約項目数 | 30 |
| 1項目のsummary | 最大1,200 Unicodeコードポイント |
| 1項目の根拠数 | 最大3件 |
| 根拠excerpt | 最大400 Unicodeコードポイント |
| location文字列 | 最大200 Unicodeコードポイント |
| source_name | 最大255 Unicodeコードポイント |
| document_language | 最大16 ASCII文字 |
| summary_items JSON | UTF-8換算最大256KiB |
| 同時処理 | 1ユーザー1件 |
| 利用頻度 | 直近1時間に最大10件 |
| 履歴ページサイズ | 20件 |
| 最大保存履歴 | 1ユーザー100件 |
| 履歴保持 | 利用者が削除するまで |
| 自動再試行 | 0回 |
| 最小要約項目数 | 1 |
| 直接入力系の最小セグメント数 | 1 |
| 初期要約範囲 | 重要点のみ |
| 初期説明の詳しさ | 標準 |
| 原文／ファイルの永続保存 | しない |
| OpenAI側保存 | `store: false` |

### 17.2 上限適用規則

- 各上限はクライアントとEdge Functionで検証し、DBへ保存する値はDB制約またはRPCでも検証する。
- 上限超過時は切り捨てず、OpenAI呼出し前または保存前に全体を拒否する。
- Responses API自体の入力上限が本仕様値より小さい場合の扱いは21章の確認事項とする。

## 18. テスト方針

- 2利用者と独立セッションを使用し、RLS、所有権、履歴分離を確認する。
- 正常なTXT、Markdown、PDF、DOC、DOCX、PPT、PPTXを個別に検証し、Office系がすべて`input_file`として直接送信されることを確認する。
- 直接入力の段落、空入力、境界値、巨大入力、偽装拡張子、OpenAIが読取不能と判定するファイル、timeout、AI／DB失敗をstubまたは障害注入で確認する。
- AIを呼ばない試験ではfetch、Supabase、ファイル解析、時刻をstubし、許可値変換、構造化応答、根拠ID、後着応答、冪等性を決定的に確認する。
- NetworkでブラウザからOpenAIへの通信がないこと、OpenAI呼出しが1回以下であること、`store:false`を確認する。
- Supabase管理画面とSQLでRLS、列権限、RPC権限、保存列、原文非保存、孤立行を確認する。
- Edge Functionログで原文、ファイル、要約、生エラー、秘密値が記録されないことを確認する。
- ローカルとGitHub Pages、PCと375pxで主要フローを再確認する。

## 19. 実装・公開時の想定配置

```text
apps/intermediate/part06-document-summarizer/
  index.html
  style.css
  app.js
  config.js
  config.example.js
  vendor/
    supabase-js/
      supabase.js
      LICENSE
supabase/
  functions/
    summarize-document/
      index.ts
  migrations/
    <timestamp>_part06_document_summarizer.sql
docs/intermediate/part06-document-summarizer/
  part06-document-summarizer-spec.md
  part06-document-summarizer-acceptance.md
```

- `config.js`に置けるのは公開前提のSupabase Project URLとpublishable keyだけとする。
- Supabase Auth redirect URLへPart 6のlocalhost／GitHub Pages完全URLを追加する。
- CORS Originはローカル配信元と`https://koutamada.github.io`だけを許可する。
- GitHub Pagesは既存の静的配信方式を踏襲するが、公開元branch／directoryはデプロイ前にGitHub設定で確認する。
- 本書作成時点ではアプリ、Function、migration、設定変更、デプロイを行わない。

## 20. 完了判定

### 20.1 機能 `[必須A]`

- 全必須入力形式について確定した処理経路で要約できる。
- 要約範囲と説明の詳しさの6組合せを独立指定できる。
- 要約項目と根拠を確認でき、直接入力系では双方向対応が機能する。
- 保存、一覧、再表示、削除、コピー、Markdown／TXT出力が機能する。
- 上限超過を切り捨てず、異常系を安全に案内する。

### 20.2 権限・整合性 `[必須B]`

- 未認証・他利用者は要約と要求状態を取得・変更できない。
- Edge FunctionがJWT、所有権、入力、設定、形式、サイズ、頻度、冪等性を検証する。
- DB保存済み結果と未保存結果を明確に区別する。未保存結果はコピー・Markdown・TXT出力と保存だけの再試行を許可し、永続履歴として扱わない。
- 原文全文とファイルをDBへ保存しない。

### 20.3 セキュリティ・品質 `[必須B]`

- 秘密、原文、AI応答、生エラーがGit、ブラウザ応答、DBの禁止列、ログへ漏れない。
- 文書内命令で固定方針が変更されず、AI／原文由来HTMLが実行されない。
- PC、375px、キーボード、支援技術で主要操作を完了できる。
- Part 1〜5へ意図しない差分がなく、Part 6の受入項目を実際に確認したものだけ合格にする。

## 21. 未決事項

確定事項により実装上の主要仕様は解決した。次は実装を止める未決仕様ではなく、実装・接続時に検証または文言調整する確認事項である。

1. `gpt-5.6-luna`でPDF、DOC、DOCX、PPT、PPTXの`input_file`が利用可能であり、本仕様の最大6MiBと`max_output_tokens=12000`がAPI側上限内であることを接続試験で確認する。利用不能時にモデルや処理経路を独断変更しない。
2. OpenAI Projectの予算上限と利用量アラート値は運用者が決定する。これはアプリ実装開始を止める仕様ゲートではない。
