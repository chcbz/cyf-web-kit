import { Ref } from 'vue'

export interface HttpOptions {
  url?: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: any
  params?: Record<string, any>
  headers?: Record<string, string>
  autoLoading?: boolean
  needAuth?: boolean
  responseType?: 'json' | 'stream'
  timeout?: number
  onSuccess?: (data: any, response: any) => void
  onError?: (errorMessage: string, error: any) => void
  onFinally?: () => void
  onStream?: (eventData: string) => void
  onStreamEnd?: () => void
}

export interface HttpReturn {
  loading: Ref<boolean>
  error: Ref<string | null>
  data: Ref<any>
  response: Ref<any>
  execute: (options?: HttpOptions) => Promise<any>
  get: (url: string, options?: HttpOptions) => Promise<any>
  post: (url: string, data?: any, options?: HttpOptions) => Promise<any>
  put: (url: string, data?: any, options?: HttpOptions) => Promise<any>
  patch: (url: string, data?: any, options?: HttpOptions) => Promise<any>
  delete: (url: string, options?: HttpOptions) => Promise<any>
  reset: () => void
}

export interface ApiClient {
  list: (uri: string, data?: any, options?: HttpOptions) => Promise<any>
  getById: (uri: string, id: string | number, options?: HttpOptions) => Promise<any>
  get: (uri: string, params?: Record<string, any>, options?: HttpOptions) => Promise<any>
  post: (uri: string, data?: any, options?: HttpOptions) => Promise<any>
  put: (uri: string, data?: any, options?: HttpOptions) => Promise<any>
  create: (uri: string, data?: any, options?: HttpOptions) => Promise<any>
  update: (uri: string, data?: any, options?: HttpOptions) => Promise<any>
  patch: (uri: string, id: string | number, data?: any, options?: HttpOptions) => Promise<any>
  delete: (uri: string, id: string | number, options?: HttpOptions) => Promise<any>
  search: (uri: string, data?: any, options?: HttpOptions) => Promise<any>
}

export declare function useHttp(options?: HttpOptions): HttpReturn

export declare function createApi(basePath: string): ApiClient

export declare const taskApi: ApiClient
export declare const phraseApi: ApiClient
export declare const kefuApi: ApiClient
export declare const userApi: ApiClient
export declare const msgApi: ApiClient
export declare const agentApi: ApiClient
export declare const voteApi: ApiClient
export declare const tipApi: ApiClient
export declare const chatApi: ApiClient
export declare const dwzApi: ApiClient
export declare const giftApi: ApiClient
export declare const wxApi: ApiClient
