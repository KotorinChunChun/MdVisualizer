import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeRaw from "rehype-raw";
import { ImageRenderer } from "./ImageRenderer";
import { FoldSection } from "./FoldSection";
import { CropTarget } from "../hooks/useCropEditor";
import { rehypeFoldSections } from "../lib/foldSections";
import { markdownSanitizeSchema } from "../lib/sanitizeSchema";
import { CodeBlock } from "./CodeBlock";
import { MermaidBlock } from "./MermaidBlock";

interface MarkdownPreviewProps {
  content: string;
  baseDir: string;
  imageVersions: Record<string, number>;
  onStartCrop: (target: CropTarget) => void;
  contentRef?: React.Ref<HTMLDivElement>;
  theme?: string;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  baseDir,
  imageVersions,
  onStartCrop,
  contentRef,
  theme = "dark",
}) => {
  return (
    <div className="markdown-body" ref={contentRef}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeFoldSections, [rehypeSanitize, markdownSanitizeSchema]]}
        components={{
          section: ({ children }) => <FoldSection>{children}</FoldSection>,
          code: ({ className, children, ...props }) => className?.includes("language-mermaid") ? <MermaidBlock source={String(children ?? "")} theme={theme} /> : className?.includes("language-") ? <CodeBlock className={className}>{children}</CodeBlock> : <code className={className} {...props}>{children}</code>,
          table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
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
