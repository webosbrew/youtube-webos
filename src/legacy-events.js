// webOS 1/2 expose DOM event objects without constructible DOM interfaces.
if (!Element.prototype.matches && Element.prototype.webkitMatchesSelector) {
  Element.prototype.matches = Element.prototype.webkitMatchesSelector;
}

// Keep working native constructors, including on newer webOS versions.
try {
  new window.CustomEvent('ytaf-compat-check');
} catch {
  const LegacyCustomEvent = function (type, options) {
    const event = document.createEvent('CustomEvent');
    const init = options || {};
    event.initCustomEvent(type, !!init.bubbles, !!init.cancelable, init.detail);
    return event;
  };
  LegacyCustomEvent.prototype = window.Event.prototype;
  window.CustomEvent = LegacyCustomEvent;
}

try {
  new window.EventTarget();
} catch {
  const LegacyEventTarget = function () {
    this.__eventTarget = document.createDocumentFragment();
    this.__eventListeners = [];
  };
  LegacyEventTarget.prototype.addEventListener = function (
    type,
    listener,
    options
  ) {
    if (!listener) return;
    const capture =
      typeof options === 'boolean' ? options : !!(options && options.capture);
    const records = this.__eventListeners;
    if (
      records.some(
        (r) =>
          r.type === type && r.listener === listener && r.capture === capture
      )
    )
      return;
    const target = this;
    const wrapped = function (event) {
      if (typeof listener === 'function') listener.call(target, event);
      else listener.handleEvent(event);
    };
    records.push({ type, listener, capture, wrapped });
    this.__eventTarget.addEventListener(type, wrapped, capture);
  };
  LegacyEventTarget.prototype.removeEventListener = function (
    type,
    listener,
    options
  ) {
    const capture =
      typeof options === 'boolean' ? options : !!(options && options.capture);
    const records = this.__eventListeners;
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i];
      if (
        record.type === type &&
        record.listener === listener &&
        record.capture === capture
      ) {
        this.__eventTarget.removeEventListener(type, record.wrapped, capture);
        records.splice(i, 1);
      }
    }
  };
  LegacyEventTarget.prototype.dispatchEvent = function (event) {
    return this.__eventTarget.dispatchEvent(event);
  };
  window.EventTarget = LegacyEventTarget;
}

export {};
