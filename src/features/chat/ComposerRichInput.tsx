import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
} from "react";

import { renderComposerValueHtml } from "../../lib/composer-skills";

export interface ComposerRichInputHandle {
  focus: () => void;
  moveCursorToEnd: () => void;
}

interface ComposerRichInputProps {
  disabled?: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPasteFiles?: (files: FileList) => void;
  placeholder: string;
  value: string;
}

function placeCursorAtEnd(element: HTMLDivElement | null) {
  if (!element) {
    return;
  }

  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function serializeComposerNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const mention = node.dataset.composerSkillMention;
  if (mention) {
    return mention;
  }

  if (node.tagName === "BR") {
    return "\n";
  }

  const childText = Array.from(node.childNodes).map(serializeComposerNode).join("");
  if (node.tagName === "DIV" || node.tagName === "P") {
    return `${childText}\n`;
  }

  return childText;
}

function serializeComposerElement(element: HTMLDivElement) {
  return Array.from(element.childNodes).map(serializeComposerNode).join("").replace(/\n$/, "");
}

export const ComposerRichInput = forwardRef<ComposerRichInputHandle, ComposerRichInputProps>(
  function ComposerRichInput({ disabled = false, onChange, onKeyDown, onPasteFiles, placeholder, value }, ref) {
    const editorRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(ref, () => ({
      focus() {
        editorRef.current?.focus();
      },
      moveCursorToEnd() {
        placeCursorAtEnd(editorRef.current);
      },
    }), []);

    useLayoutEffect(() => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      const currentValue = serializeComposerElement(editor);
      if (currentValue === value) {
        return;
      }

      editor.innerHTML = renderComposerValueHtml(value);
      placeCursorAtEnd(editor);
    }, [value]);

    return (
      <div
        ref={editorRef}
        aria-disabled={disabled}
        aria-label={placeholder}
        className="composer-rich-input"
        contentEditable={!disabled}
        data-placeholder={placeholder}
        onClick={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) {
            return;
          }

          const removeButton = target.closest("[data-composer-skill-remove]");
          if (!(removeButton instanceof HTMLElement)) {
            return;
          }

          const token = removeButton.closest("[data-composer-skill-mention]");
          if (!(token instanceof HTMLElement)) {
            return;
          }

          const mention = token.dataset.composerSkillMention;
          if (!mention) {
            return;
          }

          event.preventDefault();
          const nextValue = value.replace(mention, "").replace(/[ \t]{2,}/g, " ").trimStart();
          onChange(nextValue);
          window.requestAnimationFrame(() => placeCursorAtEnd(editorRef.current));
        }}
        onInput={(event) => {
          onChange(serializeComposerElement(event.currentTarget));
        }}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const files = event.clipboardData.files;
          if (files.length > 0 && onPasteFiles) {
            event.preventDefault();
            onPasteFiles(files);
            return;
          }

          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
        role="textbox"
        spellCheck={true}
        suppressContentEditableWarning={true}
      />
    );
  },
);
