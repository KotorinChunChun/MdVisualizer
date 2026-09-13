// 基本サンプルと追加用構文は同じ台帳から生成する。
const defs = [
['flowchart','フローチャート','関係と構造','処理の分岐と流れ',`flowchart TD\n    A[開始] --> B{確認}\n    B -->|はい| C[実行]\n    B -->|いいえ| D[終了]\n    C --> D`,'N[項目]'],
['sequence','シーケンス図','関係と構造','参加者間のやり取り',`sequenceDiagram\n    participant A as 利用者\n    participant B as サーバー\n    A->>B: リクエスト\n    B-->>A: 応答`,'participant N as 項目'],
['class','クラス図','関係と構造','クラスと関係',`classDiagram\n    class User {\n      +String name\n      +login()\n    }\n    class Document\n    User --> Document : owns`,'class N'],
['state','状態遷移図','関係と構造','状態の変化',`stateDiagram-v2\n    [*] --> Idle\n    Idle --> Running : start\n    Running --> Idle : stop`,'state "項目" as N'],
['er','ER図','関係と構造','データと多重度',`erDiagram\n    USER ||--o{ DOCUMENT : creates\n    USER {\n      int id PK\n      string name\n    }\n    DOCUMENT {\n      int id PK\n    }`,'N {\n    int id PK\n}'],
['requirement','要求図','関係と構造','要求と検証の関係',`requirementDiagram\n    requirement req1 {\n      id: 1\n      text: login\n      risk: low\n      verifymethod: test\n    }\n    element test1 {\n      type: "test"\n    }\n    test1 - verifies -> req1`,'requirement N {\n    id: 2\n    text: 項目\n    risk: low\n    verifymethod: test\n}'],
['c4','C4図','関係と構造','システムの構成',`C4Context\n    Person(user, "利用者", "サービスを利用")\n    System(app, "アプリ", "注文を処理")\n    Rel(user, app, "利用")`,'System(N, "項目", "説明")'],
['architecture','アーキテクチャ図','関係と構造','サービスの接続',`architecture-beta\n    group api(cloud)[API]\n    service db(database)[Database] in api\n    service server(server)[Server] in api\n    db:R -- L:server`,'service N(server)[項目]'],
['block','ブロック図','関係と構造','ブロックの配置',`block-beta\n    columns 3\n    A["入力"] B["処理"] C["出力"]\n    A --> B\n    B --> C`,'N["項目"]'],
['mindmap','マインドマップ','階層と分類','考えを階層で整理',`mindmap\n  root((計画))\n    設計\n      画面\n      データ\n    実装\n    検証`,'    項目'],
['kanban','カンバン','階層と分類','作業を状態別に整理',`kanban\n    todo[未着手]\n      a[設計]\n      b[実装]\n    done[完了]\n      c[調査]`,'      N[項目]'],
['treemap','ツリーマップ','階層と分類','階層の量を比較',`treemap-beta\n    "開発"\n        "実装": 60\n        "テスト": 40\n    "運用"\n        "保守": 30`,'        "項目": 20'],
['treeView','ツリービュー','階層と分類','ツリー構造',`treeView-beta\n    root[プロジェクト]\n        src[ソース]\n        docs[資料]`,'        N[項目]'],
['ishikawa','特性要因図','階層と分類','問題の原因を整理',`ishikawa\n    品質\n        人\n            経験\n        方法\n            手順`,'        項目'],
['gantt','ガントチャート','時間と手順','作業の日程',`gantt\n    title 開発日程\n    dateFormat YYYY-MM-DD\n    section 開発\n    設計 :a, 2026-09-01, 3d\n    実装 :b, after a, 5d`,'項目 :N, 2026-09-10, 2d'],
['timeline','タイムライン','時間と手順','出来事の時系列',`timeline\n    title リリース計画\n    2026-09 : 設計 : 実装\n    2026-10 : 公開`,'2026-11 : 項目'],
['journey','ユーザージャーニー','時間と手順','体験の推移',`journey\n    title 操作の体験\n    section 利用\n      開く: 5: User\n      編集: 4: User\n      保存: 5: User`,'項目: 3: User'],
['gitGraph','Gitグラフ','時間と手順','ブランチの履歴',`gitGraph\n    commit id: "start"\n    branch feature\n    checkout feature\n    commit id: "change"\n    checkout main\n    merge feature`,'commit id: "項目"'],
['pie','円グラフ','数値と比較','内訳の比率',`pie showData\n    title 作業割合\n    "開発" : 60\n    "検証" : 30\n    "運用" : 10`,'"項目" : 20'],
['quadrantChart','四象限図','数値と比較','二軸で優先度を比較',`quadrantChart\n    title 優先度\n    x-axis 低コスト --> 高コスト\n    y-axis 低効果 --> 高効果\n    quadrant-1 要検討\n    quadrant-2 優先\n    quadrant-3 後回し\n    quadrant-4 慎重\n    案A: [0.25, 0.75]\n    案B: [0.65, 0.40]`,'項目: [0.5, 0.5]'],
['xychart','XYチャート','数値と比較','軸に沿った数値の推移',`xychart-beta\n    title "月別実績"\n    x-axis [Jan, Feb, Mar]\n    y-axis "件数" 0 --> 100\n    bar [30, 60, 80]\n    line [20, 50, 70]`,'line [25, 45, 65]'],
['sankey','サンキー図','数値と比較','量の流れ',`sankey-beta\nSource,Process,50\nProcess,Output,40\nProcess,Loss,10`,'Source,Item,10'],
['radar','レーダーチャート','数値と比較','複数指標の比較',`radar-beta\n    title 評価\n    axis a["速度"], b["品質"], c["価格"]\n    curve x["製品A"]{80, 90, 60}\n    curve y["製品B"]{70, 70, 90}`,'curve N["項目"]{60, 70, 80}'],
['packet','パケット図','関係と構造','ビットの構成',`packet-beta\n    0-7: "Header"\n    8-15: "Flags"\n    16-31: "Data"`,'32-47: "項目"'],
['swimlane','スイムレーン','関係と構造','担当別の処理',`swimlane-beta TD\n    subgraph User\n      A[入力]\n    end\n    subgraph System\n      B[処理]\n    end\n    A --> B`,'N[項目]'],
['venn','ベン図','数値と比較','集合の重なり',`venn-beta\n    set A["開発"]: 10\n    set B["運用"]: 8\n    union A,B: 3`,'set N["項目"]: 5'],
['wardley','ウォードリーマップ','数値と比較','価値と進化',`wardley-beta\n    component A [0.8, 0.2]\n    component B [0.4, 0.7]\n    A -> B`,'component N [0.5, 0.5]'],
['cynefin','クネビン','階層と分類','状況を分類',`cynefin-beta\n    title 状況の分類\n    clear\n      "定型作業"\n    complex\n      "新製品"`,'clear\n    "項目"'],
['eventmodeling','イベントモデリング','時間と手順','イベントの流れ',`eventmodeling\n    entity Order\n    tf 1 evt Order "注文"\n    tf 2 evt Order ->> 1 "完了"`,'tf 3 evt Order "項目"'],
['railroad','レールロード','関係と構造','構文の規則',`railroad-beta\n    start = terminal("hello");`,'item = terminal("項目");'],
['railroadEbnf','EBNF構文図','関係と構造','EBNFで構文を定義',`railroad-ebnf-beta\n    start = "hello" ;`,'item = "項目" ;'],
['railroadAbnf','ABNF構文図','関係と構造','ABNFで構文を定義',`railroad-abnf-beta\nstart = "hello";`,'item = "sample";'],
['railroadPeg','PEG構文図','関係と構造','PEGで構文を定義',`railroad-peg-beta\nstart <- 'hello';`,'item <- "sample";'],
['info','Mermaid情報','その他','同梱版の情報',`info`,null]
];
export const catalog = defs.map(([id,name,category,description,code,insert])=>({id,name,category,description,code,insert}));
export function diagramType(code){
 const header=code.replace(/^---[\s\S]*?---\s*/,'').replace(/^\s*%%[^\n]*\n/gm,'').trim();
 return catalog.find(t=>header.startsWith(t.code.split('\n')[0].split(' ')[0]))?.id || (/^(graph|flowchart)/.test(header)?'flowchart':/^stateDiagram/.test(header)?'state':/^classDiagram/.test(header)?'class':/^C4/.test(header)?'c4':'flowchart');
}
const extra={
 flowchart:[['角丸','N(項目)'],['条件','N{項目}'],['矢印','A --> B'],['ラベル付き矢印','A -->|条件| B'],['点線','A -.-> B'],['太線','A ==> B'],['グループ','subgraph N[項目]\n    A\n    B\nend']],
 sequence:[['メッセージ','A->>B: 項目'],['応答','B-->>A: 項目'],['注釈','Note over A: 項目'],['繰り返し','loop 項目\n    A->>B: 処理\nend'],['分岐','alt 項目\n    A->>B: はい\nelse いいえ\n    B-->>A: 応答\nend']],
 class:[['継承','A <|-- B'],['関連','A --> B : 項目'],['集約','A o-- B'],['合成','A *-- B']],
 state:[['遷移','A --> B : 項目'],['開始','[*] --> A'],['複合状態','state N {\n    A --> B\n}'],['注釈','note right of A : 項目']],
 er:[['1対多','A ||--o{ B : 項目'],['1対1','A ||--|| B : 項目']],
 mindmap:[['枝','    項目\n      子項目']],
 block:[['接続','A --> B'],['グループ','block:N\n A B\nend']],
 architecture:[['接続','A:R -- L:B'],['グループ','group N(cloud)[項目]']],
 gantt:[['セクション','section 項目']],journey:[['セクション','section 項目']],timeline:[['セクション','section 項目']]
};
export function snippets(type){const t=catalog.find(t=>t.id===type);return [...(t?.insert?[{id:`${type}-item`,name:'項目を追加',category:'基本',code:t.insert}]:[]),...(extra[type]||[]).map(([name,code],i)=>({id:`${type}-${i}`,name,category:'記法',code})),{id:'comment',name:'コードコメント',category:'補助',code:'%% 項目'}];}
