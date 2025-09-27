type TypedEventPartial<T extends EventTarget, U> = {
  readonly currentTarget: T | null;
  readonly type: U;
};

type BaseTypedEvent<T extends EventTarget, E extends Event, U> = E &
  TypedEventPartial<T, U>;

type EventInstanceType<T, O> = T extends abstract new (
  type: string,
  options?: O
) => infer R
  ? R
  : never;

type EventOptionsType<T> = T extends new (
  type: string,
  options?: infer O
) => Event
  ? O
  : never;

export function asTypedEvent<
  const E extends Event,
  const A = EventInit
>(event: { new (type: string, options?: A): E }) {
  return event as {
    new <
      T extends EventTarget,
      const U,
      const O extends EventOptionsType<typeof event>
    >(
      type: U,
      options?: O
    ): BaseTypedEvent<T, EventInstanceType<typeof event, O>, U>;
    prototype: BaseTypedEvent<EventTarget, E, string>;
  };
}

export type TypedEvent<T extends EventTarget, U> = BaseTypedEvent<T, Event, U>;
export const TypedEvent = asTypedEvent(Event);

export type TypedCustomEvent<
  D,
  T extends EventTarget,
  U = string
> = BaseTypedEvent<T, CustomEvent<D>, U>;

export const TypedCustomEvent = CustomEvent as {
  new <const U extends string, const D = undefined>(
    type: U,
    eventInitDict?: CustomEventInit<D>
  ): TypedCustomEvent<D, EventTarget, U>;

  prototype: BaseTypedEvent<EventTarget, CustomEvent<unknown>, string>;
};

interface EmptyEventMap {}

type EventMapValue<
  T extends EmptyEventMap,
  K extends keyof T & string
> = T[K] extends Event ? T[K] : never;

interface EventListener<
  Self extends EventTarget,
  T extends EmptyEventMap,
  EventName extends keyof T
> {
  (this: Self, evt: T[EventName] & TypedEvent<Self, EventName>): void;
}

interface EventListenerObject<
  Self extends EventTarget,
  T extends EmptyEventMap,
  EventName extends keyof T
> {
  handleEvent: EventListener<Self, T, EventName>;
}

type EventListenerArg<
  Self extends EventTarget,
  T extends EmptyEventMap,
  EventName extends keyof T
> =
  | EventListener<Self, T, EventName>
  | EventListenerObject<Self, T, EventName>
  | null;

interface CustomEventTarget<T extends EmptyEventMap> {
  addEventListener<K extends keyof T & string>(
    type: K,
    callback: EventListenerArg<this, T, K>,
    options?: boolean | AddEventListenerOptions
  ): void;

  removeEventListener<K extends keyof T & string>(
    type: K,
    callback: EventListenerArg<this, T, K>,
    options?: boolean | EventListenerOptions
  ): void;

  dispatchEvent<K extends keyof T & string>(
    event: EventMapValue<T, K>
  ): boolean;
}

export const CustomEventTarget = EventTarget as {
  new <T extends EmptyEventMap>(): CustomEventTarget<T>;
  prototype: CustomEventTarget<EmptyEventMap>;
};

export type EventMapOf<T> =
  T extends CustomEventTarget<infer U>
    ? { [K in keyof U]: U[K] & TypedEvent<T, K> }
    : never;
