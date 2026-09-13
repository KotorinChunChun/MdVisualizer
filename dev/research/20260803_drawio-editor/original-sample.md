# Markdown Editor 機能テスト

この初期Markdownには、主要機能を一通り試せるサンプルを入れています。見出し・コードブロック・Base64行は左端の折り畳み操作も確認できます。

## 1. Markdown基本表示

**太字**、*斜体*、~~取り消し線~~、`inline code`、[リンク](https://example.com) を確認できます。

> 引用のサンプルです。

- 箇条書き
- [x] 完了済み
- [ ] 未完了

| 項目 | 内容 |
|---|---|
| Markdown | 通常の表 |
| Toolbar | 上部ボタンから挿入可能 |

## 2. シンタックスハイライト

### Python

```python
from pathlib import Path

files = [p.name for p in Path('.').glob('*.md')]
print(files)
```

### JavaScript

```javascript
const users = [
  { id: 1, name: 'Nobunaga' },
  { id: 2, name: 'Hideyoshi' },
];
console.table(users);
```

### PowerShell

```powershell
Get-ChildItem -Filter *.md |
  Select-Object Name, Length
```

## 3. TSV — フィルタ・SearchPanes・WYSIWYG編集

先頭行は常にヘッダーです。「表を編集」ではセル値・カラム名変更、行/列追加、**任意の行・任意の列の削除**を確認できます。

```tsv
顧客ID	氏名	都道府県	住所	電話番号	メールアドレス	会員ランク
C0001	織田 信長	愛知県	名古屋市中区架空町1-1	000-0000-0001	nobunaga@example.com	ゴールド
C0002	豊臣 秀吉	大阪府	大阪市中央区架空町2-3	000-0000-0002	hideyoshi@example.com	プラチナ
C0003	徳川 家康	静岡県	静岡市葵区架空町3-5	000-0000-0003	ieyasu@example.com	プラチナ
C0004	武田 信玄	山梨県	甲府市架空町4-7	000-0000-0004	shingen@example.com	ゴールド
C0005	上杉 謙信	新潟県	上越市架空町5-2	000-0000-0005	kenshin@example.com	シルバー
C0006	伊達 政宗	宮城県	仙台市青葉区架空町6-4	000-0000-0006	masamune@example.com	ゴールド
C0007	毛利 元就	広島県	広島市中区架空町7-8	000-0000-0007	motonari@example.com	シルバー
C0008	島津 義弘	鹿児島県	鹿児島市架空町8-6	000-0000-0008	yoshihiro@example.com	ブロンズ
C0009	真田 幸村	長野県	上田市架空町9-1	000-0000-0009	yukimura@example.com	ゴールド
C0010	明智 光秀	京都府	京都市中京区架空町10-2	000-0000-0010	mitsuhide@example.com	シルバー
C0011	石田 三成	滋賀県	彦根市架空町11-3	000-0000-0011	mitsunari@example.com	ブロンズ
C0012	前田 利家	石川県	金沢市架空町12-5	000-0000-0012	toshiie@example.com	シルバー
C0013	黒田 官兵衛	兵庫県	姫路市架空町13-7	000-0000-0013	kanbei@example.com	プラチナ
C0014	長宗我部 元親	高知県	高知市架空町14-4	000-0000-0014	motochika@example.com	ブロンズ
C0015	北条 氏康	神奈川県	小田原市架空町15-6	000-0000-0015	ujiyasu@example.com	ゴールド
```

## 4. CSV — 同じ顧客データ

```csv
顧客ID,氏名,都道府県,住所,電話番号,メールアドレス,会員ランク
C0001,織田 信長,愛知県,名古屋市中区架空町1-1,000-0000-0001,nobunaga@example.com,ゴールド
C0002,豊臣 秀吉,大阪府,大阪市中央区架空町2-3,000-0000-0002,hideyoshi@example.com,プラチナ
C0003,徳川 家康,静岡県,静岡市葵区架空町3-5,000-0000-0003,ieyasu@example.com,プラチナ
C0004,武田 信玄,山梨県,甲府市架空町4-7,000-0000-0004,shingen@example.com,ゴールド
C0005,上杉 謙信,新潟県,上越市架空町5-2,000-0000-0005,kenshin@example.com,シルバー
C0006,伊達 政宗,宮城県,仙台市青葉区架空町6-4,000-0000-0006,masamune@example.com,ゴールド
C0007,毛利 元就,広島県,広島市中区架空町7-8,000-0000-0007,motonari@example.com,シルバー
C0008,島津 義弘,鹿児島県,鹿児島市架空町8-6,000-0000-0008,yoshihiro@example.com,ブロンズ
C0009,真田 幸村,長野県,上田市架空町9-1,000-0000-0009,yukimura@example.com,ゴールド
C0010,明智 光秀,京都府,京都市中京区架空町10-2,000-0000-0010,mitsuhide@example.com,シルバー
C0011,石田 三成,滋賀県,彦根市架空町11-3,000-0000-0011,mitsunari@example.com,ブロンズ
C0012,前田 利家,石川県,金沢市架空町12-5,000-0000-0012,toshiie@example.com,シルバー
C0013,黒田 官兵衛,兵庫県,姫路市架空町13-7,000-0000-0013,kanbei@example.com,プラチナ
C0014,長宗我部 元親,高知県,高知市架空町14-4,000-0000-0014,motochika@example.com,ブロンズ
C0015,北条 氏康,神奈川県,小田原市架空町15-6,000-0000-0015,ujiyasu@example.com,ゴールド
```

## 5. Mermaidをそのままプレビュー

`mermaid` コードブロックはMermaidのままSVGプレビューします。

```mermaid
flowchart LR
  A[Markdown] --> B{Preview}
  B --> C[Mermaid]
  B --> D[draw.io]
  C --> E[SVG表示]
```

## 6. Mermaid → draw.io変換

同じMermaid記法を `drawio` ブロックへ入れると、「編集」で draw.io公式のMermaid変換器へ直接渡し、ネイティブなdraw.io図形として編集できます。

```drawio
flowchart TD
  S[開始] --> Q{内容を確認}
  Q -->|OK| E[完了]
  Q -->|修正| R[修正する]
  R --> Q
```

## 7. SVG → draw.ioネイティブ図形変換

添付 `star.svg` の内容です。背景の `rect` と星の `polygon` を個別のdraw.io図形へ変換します。

```drawio
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="1024"
  height="1024"
  viewBox="0 0 1024 1024"
>
  <!-- 青い背景 -->
  <rect
    x="0"
    y="0"
    width="1024"
    height="1024"
    fill="#0863F5"
  />

  <!-- 白い星 -->
  <polygon
    points="
      512,126
      602,398
      882,398
      660,562
      750,842
      512,671
      278,842
      367,562
      144,398
      423,398
    "
    fill="#FFFFFF"
  />
</svg>
```

## 8. 既存draw.io圧縮データ

```drawio
tZVRT9swEMc/TR5Bid0WeISWdZs0CVQQ8GjFt8QisTPXJek+/Rx8buwEKJO2p/r+vjsnv/vHTeiy7taaNeUPxaFKSMq7hK4SQkhKUvvTK3unZGROnVJowVEbhI34DShiYbETHLZRolGqMqKJxVxJCbmJNKa1auO0n6qKT21YARNhk7Nqqj4IbkqnnpOzQf8Koij9ydniwu3UzCfjm2xLxlUbSPQ6oUutlHGrultC1dPzXFzdl3d2Dw+mQZrPFJC1hOfyJL8Vd7+W35/prL5PT97ogtLW7D0DrXaSQ98mTehVWwoDm4bl/W5rx2610tSVjTK7dNUvrNphNQqgDXTBCfiQa1A1GL23KWXAcYHQ2oF55kH6Lj7HW4tizHDkxaH1QMUuEMxfQCKfgWT7WE/CcUDWBw18k1vr63+K7Pw4MnoRIzv7X8TwGwc++bimCNVO53DcoiFqyS/7T9tGUkmI8cZmhU6YR9zp10+9fjrHaNUFaau9D6RF8BgGQVUfDmWvka/D24npAsxxN43G/fFs5zgoDRUz4iWGGgx8/sFA8YQbJewE3rXEYjFq4eaDVeH1Mmo0m40aZaNGDsyk0au/Dq/9luVsONySLn34s6HXfwA=
```

## 9. 単一HTML（HTML + CSS + JS）プレビュー

添付 `omikuji.html` の内容です。iframeは使わず、右側ではShadow DOMベースでプレビューします。「別ウィンドウで実行」も確認できます。

なお、JavaScriptを含むため、SPFxで動作しないのは承知しています。本当に動作しないことを確認するための検証用です。

```html:omikuji.html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>おみくじ</title>
  <style>
    :root {
      --bg1: #f7efe3;
      --bg2: #ead8bd;
      --paper: #fffdf8;
      --ink: #2b2118;
      --red: #b52b2b;
      --gold: #b89446;
      --shadow: rgba(71, 47, 24, 0.18);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      color: var(--ink);
      font-family:
        "Yu Mincho", "Hiragino Mincho ProN", "Hiragino Mincho Pro",
        "Noto Serif JP", serif;
      background:
        radial-gradient(circle at 20% 15%, rgba(255,255,255,.75), transparent 28%),
        radial-gradient(circle at 80% 85%, rgba(255,255,255,.55), transparent 30%),
        linear-gradient(145deg, var(--bg1), var(--bg2));
      overflow-x: hidden;
    }

    body::before,
    body::after {
      content: "";
      position: fixed;
      width: 42vmin;
      height: 42vmin;
      border: 1px solid rgba(181, 43, 43, 0.08);
      border-radius: 50%;
      pointer-events: none;
    }

    body::before {
      top: -18vmin;
      left: -14vmin;
    }

    body::after {
      right: -14vmin;
      bottom: -18vmin;
    }

    .app {
      width: min(92vw, 560px);
      padding: 32px 20px 36px;
      text-align: center;
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--red);
      font-size: 12px;
      letter-spacing: .35em;
      font-weight: 700;
    }

    h1 {
      margin: 0;
      font-size: clamp(38px, 8vw, 58px);
      letter-spacing: .18em;
      transform: translateX(.09em);
    }

    .sub {
      margin: 10px 0 26px;
      font-size: 14px;
      opacity: .72;
    }

    .box {
      position: relative;
      min-height: 430px;
      display: flex;
      align-items: center;
      justify-content: center;
      perspective: 1000px;
    }

    .omikuji {
      position: relative;
      width: min(76vw, 330px);
      min-height: 390px;
      padding: 26px 30px 30px;
      background:
        linear-gradient(rgba(181,43,43,.025), rgba(181,43,43,.025)),
        var(--paper);
      border: 2px solid var(--red);
      box-shadow: 0 18px 45px var(--shadow);
      transform-origin: top center;
      transition: transform .45s ease, opacity .35s ease;
    }

    .omikuji::before,
    .omikuji::after {
      content: "";
      position: absolute;
      inset: 10px;
      border: 1px solid rgba(181,43,43,.45);
      pointer-events: none;
    }

    .omikuji::after {
      inset: 16px;
      border-color: rgba(184,148,70,.35);
    }

    .seal {
      width: 66px;
      height: 66px;
      margin: 0 auto 16px;
      display: grid;
      place-items: center;
      border: 3px double var(--red);
      color: var(--red);
      font-size: 24px;
      font-weight: 800;
      line-height: 1;
      transform: rotate(-2deg);
    }

    .fortune {
      margin: 0 0 18px;
      color: var(--red);
      font-size: clamp(42px, 10vw, 64px);
      line-height: 1;
      letter-spacing: .12em;
      transform: translateX(.06em);
    }

    .message {
      margin: 0 auto 24px;
      max-width: 240px;
      line-height: 1.95;
      font-size: 16px;
      min-height: 62px;
    }

    .details {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 14px;
      margin-top: 4px;
      text-align: left;
      font-size: 13px;
    }

    .detail {
      display: grid;
      grid-template-columns: 3.2em 1fr;
      gap: 8px;
      padding: 7px 0;
      border-top: 1px solid rgba(43,33,24,.12);
    }

    .detail b {
      color: var(--red);
      font-weight: 700;
    }

    .placeholder {
      display: grid;
      place-items: center;
      min-height: 390px;
      width: min(76vw, 330px);
      padding: 28px;
      border: 2px dashed rgba(181,43,43,.38);
      background: rgba(255,253,248,.45);
      color: rgba(43,33,24,.66);
      line-height: 1.9;
    }

    .draw-btn,
    .again-btn {
      appearance: none;
      border: 0;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      letter-spacing: .08em;
      transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease;
    }

    .draw-btn {
      min-width: 210px;
      padding: 16px 26px;
      color: #fff;
      background: linear-gradient(#c33b3b, #a91f1f);
      border-radius: 999px;
      box-shadow: 0 8px 18px rgba(145, 29, 29, .24);
    }

    .again-btn {
      margin-top: 20px;
      padding: 10px 18px;
      color: var(--red);
      background: transparent;
      border: 1px solid rgba(181,43,43,.45);
      border-radius: 999px;
    }

    button:hover {
      transform: translateY(-2px);
    }

    button:active {
      transform: translateY(0);
    }

    button:disabled {
      cursor: wait;
      opacity: .65;
    }

    .shake {
      animation: shake .75s ease-in-out;
    }

    .reveal {
      animation: reveal .65s cubic-bezier(.2,.8,.2,1) both;
    }

    @keyframes shake {
      0%, 100% { transform: rotate(0deg); }
      15% { transform: rotate(-3deg) translateY(-4px); }
      30% { transform: rotate(3deg) translateY(2px); }
      45% { transform: rotate(-2deg) translateY(-3px); }
      60% { transform: rotate(2deg) translateY(1px); }
      75% { transform: rotate(-1deg); }
    }

    @keyframes reveal {
      from {
        opacity: 0;
        transform: rotateX(-12deg) translateY(18px) scale(.97);
      }
      to {
        opacity: 1;
        transform: rotateX(0) translateY(0) scale(1);
      }
    }

    .note {
      margin-top: 16px;
      font-size: 11px;
      opacity: .5;
    }

    @media (max-width: 420px) {
      .app {
        padding-inline: 12px;
      }

      .omikuji {
        padding-inline: 24px;
      }

      .details {
        grid-template-columns: 1fr;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: .01ms !important;
      }
    }
  </style>
</head>
<body>
  <main class="app">
    <p class="eyebrow">運 試 し</p>
    <h1>おみくじ</h1>
    <p class="sub">心を決めて、一枚お引きください。</p>

    <section class="box" id="box" aria-live="polite">
      <div class="placeholder" id="placeholder">
        <div>
          <div style="font-size:54px; color:#b52b2b; margin-bottom:12px;">御</div>
          今日の運勢を占います。<br />
          下のボタンを押してください。
        </div>
      </div>
    </section>

    <button class="draw-btn" id="drawBtn" type="button">おみくじを引く</button>
    <div class="note">※ このおみくじは娯楽用です。</div>
  </main>

  <script>
    const fortunes = [
      {
        name: "大吉",
        weight: 12,
        messages: [
          "追い風が吹く日。迷っていたことは、思い切って一歩進めると吉。",
          "積み重ねてきたことが形になりやすい運勢。感謝を忘れず進むべし。",
          "良い知らせが舞い込みそう。人との縁を大切にするとさらに運気上昇。"
        ]
      },
      {
        name: "吉",
        weight: 24,
        messages: [
          "穏やかに物事が進む日。焦らず、自分のペースを守ると良し。",
          "小さな幸運を見逃さないこと。丁寧な行動が次の機会につながる。",
          "身近な人から良いヒントが得られそう。素直に耳を傾けるべし。"
        ]
      },
      {
        name: "中吉",
        weight: 22,
        messages: [
          "努力が少しずつ実を結ぶ兆し。最後まで手を抜かず仕上げると吉。",
          "予定外の出来事も味方になりそう。柔軟に対応すると道が開ける。",
          "新しいことを始めるには良い日。まずは小さく試してみるべし。"
        ]
      },
      {
        name: "小吉",
        weight: 20,
        messages: [
          "小さな前進を大切に。今日は無理をせず、確実な一歩を選ぶと良い。",
          "思わぬところに助け舟あり。周囲との連携が運を呼ぶ。",
          "急がば回れ。確認を一つ増やすことで失敗を避けられそう。"
        ]
      },
      {
        name: "末吉",
        weight: 15,
        messages: [
          "今は準備の時。すぐ結果が出なくても、続けることで後に実る。",
          "静かな運気。目立つ行動より、身の回りを整えることが吉。",
          "待つことも大切。判断を急がず、情報が揃ってから動くべし。"
        ]
      },
      {
        name: "凶",
        weight: 7,
        messages: [
          "今日は慎重さが大切。無理な勝負は避け、足元を確かめるべし。",
          "予定通りに進まなくても慌てないこと。休息と見直しが運気回復の鍵。",
          "言葉の行き違いに注意。大事なことは一度確認してから伝えると良い。"
        ]
      }
    ];

    const detailOptions = {
      願望: ["叶いやすし", "時を待て", "焦らず進め", "人の助けあり", "努力すれば叶う"],
      仕事: ["成果あり", "丁寧さが吉", "新案に光あり", "確認を怠るな", "協力者現る"],
      学問: ["集中すれば吉", "復習を大切に", "基礎固めが吉", "継続に実りあり", "新しい学び吉"],
      待人: ["来る", "やや遅し", "知らせあり", "思わぬ形で来る", "気長に待て"],
      旅行: ["良し", "近場が吉", "計画を整えよ", "忘れ物に注意", "急な変更に注意"],
      金運: ["上向き", "節約が吉", "臨時の実りあり", "大きな買物は慎重に", "小さな得あり"]
    };

    const box = document.getElementById("box");
    const drawBtn = document.getElementById("drawBtn");

    function randomOf(array) {
      return array[Math.floor(Math.random() * array.length)];
    }

    function weightedFortune() {
      const total = fortunes.reduce((sum, f) => sum + f.weight, 0);
      let r = Math.random() * total;
      for (const f of fortunes) {
        r -= f.weight;
        if (r < 0) return f;
      }
      return fortunes[0];
    }

    function createResult(fortune) {
      const details = Object.entries(detailOptions)
        .map(([label, values]) => `
          <div class="detail">
            <b>${label}</b>
            <span>${randomOf(values)}</span>
          </div>
        `)
        .join("");

      return `
        <article class="omikuji reveal">
          <div class="seal">御籤</div>
          <h2 class="fortune">${fortune.name}</h2>
          <p class="message">${randomOf(fortune.messages)}</p>
          <div class="details">${details}</div>
        </article>
      `;
    }

    function drawOmikuji() {
      drawBtn.disabled = true;
      drawBtn.textContent = "振っています…";

      box.classList.remove("shake");
      void box.offsetWidth;
      box.classList.add("shake");

      window.setTimeout(() => {
        const fortune = weightedFortune();
        box.innerHTML = createResult(fortune);
        box.classList.remove("shake");
        drawBtn.disabled = false;
        drawBtn.textContent = "もう一度引く";
      }, 760);
    }

    drawBtn.addEventListener("click", drawOmikuji);
  </script>
</body>
</html>
```

## 10. Base64画像

画像の「編集」からPaint風エディタを確認できます。

![image.png](data:image/png;base64,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)
