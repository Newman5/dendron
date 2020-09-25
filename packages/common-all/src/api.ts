import _ from "lodash";
import request from "request-promise";
import { createLogger } from "./logger";
// import { nonEmptyGet, unwrapGet, unwrapSearch } from "./es";
// import { L } from "./logger";
// import { PlainNode } from "./nodev2";
// import {
//   IQPResultV2,
//   IDendronTreeItemV2,
//   IDendronTreeItemMetaV2,
//   IDendronESItemV2
// } from "./typesv2";
const L = createLogger("api");

// === Types

export type APIErrorType =
  | "does_not_exist_error"
  | "not_authorized_error"
  | "unknown_error"
  | "invalid_request_error";

export interface IAPIErrorArgs {
  type: APIErrorType;
  message?: string;
  code?: number;
}

interface IRequestArgs {
  headers: any;
}

interface IAPIPayload {
  data: null | any | any[];
  error: null | APIError;
}

interface IAPIOpts {
  endpoint: string;
  apiPath: string;
  _request: any;
  logger: any;
  statusHandlers: any;
  onAuth: (opts: IRequestArgs) => Promise<any>;
  onBuildHeaders: ({}: IRequestArgs) => Promise<any>;
  onError: ({}: {
    err: APIError;
    body: any;
    resp: any;
    headers: any;
    qs: any;
    path: string;
    method: string;
  }) => any;
}

type IAPIConstructor = {
  endpoint: string;
  apiPath: string;
} & Partial<IAPIOpts>;

interface IDoRequestArgs {
  path: string;
  auth?: boolean;
  qs?: any;
  body?: any;
  method?: "get" | "post";
  json?: boolean;
}

interface IStatusHandler {
  resp: any;
}

type APIPayload<T = any> = {
  error: APIError | null;
  data: T;
};

type InitializePayload = APIPayload<any>;

// === Utilities

export class APIError {
  public type: APIErrorType;
  public message?: string;
  public code?: number;

  constructor({ type, message, code }: IAPIErrorArgs) {
    this.type = type;
    this.message = message || "";
    this.code = code || -1;
  }
}

const STATUS_HANDLERS = {
  401: {
    isErr: true,
    handler: ({ resp }: IStatusHandler) =>
      new APIError({ type: "not_authorized_error", code: resp.statusCode }),
  },
  404: {
    isErr: true,
    handler: ({ resp }: IStatusHandler) =>
      new APIError({ code: resp.statusCode, type: "does_not_exist_error" }),
  },
  502: {
    isErr: true,
    handler: ({ resp }: IStatusHandler) =>
      new APIError({ code: resp.statusCode, type: "unknown_error" }),
  },
};

type WorkspaceInitRequest = {
  uri: string;
  config: any;
};

// === Base

export abstract class API {
  public opts: IAPIOpts;

  constructor(opts: IAPIConstructor) {
    opts = _.defaults(opts, {
      _request: request,
      logger: L,
      statusHandlers: {},
      onAuth: async ({ headers }: IRequestArgs): Promise<any> => headers,
      onBuildHeaders: ({ headers }: IRequestArgs): Promise<any> => headers,
    });

    this.opts = opts as IAPIOpts;
  }

  _log(msg: any, lvl: "info" | "debug" | "error" | "fatal" = "info") {
    this.opts.logger[lvl](msg);
  }

  _createPayload(data: any) {
    return {
      error: null,
      data,
    };
  }

