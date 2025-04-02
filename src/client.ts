/* eslint-disable no-console */
import { jwtDecode } from 'jwt-decode';

import { IOStackAbortHandler } from './client.aborthandler.js';
import type {
  ActiveNodeChangeNotificationHandler,
  ClientConstructorArgs,
  ClientInterface,
  ClientNotificationPacket,
  DebugNoficationHandler,
  DebugNotification,
  ErrorHandler,
  ReferenceNotificationHandler,
  StreamedReferenceNotificationPacket,
  StreamFragmentHandler,
  StreamFragmentPacket,
  StreamingErrorPacket,
  UseCaseActiveNodeChangeNotification,
  UseCaseNoficationHandler,
  UseCaseNotificationPacket,
} from './client.interface.js';

interface Closure {
  refresh_token: string;
  access_token: string;
  access_key: string;
  access_token_refresh_time: Date | null;
  refresh_token_refresh_time: Date | null;
}

export class IOStackClient implements ClientInterface {

  // # ensures the variable is hidden in a JS enclosure and inaccessible to external callers
  #closure: Closure;

  private platform_root: string;
  private use_case_data: Record<string, any>|null|undefined;
  private user_id: string | null | undefined;
  private session_id: string | null;

  private streamFragmentHandlers: StreamFragmentHandler[];
  private errorHandlers: ErrorHandler[];
  private useCaseNotificationHandlers: UseCaseNoficationHandler[];
  private useCaseActiveNodeChangeNotificationHandlers: ActiveNodeChangeNotificationHandler[];
  private useCaseStreamedReferenceNotificationHandlers: ReferenceNotificationHandler[];
  private debugNofificationHandlers: DebugNoficationHandler[];

  private metadata_to_retrieve: string[];

  private decoder: TextDecoder;

  private metadata: Record<string, any> | null;

  private runningBuffer: string = ""

