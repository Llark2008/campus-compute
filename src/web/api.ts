export interface Api {
  get<T>(path:string,signal?:AbortSignal):Promise<T>;
  post<T>(path:string,body:unknown,signal?:AbortSignal):Promise<T>;
}

interface ErrorEnvelope {
  error?: {code?:string;message?:string;line?:number};
}

export class ApiError extends Error {
  constructor(
    public status:number,
    public code:string,
    message:string,
    public line?:number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApi(token:string):Api {
  async function send<T>(method:"GET"|"POST",path:string,body:unknown,signal?:AbortSignal):Promise<T> {
    if (!path.startsWith("/api/") || path.startsWith("//") || path.includes("\\")) {
      throw new Error("Only platform API paths are allowed");
    }

    let response:Response;
    try {
      response = await fetch(path, {
        method,
        headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
        body:method === "GET" ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new Error("Unable to reach Campus Compute. Check the connection and try again.", {cause:error});
    }

    let data:unknown;
    try {
      data = await response.json();
    } catch {
      if (!response.ok) throw new ApiError(response.status,"UNKNOWN","The server returned an unreadable response.");
      throw new Error("The server returned an unreadable response.");
    }

    if (!response.ok) {
      const envelope = data as ErrorEnvelope;
      throw new ApiError(
        response.status,
        envelope.error?.code ?? "UNKNOWN",
        envelope.error?.message ?? "Request failed",
        envelope.error?.line,
      );
    }
    return data as T;
  }

  return {
    get:<T>(path:string,signal?:AbortSignal)=>send<T>("GET",path,undefined,signal),
    post:<T>(path:string,body:unknown,signal?:AbortSignal)=>send<T>("POST",path,body,signal),
  };
}
