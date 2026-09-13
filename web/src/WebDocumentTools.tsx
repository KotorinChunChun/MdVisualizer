import { useState } from 'react';
import { createPortal } from 'react-dom';
import { DocumentDiffWorkspace } from '@/components/DocumentDiffWorkspace';
import { PresentationView } from '@/components/PresentationView';
import { MediaPreviewModal, type MediaPreviewTarget } from '@/components/MediaPreviewModal';
import type { DocumentSession } from './documentSession';
import { assetBase } from './workspace';
import './document-tools.css';

export function WebDiff({ session, baseline, onChange, onSave, onClose }: { session: DocumentSession; baseline: string; onChange: (markdown: string) => void; onSave: () => void; onClose: () => void }) {
  return createPortal(<section className="web-document-tool" aria-label="差分比較">
    <div className="web-document-tool__bar"><strong>差分比較</strong><span>開いた時点の文書と現在の本文を比較します。</span><button type="button" onClick={onClose}>比較を閉じる</button></div>
    <DocumentDiffWorkspace target={{ path: session.name, baseDir: assetBase(session.name), openedContent: baseline, storageContent: baseline, editingContent: session.markdown }} editorMode="edit" theme="light" onEditingChange={onChange} onSave={onSave} />
  </section>, document.body);
}

export function WebPresentation({ session, onClose, onError, onOpenDocument }: { session: DocumentSession; onClose: () => void; onError: (message: string) => void; onOpenDocument?: (path: string) => void }) {
  const [media, setMedia] = useState<MediaPreviewTarget | null>(null);
  return createPortal(<section className="web-document-tool web-document-tool--presentation" aria-label="プレゼンテーション">
    <div className="web-document-tool__bar"><strong>プレゼンテーション</strong><button type="button" onClick={() => window.print()}>印刷</button><button type="button" onClick={onClose}>プレゼンを終了</button></div>
    <PresentationView content={session.markdown} baseDir={assetBase(session.name)} sourcePath={session.name} imageVersions={{}} imageDisplaySizes={{}} theme="light" mermaidMode="on" windowId="web" tabId={session.name} onError={onError} onMediaOpen={setMedia} onOpenDocument={onOpenDocument} />
    {media && <MediaPreviewModal content={media.content} headingTitle={media.headingTitle} onClose={() => setMedia(null)} />}
  </section>, document.body);
}
