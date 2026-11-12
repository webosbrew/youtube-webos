export function attachElementShim(el, timeMap, { onRateRequest }) {
  if (timeMap.speed === 1) return { detach: () => {}, isAttached: () => false };

  const originals = {};

  const defineProp = (prop, get, set) => {
    let proto = el;
    let desc;
    while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, prop))) {
      proto = Object.getPrototypeOf(proto);
    }
    if (desc) {
      originals[prop] = desc;
      const newDesc = {
        configurable: true,
        enumerable: true,
        get: get
          ? function () {
              return get.call(this, desc.get);
            }
          : function () {
              return desc.get.call(this);
            }
      };
      if (set) {
        newDesc.set = function (val) {
          set.call(this, val, desc.set);
        };
      }
      Object.defineProperty(el, prop, newDesc);
    }
  };

  const mapRanges = (ranges) => ({
    length: ranges.length,
    start: (i) => timeMap.toContent(ranges.start(i)),
    end: (i) => timeMap.toContent(ranges.end(i))
  });

  defineProp(
    'currentTime',
    function (origGet) {
      return timeMap.toContent(origGet.call(this));
    },
    function (val, origSet) {
      origSet.call(this, timeMap.toElement(val));
    }
  );

  defineProp('duration', function (origGet) {
    const d = origGet.call(this);
    return isNaN(d) ? d : timeMap.toContent(d);
  });

  defineProp('buffered', function (origGet) {
    return mapRanges(origGet.call(this));
  });

  defineProp('seekable', function (origGet) {
    return mapRanges(origGet.call(this));
  });

  defineProp(
    'playbackRate',
    function () {
      return timeMap.speed;
    },
    function (val, _origSet) {
      if (onRateRequest) onRateRequest(val);
    }
  );

  const initialSrc = el.src;

  defineProp('src', null, function (val, origSet) {
    origSet.call(this, val);
    if (val !== initialSrc) {
      detach();
    }
  });

  let detached = false;
  function detach() {
    if (detached) return;
    detached = true;
    for (const prop of Object.keys(originals)) {
      // Actually we just delete the own properties to fallback to prototype chain
      delete el[prop];
    }
  }

  return { detach, isAttached: () => !detached };
}
