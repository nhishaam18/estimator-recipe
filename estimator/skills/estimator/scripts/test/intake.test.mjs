import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUrlList} from '../lib/intake.mjs';
test('explicit URL scope retains commas, query values, route case and functional hashes',()=>{
 const input='https://Example.test/a,b?categories=x,y#/Products\nhttps://example.test/a,b?categories=x,y#/Products\n';
 assert.deepEqual(parseUrlList(input),{urls:['https://example.test/a,b?categories=x,y#/Products'],invalid:[]});
 assert.deepEqual(parseUrlList('example.test/Route').urls,['https://example.test/Route']);
});
test('rejects credentials without repeating their values',()=>{
 const result=parseUrlList('https://user:secret@example.test\nhttps://example.test/?access_token=secret');
 assert.equal(result.invalid.length,2);assert.equal(result.urls.length,0);assert(!JSON.stringify(result).includes('secret'));
});
test('rejects explicit non-HTTP schemes instead of changing the requested URL',()=>{
 const result=parseUrlList('ftp://example.test/a\nfile:///C:/private');
 assert.equal(result.invalid.length,2);assert.equal(result.urls.length,0);
});

