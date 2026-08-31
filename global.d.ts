/// <reference types="node" />

/**
 * Buffer is polyfilled in index.js from the 'buffer' npm package.
 * This declaration makes it available globally to TypeScript.
 */
declare const Buffer: typeof import('buffer').Buffer;

declare module 'qrcode/lib/core/qrcode' {
  export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

  export interface QrModules {
    readonly size: number;
    get(x: number, y: number): boolean;
  }

  export interface QrCode {
    modules: QrModules | undefined;
  }

  export interface QrCreateOptions {
    errorCorrectionLevel?: QrErrorCorrectionLevel;
  }

  const QRCode: {
    create(text: string, options?: QrCreateOptions): QrCode;
  };

  export default QRCode;
}

declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export type ReactTestInstance = {
    props: { [propName: string]: any };
    findByType(type: unknown): ReactTestInstance;
    findAllByType(type: unknown): ReactTestInstance[];
    findByProps(props: { [propName: string]: any }): ReactTestInstance;
    findAllByProps(props: { [propName: string]: any }): ReactTestInstance[];
  };

  export type ReactTestRenderer = {
    toJSON(): unknown;
    unmount(): void;
    root: ReactTestInstance;
  };

  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => void | Promise<void>): Promise<void>;
}
