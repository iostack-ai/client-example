export abstract class ClientInterface {
  public abstract getSessionId(): string | null;
  public abstract setSessionDetails(sessionId: string, userId: string): void;
  public abstract deregisterAllHandlers(): void;
  public abstract startSession(sessionId?: string | undefined): Promise<void>;
  public abstract sendMessage(message: string): Promise<void>;
}

export interface ClientConstructorArgs {
  
  access_key: string;
  use_case_data?: Record<string, any> | undefined;
  user_id?: string | undefined;
  platform_root?: string | undefined;

  streamFragmentHandlers: StreamFragmentHandler[];
  errorHandlers: ErrorHandler[];
  useCaseNotificationHandlers?: UseCaseNoficationHandler[] | undefined;
  activeNodeChangeNotificationHandlers?: ActiveNodeChangeNotificationHandler[] | undefined;
  referenceNotificationHandlers?: ReferenceNotificationHandler[] | undefined;
  debugNotificationHandlers?: DebugNoficationHandler[] | undefined;

}

export interface ClientNotificationPacket {
  type: string;
}

export interface StreamFragmentPacket extends ClientNotificationPacket {
  fragment: string;
  final: boolean;
}

export interface StreamedReferenceNotificationPacket extends ClientNotificationPacket {
  value: Record<string, any>;
}

export interface UseCaseNotificationPacket extends ClientNotificationPacket {
  name: string;
}

export interface SessionStateUpdateNotificationPacket extends UseCaseNotificationPacket {
  data: Record<string, any>;
}

export interface UseCaseActiveNodeChangePayload {
  active_node: string;
  active_node_code: string;
  assembly?: Record<string, any> | undefined;
}

export interface UseCaseActiveNodeChangeNotification extends ClientNotificationPacket {
  data: UseCaseActiveNodeChangePayload;
}

export interface StreamingErrorPacket extends ClientNotificationPacket {
  error: string;
  message: string;
}

export interface  DebugNotification extends SessionStateUpdateNotificationPacket {}

export type StreamFragmentHandler = (fragment: StreamFragmentPacket) => Promise<void>;
export type ErrorHandler = (error: string) => Promise<void>;

export type UseCaseNoficationHandler = (notification: UseCaseNotificationPacket) => Promise<void>;
export type ActiveNodeChangeNotificationHandler = (notification: UseCaseActiveNodeChangeNotification) => Promise<void>;
export type ReferenceNotificationHandler = (notification: StreamedReferenceNotificationPacket) => Promise<void>;
export type DebugNoficationHandler = (notification: DebugNotification) => Promise<void>;

export interface RuntimeOptions<V = string> {
  inference_server_url: string;
  access_key: V;
}

export type AnyVerify = Partial<string>;

export const isAuthedRuntimeOptions = (options: RuntimeOptions<AnyVerify>): options is RuntimeOptions<string> => {
  return typeof options?.access_key === 'string';
};
