/// <reference types="vite/client" />

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        allowpopups?: string;
        partition?: string;
        src?: string;
        webpreferences?: string;
      },
      HTMLElement
    >;
  }
}
