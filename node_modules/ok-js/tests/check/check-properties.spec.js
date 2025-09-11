'use strict';

var
  check = require('../../index').check,
  expect = require('chai').expect;

describe('check - properties', function () {
  var
    actual,
    expected,
    foo;

  afterEach(function () {
    actual = expected = undefined;
  });

  before(function () {
    foo = {
      a: {
        deeply: {
          nested: { property: 123, bar: { baz: 'abc' } }
        }
      }
    };
  });

  it('Should check nested properties successfully', function () {
    actual = check(foo, 'a.deeply.nested.property').is.gt(122);
    expected = true;
    expect(actual).to.equal(expected);
  });

  it('Should check nested properties which do not exist', function () {
    actual = check(foo, 'some.property.which.doesnt.exist').is.not.defined;
    expected = true;
    expect(actual).to.equal(expected);
  });
});
