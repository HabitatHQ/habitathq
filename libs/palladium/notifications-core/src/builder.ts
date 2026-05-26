import type {
  ChannelName,
  Notification,
  NotificationAction,
  NotificationResult,
  UrgencyLevel,
} from "./types.js";

export type BuilderSendFn = (
  notification: Notification,
  channels: ReadonlyArray<ChannelName>,
  fallback: ReadonlyArray<ChannelName> | undefined,
) => Promise<NotificationResult>;

export class NotificationBuilder<T = unknown> {
  private _title: string;
  private _id: string | undefined = undefined;
  private _body: string | undefined = undefined;
  private _icon: string | undefined = undefined;
  private _badge: string | undefined = undefined;
  private _image: string | undefined = undefined;
  private _urgency: UrgencyLevel | undefined = undefined;
  private _data: T | undefined = undefined;
  private _actions: NotificationAction[] = [];
  private _deepLink: string | undefined = undefined;
  private _channels: ChannelName[] = [];
  private _fallback: ReadonlyArray<ChannelName> | undefined = undefined;
  private readonly _sendFn: BuilderSendFn;

  constructor(title: string, sendFn: BuilderSendFn) {
    this._title = title;
    this._sendFn = sendFn;
  }

  id(id: string): this {
    this._id = id;
    return this;
  }

  body(body: string): this {
    this._body = body;
    return this;
  }

  icon(icon: string): this {
    this._icon = icon;
    return this;
  }

  badge(badge: string): this {
    this._badge = badge;
    return this;
  }

  image(image: string): this {
    this._image = image;
    return this;
  }

  urgency(urgency: UrgencyLevel): this {
    this._urgency = urgency;
    return this;
  }

  data<U>(data: U): NotificationBuilder<U> {
    const next = new NotificationBuilder<U>(this._title, this._sendFn);
    next._id = this._id;
    next._body = this._body;
    next._icon = this._icon;
    next._badge = this._badge;
    next._image = this._image;
    next._urgency = this._urgency;
    next._actions = [...this._actions];
    next._deepLink = this._deepLink;
    next._channels = [...this._channels];
    next._fallback = this._fallback;
    next._data = data;
    return next;
  }

  withAction(action: NotificationAction): this {
    this._actions = [...this._actions, action];
    return this;
  }

  via(...channels: ChannelName[]): this {
    this._channels = [...this._channels, ...channels];
    return this;
  }

  withFallback(channels: ReadonlyArray<ChannelName>): this {
    this._fallback = channels;
    return this;
  }

  deepLink(url: string): this {
    this._deepLink = url;
    return this;
  }

  toNotification(): Notification<T> {
    return {
      title: this._title,
      ...(this._id !== undefined && { id: this._id }),
      ...(this._body !== undefined && { body: this._body }),
      ...(this._icon !== undefined && { icon: this._icon }),
      ...(this._badge !== undefined && { badge: this._badge }),
      ...(this._image !== undefined && { image: this._image }),
      ...(this._urgency !== undefined && { urgency: this._urgency }),
      ...(this._data !== undefined && { data: this._data }),
      ...(this._actions.length > 0 && { actions: this._actions }),
      ...(this._deepLink !== undefined && { deepLink: this._deepLink }),
    };
  }

  send(): Promise<NotificationResult> {
    return this._sendFn(this.toNotification(), this._channels, this._fallback);
  }
}
