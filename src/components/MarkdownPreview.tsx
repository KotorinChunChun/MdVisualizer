import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { ImageRenderer } from "./ImageRenderer";
import { CropTarget } from "../hooks/useCropEditor";

interface MarkdownPreviewProps {
  content: string;
  baseDir: string;
  imageVersions: Record<string, number>;
  onStartCrop: (target: CropTarget) => void;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  baseDir,
  imageVersions,
  onStartCrop,
}) => {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          img: ({ src, alt }) => (
            <ImageRenderer
              src={src}
              alt={alt}
              baseDir={baseDir}
              imageVersions={imageVersions}
              onStartCrop={onStartCrop}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
