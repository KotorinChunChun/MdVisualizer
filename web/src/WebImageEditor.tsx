import { ImageAnnotationEditor } from '@/components/ImageAnnotationEditor';

export function WebImageEditor({ source, filename, onApply, onClose, onError }: {
  source: string;
  filename: string;
  onApply: (dataUri: string) => void | Promise<void>;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  return <ImageAnnotationEditor
    key={source}
    target={{ rawSrc: source, filename, storage: 'embedded' }}
    imageVersion={0}
    enableNativeDragDrop={false}
    onCancel={onClose}
    onError={onError}
    onApply={async (result) => {
      if (!result.dataUri) {
        onError('ブラウザー内画像をPNGへ変換できません。');
        return;
      }
      await onApply(result.dataUri);
    }}
  />;
}
