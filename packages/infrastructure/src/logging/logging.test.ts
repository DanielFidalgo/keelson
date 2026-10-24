import { describe, expect, it } from 'vitest';
import { cloudTraceBindings, createCloudTraceLoggerFactory, createLoggerOptions } from './logging.js';

const PROJECT = 'keelson-test';
const TRACE_FIELD = 'logging.googleapis.com/trace';

describe('cloudTraceBindings', () => {
  it('maps the trace id in X-Cloud-Trace-Context to the Cloud Logging trace field', () => {
    expect(cloudTraceBindings('105445aa7843bc8bf206b12000100000/1;o=1', PROJECT)).toEqual({
      [TRACE_FIELD]: 'projects/keelson-test/traces/105445aa7843bc8bf206b12000100000',
    });
  });

  it('accepts a header without span and options', () => {
    expect(cloudTraceBindings('105445aa7843bc8bf206b12000100000', PROJECT)).toEqual({
      [TRACE_FIELD]: 'projects/keelson-test/traces/105445aa7843bc8bf206b12000100000',
    });
  });

  it.each([
    ['a missing header', undefined, PROJECT],
    ['an empty header', '', PROJECT],
    ['a header with no trace id', '/1;o=1', PROJECT],
    ['a header whose trace id is not hexadecimal', 'not-a-trace-id/1', PROJECT],
    ['an unknown project', '105445aa7843bc8bf206b12000100000/1', undefined],
  ])('adds nothing for %s', (_description, header, project) => {
    expect(cloudTraceBindings(header, project)).toEqual({});
  });

  it('ignores a repeated header rather than guessing which value to trust', () => {
    expect(cloudTraceBindings(['a/1', 'b/1'], PROJECT)).toEqual({});
  });
});

describe('createCloudTraceLoggerFactory', () => {
  it('binds the trace field of the request onto its child logger', () => {
    const seen: object[] = [];
    const parent = {
      child(bindings: object) {
        seen.push(bindings);
        return parent;
      },
    };

    createCloudTraceLoggerFactory(PROJECT)(parent, { reqId: 'req-1' }, {}, { headers: { 'x-cloud-trace-context': '105445aa7843bc8bf206b12000100000/1' } });

    expect(seen).toEqual([{ reqId: 'req-1', [TRACE_FIELD]: 'projects/keelson-test/traces/105445aa7843bc8bf206b12000100000' }]);
  });
});

describe('createLoggerOptions', () => {
  it('names the level field severity, which Cloud Logging reads', () => {
    expect(createLoggerOptions().formatters.level('error')).toEqual({ severity: 'ERROR' });
  });

  it('serializes a request as method and url only, so headers and bodies cannot reach the logs', () => {
    const request = { method: 'POST', url: '/internal/inspect', headers: { authorization: 'Bearer secret' }, body: { bearerToken: 'x' } };

    expect(createLoggerOptions().serializers.req(request)).toEqual({ method: 'POST', url: '/internal/inspect' });
  });
});
