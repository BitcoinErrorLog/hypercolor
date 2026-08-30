declare module 'light-bolt11-decoder' {
  export type Bolt11Section = {
    name: string;
    letters?: string;
    tag?: string;
    value?: unknown;
  };

  export type DecodedBolt11 = {
    paymentRequest: string;
    sections: Bolt11Section[];
    expiry?: number;
  };

  export function decode(invoice: string): DecodedBolt11;
  export function hrpToMillisat(hrp: string, outputString?: boolean): bigint | string;
}
