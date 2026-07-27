import React from "react";
import { openExternalEditor } from "../lib/commands";
import { getFileName } from "../lib/path";

interface HeaderBarProps {
  filePath: string | null;
  onReload: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({ filePath, onReload }) => {
  const fileName = filePath ? getFileName(filePath) : "Markdownファイル未選択";

  const handleOpenExternal = async () => {
    if (!filePath) return;
    try {
      await openExternalEditor(filePath);
    } catch (err) {
      console.error("Failed to open external editor:", err);
    }
  };

  return (
    <header className="header-bar">
      <div className="file-info" title={filePath || ""}>
        <span className="file-icon">📄</span>
        <span className="file-name">{fileName}</span>
      </div>
      <div className="header-actions">
        <button
          className="btn btn-secondary"
          onClick={onReload}
          title="F5キーで手動リロード"
          disabled={!filePath}
        >
          🔄 リロード
        </button>
        <button
          className="btn btn-primary"
          onClick={handleOpenExternal}
          disabled={!filePath}
          title="外部エディタで開く"
        >
          📝 外部エディタで開く
        </button>
      </div>
    </header>
  );
};