  async _doRequest({
    auth = false,
    qs = {},
    path,
    body = {},
    method = "get",
    json = true,
  }: IDoRequestArgs) {
    let headers = {};
    const { _request, onAuth, onBuildHeaders, endpoint, apiPath } = this.opts;
    if (auth) {
      headers = await onAuth({ headers });
    }
    headers = await onBuildHeaders({ headers });
    const requestParams = {
      url: [endpoint, apiPath, path].join("/"),
      qs,
      body,
      json,
      ...headers,
    };
    this._log({ ctx: "pre-request", requestParams }, "debug");
    return _request[method](
      requestParams,
      async (err: any, resp: any, respBody: any) => {
        const { statusHandlers, onError } = this.opts;
        let foundError: boolean = false;
        // tslint:disable-next-line: no-shadowed-variable
        let respHandler = ({ resp }: IStatusHandler) => {
          const out = resp;
          return out;
        };

        // check if we have a handler based on return code
        if (
          _.has(_.defaults(statusHandlers, STATUS_HANDLERS), resp.statusCode)
        ) {
          const { statusCode } = resp;
          this._log({
            ctx: "post-request",
            msg: "use statusHandler",
            statusCode,
          });
          const { isErr, handler } = statusHandlers[resp.statusCode];
          respHandler = handler;
          if (isErr) {
            foundError = true;
          }
        }

        // log error if we have on
        if (foundError) {
          this._log({ ctx: "post-request-foundError", err });
          onError({
            headers,
            qs,
            path,
            method,
            err,
            body: respBody,
            resp,
          });
        }

        // trigger handler
        this._log({ ctx: "post-request-exit", resp, respHandler }, "debug");
        return respHandler({ resp });
      }
    );
  }

  async _makeRequest<T extends IAPIPayload>(
    args: IDoRequestArgs,
    paylaodData?: T["data"]
  ): Promise<T> {
    const payload = this._createPayload(paylaodData) as T;
    try {
      const resp = await this._doRequest(args);
      payload.data = resp;
    } catch (err) {
      payload.error = err;
    }
    return payload;
  }
}

// === DendronAPI

export abstract class DendronAPI extends API {
  static instance: DendronAPI;

  // TODO
  // async nodeGetRoot(): Promise<INodeGetPayload> {
  //   const payload = this._createPayload<INodeGetPayload>();
  //   // TODO: actual implementation
  //   payload.data = {
  //     children: [
  //       {
  //         id: "aws",
  //         tags: [],
  //         title: "aws"
  //       }
  //     ],
  //     id: "0",
  //     meta: {},
  //     parents: [],
  //     tags: [],
  //     title: "__root",
  //     body: "",
  //     attribution: []
  //   };
  //   return payload;
  // }

  async initialize(req: WorkspaceInitRequest): Promise<InitializePayload> {
    const resp = this._makeRequest({
      path: "schema/qp",
      method: "post",
      body: {
        ...req,
      },
    });
    return this._createPayload(resp);
  }

  //   async nodeGet(id: string): Promise<INodeGetPayload> {
  //     const resp = await this._doRequest({ path: `node/${id}` });
  //     const payload = this._createPayload<INodeGetPayload>();
  //     if (nonEmptyGet(resp)) {
  //       payload.data = PlainNode.fromESItem(unwrapGet(resp));
  //     } else {
  //       payload.error = new APIError({ type: "does_not_exist_error" });
  //     }
  //     return payload;
  //   }

  //   async nodeGetMulti(ids: string[]): Promise<INodeGetMultiPayload> {
  //     const resp = await this._doRequest({ path: `node/multi/${ids.join(",")}` });
  //     const payload = this._createPayload<INodeGetMultiPayload>();
  //     payload.data = unwrapSearch(resp.body) as any;
  //     return payload;
  //   }

  //   async schemaGet({ schemaDomain }: ISchemaGetAPI): Promise<ISchemaGetPayload> {
  //     return this._makeRequest({
  //       path: "schema/qp",
  //       method: "post",
  //       body: {
  //         schemaDomain
  //       }
  //     });
  //   }

  //   async suggestGetQP({ qp }: IAPIGetNodeByQP): Promise<IAPIGetNodeByQPPayload> {
  //     const payload: IAPIGetNodeByQPPayload = this._createPayload();
  //     try {
  //       const resp = await this._doRequest({
  //         path: `suggestion/qp`,
  //         method: "post",
  //         body: {
  //           qp
  //         }
  //       });
  //       payload.data = resp;
  //     } catch (err) {
  //       payload.error = err;
  //     }
  //     return payload;
  //   }
}
