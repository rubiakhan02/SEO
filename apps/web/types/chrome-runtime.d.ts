export {};

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage?: (
          extensionId: string,
          message: unknown,
          responseCallback?: (response: unknown) => void,
        ) => void;
        lastError?: {
          message?: string;
        };
      };
    };
  }
}
