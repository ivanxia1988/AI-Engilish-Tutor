import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import DevelopmentOnly from '../components/development-only.tsx';

test('development pages render only in development and fail closed elsewhere', () => {
  const environment: Record<string, string | undefined> = process.env;
  const original = environment.NODE_ENV;
  try {
    const children = <p>Private review tools</p>;
    environment.NODE_ENV = 'development';
    assert.equal(DevelopmentOnly({ children }), children);
    for (const candidate of ['production', 'test', '', undefined]) {
      if (candidate === undefined) delete environment.NODE_ENV;
      else environment.NODE_ENV = candidate;
      assert.throws(() => DevelopmentOnly({ children }), error => {
        assert.equal((error as { digest?: string }).digest, 'NEXT_HTTP_ERROR_FALLBACK;404');
        return true;
      });
    }
  } finally {
    if (original === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = original;
  }
});
