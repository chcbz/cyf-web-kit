declare module 'jsdom' {
  export interface JSDOMOptions {
    contentType?: string
  }

  export class JSDOM {
    constructor(input?: string, options?: JSDOMOptions)
    readonly window: {
      readonly document: Document
    }
  }
}
