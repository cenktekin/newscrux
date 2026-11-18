// src/notifiers/types.ts

export interface Notifier {
  readonly name: string;
  /**
   * Delivers one notification. `message` is Pushover-style HTML (see
   * `renderNotification`); each adapter is responsible for translating it to
   * its own transport format.
   */
  send(title: string, message: string, url?: string, urlTitle?: string): Promise<boolean>;
}
