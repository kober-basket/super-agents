interface ComposerKeyDownNativeEvent {
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
}

export interface ComposerKeyDownEvent {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
  nativeEvent?: ComposerKeyDownNativeEvent;
}

function isImeCompositionEvent(event: ComposerKeyDownEvent) {
  return (
    event.isComposing === true ||
    event.nativeEvent?.isComposing === true ||
    event.keyCode === 229 ||
    event.which === 229 ||
    event.nativeEvent?.keyCode === 229 ||
    event.nativeEvent?.which === 229
  );
}

export function shouldSubmitComposerKeyDown(event: ComposerKeyDownEvent) {
  if (event.key !== "Enter" || event.shiftKey) {
    return false;
  }

  return !isImeCompositionEvent(event);
}
