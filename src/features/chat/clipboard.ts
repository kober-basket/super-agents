interface ClipboardLike {
  writeText?: (text: string) => Promise<void>;
}

interface NavigatorLike {
  clipboard?: ClipboardLike;
}

interface DocumentLike {
  body: {
    appendChild: (node: HTMLTextAreaElement) => void;
  };
  createElement: (tagName: "textarea") => HTMLTextAreaElement;
  execCommand?: (commandId: string) => boolean;
}

interface DesktopAgentClipboardLike {
  writeClipboardText?: (text: string) => Promise<void>;
}

export interface ClipboardHost {
  desktopAgent?: DesktopAgentClipboardLike;
  navigator?: NavigatorLike;
  document?: DocumentLike;
}

function defaultClipboardHost(): ClipboardHost {
  if (typeof window === "undefined") {
    return {};
  }

  return {
    desktopAgent: window.desktopAgent,
    navigator,
    document,
  };
}

async function copyWithTextareaFallback(text: string, host: ClipboardHost) {
  const activeDocument = host.document;
  if (!activeDocument?.execCommand) {
    throw new Error("Clipboard is unavailable");
  }

  const textarea = activeDocument.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  activeDocument.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (!activeDocument.execCommand("copy")) {
      throw new Error("Clipboard copy command failed");
    }
  } finally {
    textarea.remove();
  }
}

export async function copyTextToClipboard(text: string, host: ClipboardHost = defaultClipboardHost()) {
  if (host.desktopAgent?.writeClipboardText) {
    try {
      await host.desktopAgent.writeClipboardText(text);
      return;
    } catch {
      // Fall through to browser-level clipboard options when the bridge is present but unavailable.
    }
  }

  if (host.navigator?.clipboard?.writeText) {
    try {
      await host.navigator.clipboard.writeText(text);
      return;
    } catch {
      // Last resort below keeps copy usable in older or permission-constrained renderers.
    }
  }

  await copyWithTextareaFallback(text, host);
}
