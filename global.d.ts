/// <reference types="node" />

/**
 * Buffer is polyfilled in index.js from the 'buffer' npm package.
 * This declaration makes it available globally to TypeScript.
 */
declare const Buffer: typeof import('buffer').Buffer;