  private constructor({
    access_key,
    use_case_data,
    user_id,
    platform_root,
    streamFragmentHandlers,
    errorHandlers,
    useCaseNotificationHandlers,
    activeNodeChangeNotificationHandlers: useCaseActiveNodeChangeNotificationHandlers,
    referenceNotificationHandlers: useCaseStreamedReferenceNotificationHandlers,
    debugNotificationHandlers
  }: ClientConstructorArgs) {

    this.platform_root = platform_root || 'https://platform.iostack.ai';
    this.use_case_data = use_case_data;
    this.user_id = user_id;
    this.session_id = null;
    this.streamFragmentHandlers = streamFragmentHandlers;
    this.errorHandlers = errorHandlers;
    this.useCaseNotificationHandlers = useCaseNotificationHandlers || [];
    this.useCaseActiveNodeChangeNotificationHandlers = useCaseActiveNodeChangeNotificationHandlers || [];
    this.useCaseStreamedReferenceNotificationHandlers = useCaseStreamedReferenceNotificationHandlers || [];
    this.debugNofificationHandlers = debugNotificationHandlers || [];
    this.metadata_to_retrieve = ['trigger_phrase'];
    this.decoder = new TextDecoder();
    this.metadata = null;
    this.runningBuffer = "";


    // Set up a closure for sensitive data
    this.#closure = {
      refresh_token: '',
      access_token: '',
      access_key,
      access_token_refresh_time: new Date(0),
      refresh_token_refresh_time: new Date(0),
    };
  }

  public static newClient(args: ClientConstructorArgs): ClientInterface {
    return new IOStackClient(args);
  }

  public getSessionId(): string | null {
    return this.session_id;
  }

  public deregisterAllHandlers(): void {
    this.streamFragmentHandlers = [];
    this.errorHandlers = [];
    this.useCaseNotificationHandlers = [];
    this.useCaseActiveNodeChangeNotificationHandlers = [];
    this.useCaseStreamedReferenceNotificationHandlers = [];
    this.debugNofificationHandlers = [];
  }

  public async startSession(sessionId: string | undefined = undefined) {
    if (sessionId) {
      this.session_id = sessionId;
    } else {
      await this.establishSession();
    }
    await this.retrieveAccessToken();
    if (this.metadata_to_retrieve.length > 0) {
      await this.retrieveUseCaseMetaData();
    }
    console.log(`Sending initial trigger phrase: ${this.metadata?.trigger_phrase || '-'}`);
    await this.sendMessage(this.metadata?.trigger_phrase || '-'); // Send blank input to trigger first response
  }

  public setSessionDetails(sessionId: string, userId: string): void {
    this.session_id = sessionId;
    this.user_id = userId;
  }

  public async sendMessage(message: string): Promise<void> {
    if (!message) {
      return;
    }

    if (!this.session_id) {
      // eslint-disable-next-line sonarjs/no-duplicate-string
      this.reportErrorString('Error sending message', 'Session has not yet been established');
      return;
    }

    const headers = await this.getHeaders();

    const postBody = {
      message,
    };

    const abortHandler = new IOStackAbortHandler(60 * 1000);

    this.runningBuffer = "";

    try {
      const response: Response = await fetch(`${this.platform_root}/v1/use_case/session/${this.session_id}/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(postBody),
        signal: abortHandler.getSignal(),
      });

      if (!response.ok || !response.body) {
        const error = await this.reportError(response);
        throw new Error(error);
      }

      const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();

      const lambda = async (message: ReadableStreamReadResult<Uint8Array>): Promise<void> => {

        const streamedResponsesString = this.decoder.decode(message.value, { stream: true });

        try {
          await this.processMessage(streamedResponsesString);
        }
        catch (e: any) {
          this.reportErrorString('Error while decoding streaming response', e.toString())
          throw e
        }

        if (message.done) {
          return;
        }

        return reader.read().then(lambda);

      };

      await reader.read().then(lambda);

    } catch (e: any) {
      this.reportErrorString('Error while streaming response', e.toString());
      throw e;
    } finally {
      abortHandler.reset();
    }
  }

  private async getHeaders(): Promise<Headers> {
    if (this.refreshTokenExpired()) {
      await this.refreshRefreshToken();
    }

    if (this.accessTokenExpired()) {
      await this.refreshAccessToken();
    }

    const headers = new Headers();

    // eslint-disable-next-line sonarjs/no-duplicate-string
    headers.append('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${this.getAccessToken()}`);

    return headers;
  }

  private async processMessage(streamedResponsesString: string): Promise<void> {

    this.runningBuffer += streamedResponsesString

    let delimIndex = this.runningBuffer.indexOf('__|__')
    while (delimIndex != -1) {
      await this.handleStreamingResponse(this.runningBuffer.slice(0, delimIndex))
      this.runningBuffer = this.runningBuffer.substring(delimIndex + '__|__'.length)
      delimIndex = this.runningBuffer.indexOf('__|__')
    }

  }

  private async handleStreamingResponse(streamedResponseString: string): Promise<void> {
    if (!streamedResponseString) return;

    const streamedResponse: ClientNotificationPacket = JSON.parse(streamedResponseString);

    switch (streamedResponse.type) {
      case 'fragment':
        await this.onStreamedFragment(streamedResponse as StreamFragmentPacket);
        break;

      case 'error':
        await this.onError((streamedResponse as StreamingErrorPacket).error);
        throw new Error((streamedResponse as StreamingErrorPacket).error);
      // break;

      case 'llm_stats':
        break;

      case 'use_case_notification':
        await this.handleUseCaseNotification(streamedResponse as UseCaseNotificationPacket);
        break;

      case 'streamed_ref':
        await this.onStreamedReference(streamedResponse as StreamedReferenceNotificationPacket);
        break;

      case "debug":
        await this.onDebugNotification(streamedResponse as DebugNotification);
        break;

      default:
        console.log(`Unknown streaming packet seen:\n${JSON.stringify(streamedResponse, null, 2)}`);
    }
  }

  private async handleUseCaseNotification(result: UseCaseNotificationPacket): Promise<void> {
    // eslint-disable-next-line sonarjs/no-small-switch
    switch (result.name) {
      case 'graph_active_node_change':
        await this.onActiveNodeChange(result as unknown as UseCaseActiveNodeChangeNotification);
        break;

      default:
        await this.onUseCaseNotification(result);
    }
  }

  private async establishSession(): Promise<void> {
    console.log('Establishing session');

    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${this.getAccessKey()}`);

    const postBody = {
      use_case_id: this.getAccessKey(),
      client_data: this.use_case_data,
      user_id: this.user_id,
    };

    const url = `${this.platform_root}/v1/use_case/session`;

    const abortHandler = new IOStackAbortHandler(30 * 1000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(postBody),
        signal: abortHandler.getSignal(),
      });

      if (!response.ok) {
        const error = await this.reportError(response);
        throw new Error(error);
      }

      const body = await response.json();
      this.updateRefreshToken(body.refresh_token);
      this.session_id = body.session_id;
    } catch (e: any) {
      this.reportErrorString('Error while establishing response', e.toString());
      throw e;
    } finally {
      abortHandler.reset();
    }
  }

  private async retrieveAccessToken(): Promise<void> {
    console.log(`Retrieving access token for session ${this.session_id}`);

    if (!this.session_id) {
      this.reportErrorString('Error retrieving access token', 'Session has not yet been established');
      return;
    }

    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${this.getRefreshToken()}`);

    const abortHandler = new IOStackAbortHandler(30 * 1000);

    try {
      const response = await fetch(`${this.platform_root}/v1/use_case/session/${this.session_id}/access_token`, {
        method: 'POST',
        headers,
        body: '{}',
        signal: abortHandler.getSignal(),
      });

      if (!response.ok) {
        const error = await this.reportError(response);
        throw new Error(error);
      }

      const body = await response.json();

      this.setAccessToken(body.access_token);
      this.calcAndSaveAccessTokenRefreshTime(body.access_token);
    } catch (e: any) {
      this.reportErrorString('Error while retrieving access token', e.toString());
      throw e;
    } finally {
      abortHandler.reset();
    }
  }

  private async refreshAccessToken(): Promise<void> {
    console.log(`Refreshing access token for session ${this.session_id}`);

    if (!this.session_id) {
      this.reportErrorString('Error refreshing access token', 'Session has not yet been established');
      return;
    }

    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${this.getRefreshToken()}`);

    const abortHandler = new IOStackAbortHandler(30 * 1000);

    try {
      const response = await fetch(`${this.platform_root}/v1/use_case/session/${this.session_id}/access_token`, {
        method: 'POST',
        headers,
        body: '{}',
        signal: abortHandler.getSignal(),
      });

      if (!response.ok) {
        const error = await this.reportError(response);
        throw new Error(error);
      }

      const body = await response.json();

      this.setAccessToken(body.access_token);
      this.calcAndSaveAccessTokenRefreshTime(body.access_token);
    } catch (e: any) {
      this.reportErrorString('Error while refreshing access token', e.toString());
      throw e;
    } finally {
      abortHandler.reset();
    }
  }

  private async refreshRefreshToken(): Promise<void> {
    console.log(`Refreshing refresh token for session ${this.session_id}`);

    if (!this.session_id) {
      this.reportErrorString('Error refreshing refresh token', 'Session has not yet been established');
      return;
    }

    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${this.getAccessKey()}`);

    const postBody = {
      use_case_id: this.getAccessKey(),
      client_data: this.use_case_data,
    };

    const url = `${this.platform_root}/v1/use_case/session/${this.session_id}/refresh_token`;

    const abortHandler = new IOStackAbortHandler(30 * 1000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(postBody),
        signal: abortHandler.getSignal(),
      });

      if (!response.ok) {
        const error = await this.reportError(response);
        throw new Error(error);
      }

      const body = await response.json();
      this.setRefreshToken(body.refresh_token);
    } catch (e: any) {
      this.reportErrorString('Error while refreshing session refresh token', e.toString());
      throw e;
    } finally {
      abortHandler.reset();
    }
  }

  private async retrieveUseCaseMetaData(): Promise<void> {
    console.log('Fetching use case metadata');

    const headers = await this.getHeaders();

    const abortHandler = new IOStackAbortHandler(30 * 1000);

    let url = `${this.platform_root}/v1/use_case/meta`;
    if (this.metadata_to_retrieve.length > 0) url = `${url}?details=${this.metadata_to_retrieve.join('&details=')}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: abortHandler.getSignal(),
      });

      if (!response.ok) {
        const error = await this.reportError(response);
        throw new Error(error);
      }

      const body = await response.json();

      this.metadata = body.use_case;
    } catch (e: any) {
      this.reportErrorString('Error while retrieving use case metadata', e.toString());
      throw e;
    } finally {
      abortHandler.reset();
    }
  }

  private calcAndSaveAccessTokenRefreshTime(access_token: string): void {
    const decoded = jwtDecode(access_token);
    if (!decoded.exp) {
      throw new Error('Access Token JWT missing exp claim');
    }
    const expiryTime = new Date(decoded.exp * 1000);
    const now = Date.now();
    const refresh_access_token_period = Math.floor((expiryTime.getTime() - now) * 0.7);
    const refreshTime = new Date(now + refresh_access_token_period);
    this.setAccessTokenRefreshTime(refreshTime);
  }

  private calcAndSaveRefreshTokenRefreshTime(refresh_token: string): void {
    const decoded = jwtDecode(refresh_token);
    if (!decoded.exp) {
      throw new Error('Refresh Token JWT missing exp claim');
    }
    const expiryTime = new Date(decoded.exp * 1000);
    const now = Date.now();
    const refresh_refresh_token_period = Math.floor((expiryTime.getTime() - now) * 0.7);
    const refreshTime = new Date(now + refresh_refresh_token_period);
    this.setRefreshTokenRefreshTime(refreshTime);
  }

  private async onStreamedFragment(fragment: StreamFragmentPacket): Promise<void> {
    this.streamFragmentHandlers.forEach(async (h) => {
      // As the returned fragments are json encoded, any single quotes are explicitly escaped - this removes the escaping backslash
      fragment.fragment = fragment.fragment.replaceAll("\\'", "'")
      await h(fragment);
    });
  }

  private async onError(error: string): Promise<void> {
    this.errorHandlers.forEach(async (h) => {
      await h(error);
    });
  }

  private async onUseCaseNotification(notification: UseCaseNotificationPacket): Promise<void> {
    this.useCaseNotificationHandlers.forEach(async (h) => {
      await h(notification);
    });
  }

  private async onStreamedReference(notification: StreamedReferenceNotificationPacket): Promise<void> {
    this.useCaseStreamedReferenceNotificationHandlers.forEach(async (h) => {
      await h(notification);
    });
  }

  private async onActiveNodeChange(notification: UseCaseActiveNodeChangeNotification): Promise<void> {
    this.useCaseActiveNodeChangeNotificationHandlers.forEach(async (h) => {
      await h(notification);
    });
  }

  private async onDebugNotification(notification: DebugNotification): Promise<void> {
    this.debugNofificationHandlers.forEach(async (h) => {
      await h(notification);
    });
  }


  private async reportError(response: Response): Promise<string> {
    const error = await response.json();
    const errorText = `${response.statusText}:${error.message || error.detail}`;
    await this.onError(errorText);
    return errorText;
  }

  private async reportErrorString(error: string, message: string): Promise<void> {
    await this.onError(`${error} - ${message}`);
    // throw new Error(`${error} - ${message}`);
  }

  private setRefreshToken(i: string) {
    this.#closure.refresh_token = i;
  }

  private getRefreshToken() {
    return this.#closure.refresh_token;
  }

  private setAccessToken(i: string) {
    this.#closure.access_token = i;
  }

  private getAccessToken() {
    return this.#closure.access_token;
  }

  private getAccessKey() {
    return this.#closure.access_key;
  }

  private setAccessTokenRefreshTime(i: Date) {
    this.#closure.access_token_refresh_time = i;
  }

  private accessTokenExpired(): boolean {
    return !!this.#closure.access_token_refresh_time && new Date(Date.now()) >= this.#closure.access_token_refresh_time;
  }

  private setRefreshTokenRefreshTime(i: Date) {
    this.#closure.refresh_token_refresh_time = i;
  }

  private refreshTokenExpired(): boolean {
    return (
      !!this.#closure.refresh_token_refresh_time && new Date(Date.now()) >= this.#closure.refresh_token_refresh_time
    );
  }

  private updateRefreshToken(i: string): void {
    this.setRefreshToken(i);
    this.calcAndSaveRefreshTokenRefreshTime(i);
  }
}
