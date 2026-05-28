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

interface PlainTextRange {
  start: number;
  end: number;
}

function normalizeComposerPlainText(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function clampTextOffset(value: string, offset: number) {
  if (!Number.isFinite(offset)) {
    return value.length;
  }

  return Math.min(value.length, Math.max(0, offset));
}

function normalizePlainTextRange(value: string, range: PlainTextRange): PlainTextRange {
  const start = clampTextOffset(value, Math.min(range.start, range.end));
  const end = clampTextOffset(value, Math.max(range.start, range.end));
  return { start, end };
}

export function insertPlainTextAtRange(value: string, text: string, range: PlainTextRange) {
  const normalizedRange = normalizePlainTextRange(value, range);
  const normalizedText = normalizeComposerPlainText(text);
  return `${value.slice(0, normalizedRange.start)}${normalizedText}${value.slice(normalizedRange.end)}`;
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

function isSerializedBlockNode(node: HTMLElement) {
  return (node.tagName === "DIV" || node.tagName === "P") && !node.classList.contains("composer-rich-input");
}

function getSerializedNodeLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").length;
  }

  if (!(node instanceof HTMLElement)) {
    return 0;
  }

  const mention = node.dataset.composerSkillMention;
  if (mention) {
    return mention.length;
  }

  if (node.tagName === "BR") {
    return 1;
  }

  const childLength = Array.from(node.childNodes).reduce((total, child) => total + getSerializedNodeLength(child), 0);
  return childLength + (isSerializedBlockNode(node) ? 1 : 0);
}

function getNodeIndex(node: Node) {
  return node.parentNode ? Array.prototype.indexOf.call(node.parentNode.childNodes, node) : 0;
}

function getPositionBeforeNode(node: Node) {
  return {
    container: node.parentNode ?? node,
    offset: node.parentNode ? getNodeIndex(node) : 0,
  };
}

function getPositionAfterNode(node: Node) {
  return {
    container: node.parentNode ?? node,
    offset: node.parentNode ? getNodeIndex(node) + 1 : node.childNodes.length,
  };
}

function findSerializedCursorPosition(node: Node, offset: number): { container: Node; offset: number } {
  if (node.nodeType === Node.TEXT_NODE) {
    const textLength = (node.textContent ?? "").length;
    return {
      container: node,
      offset: Math.min(textLength, Math.max(0, offset)),
    };
  }

  if (!(node instanceof HTMLElement)) {
    return getPositionAfterNode(node);
  }

  const mention = node.dataset.composerSkillMention;
  if (mention) {
    return offset <= 0 ? getPositionBeforeNode(node) : getPositionAfterNode(node);
  }

  if (node.tagName === "BR") {
    return offset <= 0 ? getPositionBeforeNode(node) : getPositionAfterNode(node);
  }

  let remaining = Math.max(0, offset);
  for (const child of Array.from(node.childNodes)) {
    const childLength = getSerializedNodeLength(child);
    if (remaining <= childLength) {
      return findSerializedCursorPosition(child, remaining);
    }
    remaining -= childLength;
  }

  if (isSerializedBlockNode(node) && remaining <= 1) {
    return getPositionAfterNode(node);
  }

  return {
    container: node,
    offset: node.childNodes.length,
  };
}

function placeCursorAtSerializedOffset(element: HTMLDivElement | null, offset: number) {
  if (!element) {
    return;
  }

  element.focus();
  const valueLength = serializeComposerElement(element).length;
  const position = findSerializedCursorPosition(element, Math.min(valueLength, Math.max(0, offset)));
  const range = document.createRange();
  range.setStart(position.container, position.offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function serializeRangePrefix(element: HTMLDivElement, container: Node, offset: number) {
  const range = document.createRange();
  range.setStart(element, 0);
  range.setEnd(container, offset);
  const fragment = range.cloneContents();
  const wrapper = document.createElement("div");
  wrapper.appendChild(fragment);
  return serializeComposerElement(wrapper).length;
}

function readComposerSelectionRange(element: HTMLDivElement, value: string): PlainTextRange {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { start: value.length, end: value.length };
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
    return { start: value.length, end: value.length };
  }

  return normalizePlainTextRange(value, {
    start: serializeRangePrefix(element, range.startContainer, range.startOffset),
    end: serializeRangePrefix(element, range.endContainer, range.endOffset),
  });
}

export const ComposerRichInput = forwardRef<ComposerRichInputHandle, ComposerRichInputProps>(
  function ComposerRichInput({ disabled = false, onChange, onKeyDown, onPasteFiles, placeholder, value }, ref) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const pendingCursorOffsetRef = useRef<number | null>(null);

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

      const pendingCursorOffset = pendingCursorOffsetRef.current;
      pendingCursorOffsetRef.current = null;
      const currentValue = serializeComposerElement(editor);
      if (currentValue === value) {
        if (pendingCursorOffset !== null) {
          placeCursorAtSerializedOffset(editor, pendingCursorOffset);
        }
        return;
      }

      editor.innerHTML = renderComposerValueHtml(value);
      if (pendingCursorOffset !== null) {
        placeCursorAtSerializedOffset(editor, pendingCursorOffset);
        return;
      }

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
          const text = normalizeComposerPlainText(event.clipboardData.getData("text/plain"));
          if (!text) {
            return;
          }

          const selectedRange = readComposerSelectionRange(event.currentTarget, value);
          pendingCursorOffsetRef.current = selectedRange.start + text.length;
          onChange(insertPlainTextAtRange(value, text, selectedRange));
        }}
        role="textbox"
        spellCheck={true}
        suppressContentEditableWarning={true}
      />
    );
  },
);
