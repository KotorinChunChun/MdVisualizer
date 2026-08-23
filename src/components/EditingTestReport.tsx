import { useMemo, useState } from "react";
import {
  EDITING_TEST_CASES,
  executeEditingTestCase,
  runEditingTestCases,
  type EditingTestCase,
  type EditingTestCategory,
  type EditingTestResult,
} from "../lib/editingTestCases";
import "../styles/editing-test-report.css";

function TextCell({ value }: { value: string }) {
  return value
    ? <pre>{value}</pre>
    : <span className="editing-test-report__empty">（空文字）</span>;
}

export function EditingTestReport({
  onClose,
  cases = EDITING_TEST_CASES,
}: {
  onClose: () => void;
  cases?: readonly EditingTestCase[];
}) {
  const [results, setResults] = useState<EditingTestResult[]>(() => runEditingTestCases(cases));
  const [category, setCategory] = useState<EditingTestCategory | "すべて">("すべて");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const categories = useMemo(() => [...new Set(cases.map((testCase) => testCase.category))], [cases]);
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const visibleResults = results.filter((result) => {
    if (category !== "すべて" && result.category !== category) return false;
    if (!normalizedQuery) return true;
    return [result.id, result.category, result.description, result.before, result.key, result.expectedAfter, result.actualAfter]
      .some((value) => value.toLocaleLowerCase("ja").includes(normalizedQuery));
  });
  const passed = results.filter((result) => result.passed).length;
  const selected = results.find((result) => result.id === selectedId) ?? null;

  const rerunAll = () => setResults(runEditingTestCases(cases));
  const rerunOne = (testCase: EditingTestCase) => {
    const next = executeEditingTestCase(testCase);
    setResults((current) => current.map((result) => result.id === next.id ? next : result));
    setSelectedId(next.id);
  };

  return <div className="editing-test-report" role="dialog" aria-modal="true" aria-label="Markdown編集テスト結果">
    <header className="editing-test-report__header">
      <div>
        <h1>Markdown編集テスト結果</h1>
        <p>カーソルは <code>¦</code>、選択範囲は <code>⟦選択⟧</code> で表示します。</p>
      </div>
      <button type="button" aria-label="編集テスト結果を閉じる" onClick={onClose}>×</button>
    </header>

    <section className="editing-test-report__summary" aria-label="テスト集計">
      <strong className={passed === results.length ? "is-passed" : "is-failed"}>
        {passed} / {results.length} 成功
      </strong>
      <span>{results.length - passed}件失敗</span>
      <span>{categories.length}分類</span>
      <button type="button" onClick={rerunAll}>全ケースを再実行</button>
    </section>

    <section className="editing-test-report__filters" aria-label="結果の絞り込み">
      <label>分類
        <select value={category} onChange={(event) => setCategory(event.target.value as EditingTestCategory | "すべて")}>
          <option value="すべて">すべて</option>
          {categories.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label>検索
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="キー、説明、テキスト" />
      </label>
      <span>{visibleResults.length}件を表示</span>
    </section>

    {selected && <section className="editing-test-report__reproduction" aria-label="選択ケースの再現結果">
      <header>
        <div><strong>{selected.description}</strong><small>{selected.id}</small></div>
        <button type="button" onClick={() => setSelectedId(null)}>詳細を閉じる</button>
      </header>
      <div>
        <label>入力前テキスト<TextCell value={selected.before} /></label>
        <label>入力するキー<kbd>{selected.key}</kbd></label>
        <label>期待する変更後<TextCell value={selected.expectedAfter} /></label>
        <label>実際の変更後<TextCell value={selected.actualAfter} /></label>
      </div>
      {selected.error && <p className="editing-test-report__error">{selected.error}</p>}
      <button type="button" onClick={() => rerunOne(selected)}>このケースを再実行</button>
    </section>}

    <div className="editing-test-report__table-wrap">
      <table>
        <thead><tr>
          <th>入力前テキスト（カーソル位置に目印を表示）</th>
          <th>入力するキー</th>
          <th>変更後テキスト</th>
          <th>テスト結果</th>
        </tr></thead>
        <tbody>{visibleResults.map((result) => <tr key={result.id} className={result.passed ? "is-passed" : "is-failed"}>
          <td><small>{result.category} · {result.description}</small><TextCell value={result.before} /></td>
          <td><kbd>{result.key}</kbd></td>
          <td>
            <TextCell value={result.actualAfter} />
            {!result.passed && <details><summary>期待値との差異</summary><TextCell value={result.expectedAfter} /></details>}
          </td>
          <td>
            <strong>{result.passed ? "成功" : "失敗"}</strong>
            <button type="button" onClick={() => setSelectedId(result.id)}>再現</button>
          </td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

