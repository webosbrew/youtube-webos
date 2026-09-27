/**
 * Streaming WSOLA time-stretcher: changes tempo while keeping pitch.
 * Plain overlap-add would repeat or drop half-periods and sound rough; WSOLA
 * picks, within a small search window, the input frame best aligned with the
 * natural continuation of the previous one.
 * Note: switching between speed 1 (exact bypass) and another speed restarts the
 * frame sequence and may click; the player resets the stretcher on speed changes.
 */
export class WsolaStretcher {
  constructor({
    sampleRate,
    channels,
    frameMs = 46,
    searchMs = 12,
    searchStep = 1,
    corrStep = 1
  }) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.speed = 1;
    this.searchStep = searchStep;
    this.corrStep = corrStep;

    // Ensure W is even for exact 50% overlap
    this.W = Math.round((frameMs * sampleRate) / 1000);
    if (this.W % 2 !== 0) this.W++;

    this.Hs = this.W / 2;
    this.S = Math.round((searchMs * sampleRate) / 1000);

    this.window = new Float32Array(this.W);
    for (let i = 0; i < this.W; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.W - 1)));
    }

    this.inBuffer = Array.from(
      { length: channels },
      () => new Float32Array(this.W * 4)
    );
    this.inLen = 0; // Number of valid samples in inBuffer

    this.outBuffer = Array.from(
      { length: channels },
      () => new Float32Array(this.W * 4)
    );
    this.outLen = 0; // Number of generated samples in outBuffer (including overlapping parts)

    // outReadPos is how many completely finished samples we've produced and are ready to be pulled
    // Samples are completely finished up to outLen - Hs (because the last Hs samples are waiting for overlap)
    this.outReadPos = 0;

    this.idealInputPos = 0;

    this.lastChosenStart = 0; // t_{k-1}
    this.isFirstFrame = true;
  }

  setSpeed(s) {
    this.speed = s;
  }

  _ensureInCapacity(required) {
    if (this.inBuffer[0].length >= required) return;
    let newCap = this.inBuffer[0].length;
    while (newCap < required) newCap *= 2;
    for (let c = 0; c < this.channels; c++) {
      const nb = new Float32Array(newCap);
      nb.set(this.inBuffer[c]);
      this.inBuffer[c] = nb;
    }
  }

  _ensureOutCapacity(required) {
    if (this.outBuffer[0].length >= required) return;
    let newCap = this.outBuffer[0].length;
    while (newCap < required) newCap *= 2;
    for (let c = 0; c < this.channels; c++) {
      const nb = new Float32Array(newCap);
      nb.set(this.outBuffer[c]);
      this.outBuffer[c] = nb;
    }
  }

  push(channelArrays) {
    const len = channelArrays[0].length;
    this._ensureInCapacity(this.inLen + len);
    for (let c = 0; c < this.channels; c++) {
      this.inBuffer[c].set(channelArrays[c], this.inLen);
    }
    this.inLen += len;

    if (this.speed === 1) {
      this._ensureOutCapacity(this.outLen + len);
      for (let c = 0; c < this.channels; c++) {
        this.outBuffer[c].set(channelArrays[c], this.outLen);
      }
      this.outLen += len;

      this.inLen = 0;
      this.idealInputPos = 0;
      this.lastChosenStart = 0;
      this.isFirstFrame = true;
      return;
    }

    this._process();
  }

  _process() {
    if (this.speed === 1) return; // Handled in push/bypass

    while (true) {
      const minRequired =
        Math.floor(this.idealInputPos) + Math.floor(this.S / 2) + this.W;
      if (this.inLen < minRequired) break;

      // A frame writes W samples from outLen: typed arrays silently drop writes
      // past their end, so the capacity must cover the whole frame, not Hs.
      this._ensureOutCapacity(this.outLen + this.W);

      if (this.isFirstFrame) {
        const start = Math.floor(this.idealInputPos);
        for (let c = 0; c < this.channels; c++) {
          const ib = this.inBuffer[c];
          const ob = this.outBuffer[c];
          for (let i = 0; i < this.W; i++) {
            // No OLA for the first half of the first frame, but we just copy with window
            ob[this.outLen + i] = ib[start + i] * this.window[i];
          }
        }
        this.lastChosenStart = start;
        this.outLen += this.Hs;
        this.idealInputPos += this.Hs * this.speed;
        this.isFirstFrame = false;
        continue;
      }

      const target = this.lastChosenStart + this.Hs;
      const searchCenter = Math.floor(this.idealInputPos);
      let searchStart = searchCenter - Math.floor(this.S / 2);
      let searchEnd = searchCenter + Math.floor(this.S / 2);

      if (searchStart < 0) searchStart = 0;
      if (searchEnd + this.W > this.inLen) searchEnd = this.inLen - this.W;

      let bestOffset = searchStart;
      let maxCorr = -Infinity;

      const targetBuf = this.inBuffer[0];
      const searchBuf = this.inBuffer[0];

      for (
        let offset = searchStart;
        offset <= searchEnd;
        offset += this.searchStep
      ) {
        let corr = 0;
        for (let i = 0; i < this.Hs; i += this.corrStep) {
          corr += targetBuf[target + i] * searchBuf[offset + i];
        }
        if (corr > maxCorr) {
          maxCorr = corr;
          bestOffset = offset;
        }
      }

      this.lastChosenStart = bestOffset;

      for (let c = 0; c < this.channels; c++) {
        const ib = this.inBuffer[c];
        const ob = this.outBuffer[c];
        for (let i = 0; i < this.W; i++) {
          ob[this.outLen + i] += ib[bestOffset + i] * this.window[i];
        }
      }

      this.outLen += this.Hs;
      this.idealInputPos += this.Hs * this.speed;

      // Shift inBuffer if we have processed far enough
      const maxKeepStart = Math.min(
        this.lastChosenStart,
        Math.floor(this.idealInputPos - this.S / 2)
      );
      if (maxKeepStart > this.W) {
        const shift = maxKeepStart - this.W;
        for (let c = 0; c < this.channels; c++) {
          this.inBuffer[c].copyWithin(0, shift, this.inLen);
        }
        this.inLen -= shift;
        this.idealInputPos -= shift;
        this.lastChosenStart -= shift;
      }
    }
  }

  available() {
    if (this.speed === 1) {
      return this.outLen - this.outReadPos;
    }
    // The last Hs samples still wait for the next frame's overlap-add.
    const ready = this.outLen - this.Hs;
    return Math.max(0, ready - this.outReadPos);
  }

  pull(n) {
    if (n <= 0) {
      return Array.from({ length: this.channels }, () => new Float32Array(0));
    }
    const avail = this.available();
    const toPull = Math.min(n, avail);
    const out = [];
    for (let c = 0; c < this.channels; c++) {
      out.push(
        this.outBuffer[c].slice(this.outReadPos, this.outReadPos + toPull)
      );
    }
    this.outReadPos += toPull;

    // Shift outBuffer if outReadPos is large. The Hs samples after outLen hold
    // the pending half of the last frame (still waiting for its overlap-add), so
    // they move too; everything after them must be zeroed, or the next frames
    // would be overlap-added onto stale samples.
    if (this.outReadPos > this.W * 4) {
      const shift = this.outReadPos;
      const validEnd = Math.min(
        this.outLen + this.Hs,
        this.outBuffer[0].length
      );
      for (let c = 0; c < this.channels; c++) {
        this.outBuffer[c].copyWithin(0, shift, validEnd);
        this.outBuffer[c].fill(0, validEnd - shift);
      }
      this.outLen -= shift;
      this.outReadPos = 0;
    }

    return out;
  }

  flush() {
    if (this.speed === 1) return;

    // Pad with zeros so every real input sample goes through a full overlap-add;
    // the tail therefore ends with a short stretch of silence.
    const padLen = this.S + this.W;
    this.push(
      Array.from({ length: this.channels }, () => new Float32Array(padLen))
    );
  }

  reset() {
    this.inLen = 0;
    this.outLen = 0;
    this.outReadPos = 0;
    this.idealInputPos = 0;
    this.lastChosenStart = 0;
    this.isFirstFrame = true;
  }
}
