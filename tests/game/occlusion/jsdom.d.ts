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
  export const expect: any
}
