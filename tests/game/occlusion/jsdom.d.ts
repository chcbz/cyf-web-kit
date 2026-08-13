declare module 'jsdom' {
  export interface JSDOMOptions {
    contentType?: string
    url?: string
  }

  export class JSDOM {
    constructor(input?: string, options?: JSDOMOptions)
    readonly window: {
      readonly document: Document
      readonly DOMParser: typeof DOMParser
    }
  }
}

declare module 'chai' {
  interface Assertion {
    readonly to: Assertion
    readonly be: Assertion
    readonly been: Assertion
    readonly is: Assertion
    readonly that: Assertion
    readonly which: Assertion
    readonly and: Assertion
    readonly has: Assertion
    readonly have: Assertion
    readonly with: Assertion
    readonly at: Assertion
    readonly of: Assertion
    readonly same: Assertion
    readonly but: Assertion
    readonly does: Assertion
    readonly still: Assertion
    readonly also: Assertion
    readonly not: Assertion
    readonly deep: Assertion
    readonly true: Assertion
    readonly false: Assertion
    readonly null: Assertion
    readonly undefined: Assertion
    readonly empty: Assertion
    readonly length: Assertion & ((expected: number, message?: string) => Assertion)
    readonly lengthOf: Assertion & ((expected: number, message?: string) => Assertion)
    equal(expected: unknown, message?: string): Assertion
    include(expected: unknown, message?: string): Assertion
    property(name: PropertyKey, value?: unknown, message?: string): Assertion
    match(pattern: RegExp, message?: string): Assertion
    throw(expected?: unknown, message?: string): Assertion
    a(type: string, message?: string): Assertion
    an(type: string, message?: string): Assertion
    instanceOf(constructor: abstract new (...args: never[]) => unknown, message?: string): Assertion
    below(limit: number, message?: string): Assertion
    lessThan(limit: number, message?: string): Assertion
    greaterThan(limit: number, message?: string): Assertion
    least(limit: number, message?: string): Assertion
  }

  export function expect(actual: unknown, message?: string): Assertion
}
