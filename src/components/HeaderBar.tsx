import React from "react";
import { getFileName } from "../lib/path";

interface HeaderBarProps {
  filePath: string | null;
  onReload: () => void;
  onSearch: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({ filePath, onReload, onSearch }) => {
  const fileName = filePath ? getFileName(filePath) : "Markdownファイル未選択";

  return (
    <header className="header-bar">
      <div className="file-info" title={filePath || ""}>
        <span className="file-icon">📄</span>
        <span className="file-name">{fileName}</span>
      </div>
      <div className="header-actions">
        <button
          className="btn btn-secondary"
          onClick={onSearch}
          title="文書内を検索 (Ctrl+F)"
          disabled={!filePath}
        >
          検索
        </button>
        <button
          className="btn btn-secondary"
          onClick={onReload}
          title="F5キーで手動リロード"
          disabled={!filePath}
        >
          再読み込み
        </button>
      </div>
    </header>
  );
};
