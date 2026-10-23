import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleLaunch } from '../src/utils.js';

function launchAssignment(params) {
  const assigned = [];
  globalThis.window = {
    location: {
      set href(value) {
        assigned.push(value);
      }
    }
  };
  handleLaunch(params);
  assert.equal(assigned.length, 1);
  assert.equal(typeof assigned[0], 'string');
  return assigned[0];
}

function launch(params) {
  return new URL(launchAssignment(params));
}

const origin = 'https://www.youtube.com';

for (const value of [
  'https://www.youtube.com/tv#/',
  'https://www.youtube.com:443/watch?v=abc',
  'https://WWW.YOUTUBE.COM/tv?x=1',
  'https://www.youtube.com/watch?v=a#b',
  ' https://www.youtube.com/tv ',
  'HTTPS://WWW.YOUTUBE.COM:443/tv?x=1',
  'https://www.youtube.com:0443/tv',
  'https://%77%77%77.youtube.com/tv',
  'https://www%2eyoutube%2ecom/tv',
  'https://www\u3002youtube\uff0ecom/tv',
  'https://\uff57\uff57\uff57.youtube.com/tv',
  'https://www.youtube.com/tv?q=%2F%26%3D#%E2%9C%93',
  'https://www.youtube.com\\@evil.example/tv?x=1'
]) {
  test(`direct URL assigns the validated canonical string: ${value}`, () => {
    assert.equal(
      launchAssignment({ contentTarget: value }),
      new URL(value).href
    );
  });
}

for (const value of [
  'https://www.youtube.com.example.net/tv',
  'https://www.youtube.com@evil.example/tv',
  'https://www.youtube.com:444/tv',
  'http://www.youtube.com/tv',
  'https://youtube.com/tv',
  'https://m.youtube.com/tv',
  'https://sub.www.youtube.com/tv',
  'https://www.youtube.com./tv',
  '//evil.example/tv',
  'javascript:alert(1)',
  'data:text/html,hello',
  'blob:https://www.youtube.com/00000000-0000-0000-0000-000000000000',
  'ftp://www.youtube.com/tv',
  'https://www.youtube.com:bad/tv',
  'https://[bad',
  'not a URL',
  '',
  'https://%77%77%77.youtube.com.evil.example/tv',
  'https://www.youtub\u0435.com/tv',
  'https://www.youtube.com%2Fevil.example/tv',
  'https://www.youtube.com%40evil.example/tv',
  'https://www.youtube.com%00.evil.example/tv',
  'https://www.youtube.com%252e.evil.example/tv',
  'blob:http://www.youtube.com/fixture'
]) {
  test(`untrusted or invalid direct URL falls back: ${value}`, () => {
    const result = launch({ contentTarget: value });
    assert.equal(result.protocol, 'https:');
    assert.equal(result.origin, origin);
    assert.equal(result.pathname, '/tv');
    assert.equal(result.searchParams.get('env_enableVoice'), '1');
  });
}

test('partial video ID', () => {
  assert.equal(launch({ target: 'v=abc' }).searchParams.get('v'), 'abc');
});

test('double v from Google Assistant', () => {
  assert.equal(
    launch({ contentTarget: 'v=v=abc' }).searchParams.get('v'),
    'abc'
  );
});

test('DIAL pairing parameters survive', () => {
  const result = launch({
    contentTarget: 'pairingCode=123&theme=cl&dialLaunch=watch'
  });
  assert.equal(result.searchParams.get('pairingCode'), '123');
  assert.equal(result.searchParams.get('dialLaunch'), 'watch');
});

test('custom target URL', () => {
  assert.equal(launch({ target: origin + '/watch?v=abc' }).pathname, '/watch');
});

test('explicit contentTarget retains precedence', () => {
  assert.equal(
    launch({ target: 'v=wrong', contentTarget: 'v=right' }).searchParams.get(
      'v'
    ),
    'right'
  );
});

test('default launch retains voice flags', () => {
  assert.equal(launch({}).searchParams.get('env_enableVoice'), '1');
});

for (const intent of ['PlayContent', 'SearchContent']) {
  test(`voice intent: ${intent}`, () => {
    const result = launch({
      contentTarget: { intent, intentParam: 'hello world' }
    });
    assert.equal(result.origin, origin);
    assert.equal(result.searchParams.get('vq'), 'hello world');
    assert.equal(
      result.searchParams.get('va'),
      intent.startsWith('Play') ? 'play' : 'search'
    );
    assert.equal(result.searchParams.get('vs'), '9');
    assert.deepEqual(
      result.searchParams.getAll('launch'),
      intent.startsWith('Play') ? ['voice'] : ['voice', 'search']
    );
  });
}
